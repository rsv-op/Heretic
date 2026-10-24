package com.heretic.voice

import android.content.Context
import android.net.Uri
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import org.schabi.parakeetype.audio.PermissionHelper
import java.io.File

data class VoicePipelineUiState(
    val paths: VoiceModelPaths,
    val readiness: VoiceModelReadiness,
    val isBusy: Boolean = false,
    val isInitialized: Boolean = false,
    val isListening: Boolean = false,
    val isPlaying: Boolean = false,
    val statusMessage: String = "Configure local GGUF, Parakeet STT, and Supertonic TTS model paths to begin.",
    val lastUserTranscript: String = "",
    val lastAssistantSentence: String = "",
    val transcriptHistory: List<String> = emptyList(),
)

/**
 * Coordinates [VoiceModelConfigStore], SAF file/directory imports, and [UnifiedVoiceOrchestrator]
 * for both the Jetpack Compose UI (`HereticApp`) and the WebView JS bridge (`HereticJsBridge`).
 */
class VoicePipelineController(
    context: Context,
    private val onRequestRecordPermission: (() -> Unit)? = null,
    private val onStateBroadcast: ((VoicePipelineUiState) -> Unit)? = null,
) {
    companion object {
        private const val TAG = "VoicePipelineController"
        private const val MAX_TRANSCRIPT_HISTORY = 24
    }

    private val appContext = context.applicationContext
    private val scope = CoroutineScope(Dispatchers.Main.immediate + SupervisorJob())
    private val controllerLock = Any()

    private var orchestrator: UnifiedVoiceOrchestrator? = null
    private var initializedPaths: VoiceModelPaths? = null

    private val _state: MutableStateFlow<VoicePipelineUiState>
    val state: StateFlow<VoicePipelineUiState>

    init {
        val initialPaths = VoiceModelConfigStore.loadPaths(appContext)
        val initialReadiness = VoiceModelConfigStore.validate(initialPaths)
        _state = MutableStateFlow(
            VoicePipelineUiState(
                paths = initialPaths,
                readiness = initialReadiness,
                statusMessage = if (initialReadiness.allReady) {
                    "All local voice models detected. Tap Initialize Pipeline."
                } else {
                    "Select local .gguf, Parakeet STT folder, and Supertonic TTS folder."
                },
            )
        )
        state = _state.asStateFlow()
    }

    fun refreshConfig() {
        val loaded = VoiceModelConfigStore.loadPaths(appContext)
        val readiness = VoiceModelConfigStore.validate(loaded)
        mutateState {
            it.copy(
                paths = loaded,
                readiness = readiness,
                isInitialized = it.isInitialized && initializedPaths == loaded,
            )
        }
    }

    fun updatePaths(
        llamaModelPath: String,
        sttModelDir: String,
        ttsModelDir: String,
        voiceStylePath: String = "",
    ): VoicePipelineUiState {
        val saved = VoiceModelConfigStore.savePaths(
            appContext,
            VoiceModelPaths(
                llamaModelPath = llamaModelPath,
                sttModelDir = sttModelDir,
                ttsModelDir = ttsModelDir,
                voiceStylePath = voiceStylePath,
            )
        )
        val readiness = VoiceModelConfigStore.validate(saved)
        if (initializedPaths != null && initializedPaths != saved) {
            teardownOrchestrator()
        }
        mutateState {
            it.copy(
                paths = saved,
                readiness = readiness,
                isInitialized = orchestrator != null && initializedPaths == saved,
                statusMessage = if (readiness.allReady) {
                    "Model paths saved and verified. Ready to initialize."
                } else {
                    "Paths updated — verify missing model files before initializing."
                },
            )
        }
        return _state.value
    }

    fun importGgufUri(uri: Uri) {
        mutateState { it.copy(isBusy = true, statusMessage = "Importing GGUF model from storage...") }
        scope.launch(Dispatchers.IO) {
            val result = VoiceModelConfigStore.importGgufDocument(appContext, uri) { progress ->
                mutateState { s -> s.copy(statusMessage = progress) }
            }
            val paths = VoiceModelConfigStore.loadPaths(appContext)
            val readiness = VoiceModelConfigStore.validate(paths)
            result.fold(
                onSuccess = { file ->
                    if (initializedPaths != null && initializedPaths != paths) {
                        teardownOrchestrator()
                    }
                    mutateState {
                        it.copy(
                            isBusy = false,
                            paths = paths,
                            readiness = readiness,
                            isInitialized = orchestrator != null && initializedPaths == paths,
                            statusMessage = "Loaded GGUF path: ${file.name}",
                        )
                    }
                },
                onFailure = { err ->
                    Log.e(TAG, "GGUF SAF import failed", err)
                    mutateState {
                        it.copy(
                            isBusy = false,
                            paths = paths,
                            readiness = readiness,
                            statusMessage = "GGUF import error: ${err.message}",
                        )
                    }
                }
            )
        }
    }

    fun importModelDirectoryUri(uri: Uri, slot: String) {
        val label = if (slot == "stt") "Parakeet STT" else "Supertonic TTS"
        mutateState { it.copy(isBusy = true, statusMessage = "Importing $label directory...") }
        scope.launch(Dispatchers.IO) {
            val result = VoiceModelConfigStore.importModelDirectoryTree(appContext, uri, slot) { progress ->
                mutateState { s -> s.copy(statusMessage = progress) }
            }
            val paths = VoiceModelConfigStore.loadPaths(appContext)
            val readiness = VoiceModelConfigStore.validate(paths)
            result.fold(
                onSuccess = { dir ->
                    if (initializedPaths != null && initializedPaths != paths) {
                        teardownOrchestrator()
                    }
                    mutateState {
                        it.copy(
                            isBusy = false,
                            paths = paths,
                            readiness = readiness,
                            isInitialized = orchestrator != null && initializedPaths == paths,
                            statusMessage = "$label directory configured: ${dir.absolutePath}",
                        )
                    }
                },
                onFailure = { err ->
                    Log.e(TAG, "$label SAF directory import failed", err)
                    mutateState {
                        it.copy(
                            isBusy = false,
                            paths = paths,
                            readiness = readiness,
                            statusMessage = "$label folder error: ${err.message}",
                        )
                    }
                }
            )
        }
    }

    fun initialize(onComplete: ((Boolean) -> Unit)? = null) {
        val currentPaths = VoiceModelConfigStore.loadPaths(appContext)
        val readiness = VoiceModelConfigStore.validate(currentPaths)
        if (!readiness.allReady) {
            mutateState {
                it.copy(
                    paths = currentPaths,
                    readiness = readiness,
                    statusMessage = "Cannot initialize yet — ${firstMissingSummary(readiness)}",
                )
            }
            onComplete?.invoke(false)
            return
        }

        mutateState {
            it.copy(
                isBusy = true,
                paths = currentPaths,
                readiness = readiness,
                statusMessage = "Initializing Parakeet STT, Supertonic TTS, and llama.cpp...",
            )
        }

        scope.launch(Dispatchers.IO) {
            teardownOrchestrator()
            val player = PcmStreamingAudioPlayer()
            scope.launch {
                player.playingState.collect { playing ->
                    mutateState { s -> s.copy(isPlaying = playing) }
                }
            }

            val created = UnifiedVoiceOrchestrator(
                context = appContext,
                sttModelDir = File(currentPaths.sttModelDir),
                ttsModelDir = File(currentPaths.ttsModelDir),
                llamaModelPath = currentPaths.llamaModelPath,
                voiceStylePath = currentPaths.voiceStylePath,
                audioPlayer = player,
                autoPlayAudioTrack = true,
            )

            val ok = runCatching { created.init() }.getOrElse { e ->
                Log.e(TAG, "UnifiedVoiceOrchestrator.init() threw exception", e)
                false
            }

            if (ok) {
                synchronized(controllerLock) {
                    orchestrator = created
                    initializedPaths = currentPaths
                }
                mutateState {
                    it.copy(
                        isBusy = false,
                        isInitialized = true,
                        statusMessage = "Unified voice pipeline ready (Parakeet + llama.cpp + Supertonic).",
                    )
                }
            } else {
                created.shutdown()
                mutateState {
                    it.copy(
                        isBusy = false,
                        isInitialized = false,
                        statusMessage = "Engine initialization failed — check logcat for native/ONNX details.",
                    )
                }
            }
            onComplete?.invoke(ok)
        }
    }

    fun startListening(): Boolean {
        if (!PermissionHelper.hasRecordPermission(appContext)) {
            onRequestRecordPermission?.invoke()
            mutateState {
                it.copy(statusMessage = "Microphone permission required — grant RECORD_AUDIO to listen.")
            }
            return false
        }

        val active = synchronized(controllerLock) { orchestrator }
        if (active == null) {
            initialize { ready ->
                if (ready) {
                    startListening()
                }
            }
            return true
        }

        active.startListening(
            onFinalTranscript = { transcript ->
                mutateState { prev ->
                    val entry = "You: $transcript"
                    val nextHistory = (prev.transcriptHistory + entry).takeLast(MAX_TRANSCRIPT_HISTORY)
                    prev.copy(
                        lastUserTranscript = transcript,
                        transcriptHistory = nextHistory,
                        statusMessage = if (UnifiedVoiceOrchestrator.matchesStopKeyword(transcript)) {
                            "Stop keyword 'shaz' detected — playback flushed."
                        } else {
                            "Heard: \"$transcript\" — generating spoken reply..."
                        },
                    )
                }
            },
            onTtsChunk = { pcmBytes ->
                mutateState { prev ->
                    prev.copy(statusMessage = "Streaming TTS audio (${pcmBytes.size / 2} samples)...")
                }
            }
        )

        mutateState {
            it.copy(
                isListening = true,
                statusMessage = "Hands-free listening active (say \"shaz\" or speak to barge in).",
            )
        }
        return true
    }

    fun stopListening() {
        synchronized(controllerLock) { orchestrator }?.stopListening()
        mutateState {
            it.copy(
                isListening = false,
                statusMessage = "Microphone capture stopped.",
            )
        }
    }

    /**
     * Immediate `"shaz"` / emergency barge-in stop: pauses & flushes [PcmStreamingAudioPlayer],
     * aborts `llama.cpp` token generation, and cancels in-flight Supertonic synthesis.
     */
    fun stopPlayback() {
        synchronized(controllerLock) { orchestrator }?.stopPlayback()
        mutateState {
            it.copy(
                isPlaying = false,
                statusMessage = "Playback paused & flushed.",
            )
        }
    }

    fun speakPrompt(prompt: String) {
        val trimmed = prompt.trim()
        if (trimmed.isEmpty()) return

        val active = synchronized(controllerLock) { orchestrator }
        if (active == null) {
            initialize { ready ->
                if (ready) speakPrompt(trimmed)
            }
            return
        }

        mutateState { prev ->
            val nextHistory = (prev.transcriptHistory + "Prompt: $trimmed").takeLast(MAX_TRANSCRIPT_HISTORY)
            prev.copy(
                lastUserTranscript = trimmed,
                transcriptHistory = nextHistory,
                statusMessage = "Generating spoken response...",
            )
        }

        active.speakPrompt(
            prompt = trimmed,
            onAssistantSentence = { sentence ->
                mutateState { prev ->
                    val nextHistory = (prev.transcriptHistory + "HeretIc: $sentence").takeLast(MAX_TRANSCRIPT_HISTORY)
                    prev.copy(
                        lastAssistantSentence = sentence,
                        transcriptHistory = nextHistory,
                    )
                }
            }
        )
    }

    fun onRecordPermissionResult(granted: Boolean) {
        if (granted) {
            mutateState { it.copy(statusMessage = "Microphone permission granted.") }
            if (_state.value.isInitialized) {
                startListening()
            }
        } else {
            mutateState { it.copy(statusMessage = "Microphone permission denied — hands-free STT unavailable.") }
        }
    }

    fun toJsonConfig(): String {
        val snap = _state.value
        return JSONObject().apply {
            put("llamaModelPath", snap.paths.llamaModelPath)
            put("sttModelDir", snap.paths.sttModelDir)
            put("ttsModelDir", snap.paths.ttsModelDir)
            put("voiceStylePath", snap.paths.voiceStylePath)
            put("llmReady", snap.readiness.llmReady)
            put("sttReady", snap.readiness.sttReady)
            put("ttsReady", snap.readiness.ttsReady)
            put("styleReady", snap.readiness.styleReady)
            put("allReady", snap.readiness.allReady)
            put("llmMessage", snap.readiness.llmMessage)
            put("sttMessage", snap.readiness.sttMessage)
            put("ttsMessage", snap.readiness.ttsMessage)
            put("isBusy", snap.isBusy)
            put("isInitialized", snap.isInitialized)
            put("isListening", snap.isListening)
            put("isPlaying", snap.isPlaying)
            put("statusMessage", snap.statusMessage)
            put("lastUserTranscript", snap.lastUserTranscript)
            put("lastAssistantSentence", snap.lastAssistantSentence)
            put("transcriptHistory", JSONArray(snap.transcriptHistory))
        }.toString()
    }

    fun shutdown() {
        teardownOrchestrator()
        scope.cancel()
    }

    private fun teardownOrchestrator() {
        val old = synchronized(controllerLock) {
            val prev = orchestrator
            orchestrator = null
            initializedPaths = null
            prev
        }
        old?.shutdown()
        _state.update {
            it.copy(
                isInitialized = false,
                isListening = false,
                isPlaying = false,
            )
        }
    }

    private fun firstMissingSummary(r: VoiceModelReadiness): String = when {
        !r.llmReady -> r.llmMessage
        !r.sttReady -> r.sttMessage
        !r.ttsReady || !r.styleReady -> r.ttsMessage
        else -> "Check model files"
    }

    private fun mutateState(reducer: (VoicePipelineUiState) -> VoicePipelineUiState) {
        val updated = _state.updateAndGetCompat(reducer)
        onStateBroadcast?.invoke(updated)
    }

    private fun <T> MutableStateFlow<T>.updateAndGetCompat(function: (T) -> T): T {
        while (true) {
            val prevValue = value
            val nextValue = function(prevValue)
            if (compareAndSet(prevValue, nextValue)) {
                return nextValue
            }
        }
    }
}
