package com.heretic.voice

import android.content.Context
import android.net.Uri
import android.os.Build
import android.util.Log
import ai.heretic.app.assistant.AssistantActionKind
import ai.heretic.app.assistant.RoutedAssistantResult
import ai.heretic.app.assistant.VoiceActionRouter
import ai.heretic.app.core.ErrorAnalysis
import ai.heretic.app.core.FileAssessment
import ai.heretic.app.core.HereticCore
import ai.heretic.app.core.MilestoneItem
import ai.heretic.app.core.MilestoneKind
import ai.heretic.app.core.SolutionConfirmation
import ai.heretic.app.ml.LiteRtEngine
import ai.heretic.app.ml.LiteRtLmEngine
import ai.heretic.app.ml.LiteRtLmModels
import ai.heretic.app.voice.VoiceManager
import com.brahmadeo.supertonic.tts.utils.LexiconItem
import com.brahmadeo.supertonic.tts.utils.LexiconManager
import com.brahmadeo.supertonic.tts.utils.WavUtils
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.schabi.parakeetype.audio.MicCalibrationResult
import org.schabi.parakeetype.audio.MicScorer
import org.schabi.parakeetype.audio.PermissionHelper
import java.io.File

data class AssistantTurn(
    val id: Long,
    val role: String,
    val badge: String,
    val text: String,
    val spokenText: String = "",
)

data class VoicePipelineUiState(
    val paths: VoiceModelPaths,
    val readiness: VoiceModelReadiness,
    val isBusy: Boolean = false,
    val isInitialized: Boolean = false,
    val sttNeuralActive: Boolean = false,
    val llmNeuralActive: Boolean = false,
    val liteRtActive: Boolean = false,
    val liteRtModelLabel: String = "",
    val tfliteSummary: String = "LiteRT 2.3.0 + litert-gpu 2.3.0 ready (TFL3 v3 · GPU -> setNumThreads(4) cached per install)",
    val ttsNeuralActive: Boolean = false,
    val isListening: Boolean = false,
    val isPlaying: Boolean = false,
    val voiceSpeed: Float = 1.05f,
    val diffusionSteps: Int = 5,
    val availableStyles: List<File> = emptyList(),
    val savedWavs: List<File> = emptyList(),
    val lexiconRules: List<LexiconItem> = emptyList(),
    val milestones: List<MilestoneItem> = emptyList(),
    val micCalibration: MicCalibrationResult? = null,
    val lastErrorAnalysis: ErrorAnalysis? = null,
    val lastSolutionConfirmation: SolutionConfirmation? = null,
    val lastFileAssessment: FileAssessment? = null,
    val requestedTab: Int? = null,
    val statusMessage: String = "Heretic Voice Assistant online. Tap Speak or Hands-Free Mic anytime.",
    val lastUserTranscript: String = "",
    val lastAssistantSentence: String = "",
    val transcriptHistory: List<String> = emptyList(),
    val conversation: List<AssistantTurn> = emptyList(),
) {
    val activeSttLabel: String
        get() = if (sttNeuralActive) "Parakeet TDT + Silero VAD v6" else "Android Offline STT"

    val activeBrainLabel: String
        get() = when {
            llmNeuralActive -> "llama.cpp GGUF"
            liteRtActive -> "LiteRT-LM ($liteRtModelLabel)"
            else -> "HereticCore Offline"
        }

    val activeTtsLabel: String
        get() = if (ttsNeuralActive) {
            val styleName = File(paths.voiceStylePath).nameWithoutExtension.ifBlank { "M1" }
            "Supertonic ONNX ($styleName)"
        } else {
            "Android Offline TTS"
        }
}

/**
 * Central native controller for the Heretic Voice Assistant.
 *
 * Works immediately out of the box using `HereticCore` + offline Android STT/TTS, and
 * seamlessly upgrades each tier (`Parakeet TDT STT`, `llama.cpp` / `LiteRT-LM`, and
 * `Supertonic ONNX TTS`) independently as soon as model files are imported.
 */
class VoicePipelineController(
    context: Context,
    private val core: HereticCore? = null,
    private val platformVoice: VoiceManager? = null,
    private val liteRtEngine: LiteRtLmEngine? = null,
    private val tfliteEngine: LiteRtEngine? = null,
    private val onRequestRecordPermission: (() -> Unit)? = null,
    private val onStateBroadcast: ((VoicePipelineUiState) -> Unit)? = null,
) {
    companion object {
        private const val TAG = "VoicePipelineController"
        private const val MAX_TRANSCRIPT_HISTORY = 32
        private const val MAX_CONVERSATION_TURNS = 60
        private const val PREFS_ASSISTANT = "heretic_assistant_state"
        private const val KEY_MILESTONES = "repo_milestones_json"
        private const val KEY_VOICE_SPEED = "voice_speed"
        private const val KEY_DIFFUSION_STEPS = "diffusion_steps"
        private const val KEY_INITIAL_TTS_GATE = "initial_tts_gate_seeded"
    }

    private val appContext = context.applicationContext
    private val hereticCore = core ?: HereticCore(appContext)
    private val scope = CoroutineScope(Dispatchers.Main.immediate + SupervisorJob())
    private val controllerLock = Any()
    private var turnSeq = 1L

    private var orchestrator: UnifiedVoiceOrchestrator? = null
    private var initializedPaths: VoiceModelPaths? = null

    private val _state: MutableStateFlow<VoicePipelineUiState>
    val state: StateFlow<VoicePipelineUiState>

    init {
        seedInitialAssistantGrants()
        val initialPaths = VoiceModelConfigStore.loadPaths(appContext)
        val initialReadiness = VoiceModelConfigStore.validate(initialPaths)
        val prefs = appContext.getSharedPreferences(PREFS_ASSISTANT, Context.MODE_PRIVATE)
        val savedSpeed = prefs.getFloat(KEY_VOICE_SPEED, 1.05f).coerceIn(0.8f, 1.4f)
        val savedSteps = prefs.getInt(KEY_DIFFUSION_STEPS, 5).coerceIn(2, 8)
        val loadedLexicon = LexiconManager.load(appContext)
        val loadedMilestones = loadPersistedMilestones()
        val styles = discoverAllStyles(File(initialPaths.ttsModelDir))

        val welcomeTurn = AssistantTurn(
            id = turnSeq++,
            role = "heretic",
            badge = "HERETIC READY",
            text = "Heretic Voice Assistant online (100% offline, zero network permissions). " +
                "Tap the Mic button to speak, say \"shaz\" anytime to interrupt playback, or open Models to activate Parakeet STT, llama.cpp GGUF, LiteRT-LM, and Supertonic TTS.",
            spokenText = "Heretic Voice Assistant online.",
        )

        _state = MutableStateFlow(
            VoicePipelineUiState(
                paths = initialPaths,
                readiness = initialReadiness,
                tfliteSummary = tfliteEngine?.statusSummary()
                    ?: "LiteRT 2.3.0 + litert-gpu 2.3.0 ready (TFL3 v3 · GPU -> setNumThreads(4) cached per install)",
                voiceSpeed = savedSpeed,
                diffusionSteps = savedSteps,
                availableStyles = styles,
                savedWavs = listSavedWavFiles(),
                lexiconRules = loadedLexicon,
                milestones = loadedMilestones,
                statusMessage = buildTierStatusSummary(initialReadiness),
                conversation = listOf(welcomeTurn),
            )
        )
        state = _state.asStateFlow()

        // Auto-activate any neural models already imported on disk
        if (initialReadiness.llmReady || initialReadiness.sttReady || (initialReadiness.ttsReady && initialReadiness.styleReady)) {
            initialize()
        }
        tryBootInstalledLiteRt()
    }

    private fun seedInitialAssistantGrants() {
        val prefs = appContext.getSharedPreferences(PREFS_ASSISTANT, Context.MODE_PRIVATE)
        if (!prefs.getBoolean(KEY_INITIAL_TTS_GATE, false)) {
            hereticCore.gates.record("tts.speak", "GRANTED", source = "voice-assistant-init")
            hereticCore.gates.record("mic.capture", "GRANTED", source = "voice-assistant-init")
            prefs.edit().putBoolean(KEY_INITIAL_TTS_GATE, true).apply()
        }
    }

    private fun tryBootInstalledLiteRt() {
        val engine = liteRtEngine ?: return
        val installed = engine.installedModel() ?: return
        scope.launch(Dispatchers.IO) {
            runCatching { engine.load(installed) }.onSuccess {
                mutateState {
                    it.copy(
                        liteRtActive = true,
                        liteRtModelLabel = "${installed.label} · ${engine.activeBackendLabel}",
                    )
                }
            }
        }
    }

    fun consumeTabNavigation() {
        mutateState { it.copy(requestedTab = null) }
    }

    fun refreshConfig() {
        val loaded = VoiceModelConfigStore.loadPaths(appContext)
        val readiness = VoiceModelConfigStore.validate(loaded)
        mutateState {
            it.copy(
                paths = loaded,
                readiness = readiness,
                availableStyles = discoverAllStyles(File(loaded.ttsModelDir)),
                savedWavs = listSavedWavFiles(),
                lexiconRules = LexiconManager.load(appContext),
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
                availableStyles = discoverAllStyles(File(saved.ttsModelDir)),
                statusMessage = buildTierStatusSummary(readiness),
            )
        }
        if (readiness.llmReady || readiness.sttReady || (readiness.ttsReady && readiness.styleReady)) {
            initialize()
        }
        return _state.value
    }

    fun selectVoiceStyle(styleFile: File) {
        if (!styleFile.isFile) return
        val current = VoiceModelConfigStore.loadPaths(appContext)
        val saved = VoiceModelConfigStore.savePaths(appContext, current.copy(voiceStylePath = styleFile.absolutePath))
        synchronized(controllerLock) { orchestrator }?.voiceStylePath = styleFile.absolutePath
        mutateState {
            it.copy(
                paths = saved,
                readiness = VoiceModelConfigStore.validate(saved),
                statusMessage = "Selected Supertonic speaker style: ${styleFile.nameWithoutExtension}",
            )
        }
    }

    fun updateSynthesisTuning(speed: Float, steps: Int) {
        val clampedSpeed = speed.coerceIn(0.8f, 1.4f)
        val clampedSteps = steps.coerceIn(2, 8)
        appContext.getSharedPreferences(PREFS_ASSISTANT, Context.MODE_PRIVATE)
            .edit()
            .putFloat(KEY_VOICE_SPEED, clampedSpeed)
            .putInt(KEY_DIFFUSION_STEPS, clampedSteps)
            .apply()
        synchronized(controllerLock) { orchestrator }?.let {
            it.voiceSpeed = clampedSpeed
            it.diffusionSteps = clampedSteps
        }
        mutateState {
            it.copy(
                voiceSpeed = clampedSpeed,
                diffusionSteps = clampedSteps,
                statusMessage = "Updated voice tuning (${String.format(java.util.Locale.US, "%.2fx", clampedSpeed)} · $clampedSteps steps).",
            )
        }
    }

    fun addLexiconRule(term: String, replacement: String) {
        val cleanTerm = term.trim()
        val cleanRep = replacement.trim()
        if (cleanTerm.isEmpty() || cleanRep.isEmpty()) return
        val current = LexiconManager.load(appContext).filterNot { it.term.equals(cleanTerm, ignoreCase = true) }
        val updated = current + LexiconItem(term = cleanTerm, replacement = cleanRep)
        LexiconManager.save(appContext, updated)
        mutateState {
            it.copy(
                lexiconRules = updated,
                statusMessage = "Saved pronunciation rule: $cleanTerm -> $cleanRep",
            )
        }
    }

    fun removeLexiconRule(id: String) {
        val updated = LexiconManager.load(appContext).filterNot { it.id == id }
        LexiconManager.save(appContext, updated)
        mutateState { it.copy(lexiconRules = updated) }
    }

    fun updateMilestones(items: List<MilestoneItem>) {
        persistMilestones(items)
        mutateState { it.copy(milestones = items) }
    }

    fun calibrateMicrophone() {
        if (!PermissionHelper.hasRecordPermission(appContext)) {
            onRequestRecordPermission?.invoke()
            mutateState { it.copy(statusMessage = "Grant RECORD_AUDIO permission to calibrate microphone.") }
            return
        }
        mutateState { it.copy(isBusy = true, statusMessage = "Measuring 16 kHz microphone SNR & fricative clarity (speak briefly)...") }
        scope.launch {
            val res = MicScorer.measureLiveMicrophone()
            res.fold(
                onSuccess = { cal ->
                    mutateState {
                        it.copy(
                            isBusy = false,
                            micCalibration = cal,
                            statusMessage = "Mic score ${cal.qualityScore.toInt()}/100 (${String.format(java.util.Locale.US, "%.1f", cal.snrDb)} dB SNR) — ${cal.verdict}",
                        )
                    }
                },
                onFailure = { err ->
                    mutateState {
                        it.copy(
                            isBusy = false,
                            statusMessage = "Mic calibration failed: ${err.message}",
                        )
                    }
                },
            )
        }
    }

    fun saveLastSynthesizedWav(): Result<String> {
        val active = synchronized(controllerLock) { orchestrator }
            ?: return Result.failure(IllegalStateException("Supertonic neural TTS has not synthesized a turn yet"))
        val outDir = File(appContext.filesDir, "saved_audio").apply { mkdirs() }
        val file = File(outDir, "heretic_${System.currentTimeMillis()}.wav")
        return active.exportLastWav(file).map { saved ->
            mutateState {
                it.copy(
                    savedWavs = listSavedWavFiles(),
                    statusMessage = "Exported WAV: ${saved.name}",
                )
            }
            saved.absolutePath
        }
    }

    fun playSavedWav(file: File) {
        scope.launch(Dispatchers.IO) {
            mutateState { it.copy(isPlaying = true, statusMessage = "Playing ${file.name}...") }
            WavUtils.playWavBlocking(file)
            mutateState { it.copy(isPlaying = false, statusMessage = "Finished playing ${file.name}.") }
        }
    }

    fun deleteSavedWav(file: File) {
        runCatching { file.delete() }
        mutateState { it.copy(savedWavs = listSavedWavFiles()) }
    }

    fun importGgufUri(uri: Uri) {
        mutateState { it.copy(isBusy = true, statusMessage = "Importing GGUF model into app storage...") }
        scope.launch(Dispatchers.IO) {
            val result = VoiceModelConfigStore.importGgufDocument(appContext, uri) { progress ->
                mutateState { s -> s.copy(statusMessage = progress) }
            }
            val paths = VoiceModelConfigStore.loadPaths(appContext)
            val readiness = VoiceModelConfigStore.validate(paths)
            result.fold(
                onSuccess = { file ->
                    mutateState {
                        it.copy(
                            isBusy = false,
                            paths = paths,
                            readiness = readiness,
                            statusMessage = "Imported GGUF: ${file.name} — activating llama.cpp...",
                        )
                    }
                    initialize()
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

    fun importLiteRtLmUri(uri: Uri, displayName: String) {
        if (displayName.lowercase().let { it.endsWith(".tflite") || it.endsWith(".task") }) {
            importTfliteUri(uri, displayName)
            return
        }
        val engine = liteRtEngine ?: return
        val spec = LiteRtLmModels.byFileName(displayName)
        if (spec == null) {
            mutateState {
                it.copy(
                    statusMessage = "Unsupported .litertlm file '$displayName' (expected ${LiteRtLmModels.GEMMA_4_E2B.fileName} or ${LiteRtLmModels.GEMMA_3N_E2B.fileName}).",
                )
            }
            return
        }
        mutateState { it.copy(isBusy = true, statusMessage = "Copying ${spec.fileName} into app storage...") }
        scope.launch(Dispatchers.IO) {
            val copied = runCatching {
                engine.copyUriToModelsDir(uri) { done, total ->
                    if (total > 0L) {
                        val pct = (done * 100L / total).toInt()
                        mutateState { s -> s.copy(statusMessage = "Importing ${spec.label}: $pct% (${done / LiteRtLmModels.MIB} MB)") }
                    }
                }
            }
            copied.fold(
                onSuccess = {
                    val boot = runCatching { engine.load(spec) }
                    boot.fold(
                        onSuccess = {
                            mutateState { s ->
                                s.copy(
                                    isBusy = false,
                                    liteRtActive = true,
                                    liteRtModelLabel = "${spec.label} · ${engine.activeBackendLabel}",
                                    statusMessage = "Activated ${spec.label} on LiteRT-LM 0.18.0 (${engine.activeBackendLabel}).",
                                )
                            }
                        },
                        onFailure = { err ->
                            mutateState { s ->
                                s.copy(
                                    isBusy = false,
                                    statusMessage = "LiteRT-LM load failed: ${err.message}",
                                )
                            }
                        },
                    )
                },
                onFailure = { err ->
                    mutateState { s ->
                        s.copy(
                            isBusy = false,
                            statusMessage = "LiteRT-LM copy failed: ${err.message}",
                        )
                    }
                },
            )
        }
    }

    fun importTfliteUri(uri: Uri, displayName: String) {
        val engine = tfliteEngine ?: return
        mutateState { it.copy(isBusy = true, statusMessage = "Validating TFL3 v3 FlatBuffer & importing $displayName...") }
        scope.launch(Dispatchers.IO) {
            val imported = runCatching { engine.copyUriToModelsDir(uri) }
            imported.fold(
                onSuccess = { file ->
                    val loaded = runCatching { engine.loadFile(file) }
                    loaded.fold(
                        onSuccess = { record ->
                            val summary = engine.statusSummary()
                            mutateState { s ->
                                s.copy(
                                    isBusy = false,
                                    tfliteSummary = summary,
                                    statusMessage = "LiteRT 2.3.0 loaded ${file.name} on ${engine.activeBackendLabel} " +
                                        "(cached=${record.probedFromCache}).",
                                )
                            }
                        },
                        onFailure = { err ->
                            mutateState { s ->
                                s.copy(
                                    isBusy = false,
                                    tfliteSummary = engine.statusSummary(),
                                    statusMessage = "LiteRT 2.3.0 compile failed: ${err.message}",
                                )
                            }
                        },
                    )
                },
                onFailure = { err ->
                    mutateState { s ->
                        s.copy(
                            isBusy = false,
                            statusMessage = "LiteRT FlatBuffer validation failed: ${err.message}",
                        )
                    }
                },
            )
        }
    }

    fun resetLiteRtBackendCache() {
        tfliteEngine?.resetBackendCache()
        liteRtEngine?.resetBackendCache()
        mutateState {
            it.copy(
                tfliteSummary = tfliteEngine?.statusSummary()
                    ?: "LiteRT 2.3.0 backend cache cleared — GPU delegate will re-probe once on next load.",
                statusMessage = "Cleared cached LiteRT GPU/CPU backend — next load will probe GPU once and fall back to setNumThreads(4).",
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
                    val slotOk = if (slot == "stt") readiness.sttReady else (readiness.ttsReady && readiness.styleReady)
                    val detail = if (slot == "stt") readiness.sttMessage else readiness.ttsMessage
                    mutateState {
                        it.copy(
                            isBusy = false,
                            paths = paths,
                            readiness = readiness,
                            availableStyles = discoverAllStyles(File(paths.ttsModelDir)),
                            statusMessage = if (slotOk) "$label verified (${dir.name}) — activating..." else "$label incomplete — $detail",
                        )
                    }
                    if (slotOk) initialize()
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

    fun importModelArchiveUri(uri: Uri, slot: String) {
        val label = if (slot == "stt") "Parakeet STT" else "Supertonic TTS"
        mutateState { it.copy(isBusy = true, statusMessage = "Extracting $label .zip bundle...") }
        scope.launch(Dispatchers.IO) {
            val result = VoiceModelConfigStore.importModelArchiveDocument(appContext, uri, slot) { progress ->
                mutateState { s -> s.copy(statusMessage = progress) }
            }
            val paths = VoiceModelConfigStore.loadPaths(appContext)
            val readiness = VoiceModelConfigStore.validate(paths)
            result.fold(
                onSuccess = { dir ->
                    mutateState {
                        it.copy(
                            isBusy = false,
                            paths = paths,
                            readiness = readiness,
                            availableStyles = discoverAllStyles(File(paths.ttsModelDir)),
                            statusMessage = "$label .zip extracted (${dir.name}) — activating neural engine...",
                        )
                    }
                    initialize()
                },
                onFailure = { err ->
                    Log.e(TAG, "$label .zip archive import failed", err)
                    mutateState {
                        it.copy(
                            isBusy = false,
                            paths = paths,
                            readiness = readiness,
                            statusMessage = "$label .zip error: ${err.message}",
                        )
                    }
                }
            )
        }
    }

    /**
     * Boots whichever neural engines (`Parakeet TDT`, `llama.cpp`, `Supertonic ONNX`) currently
     * have verified files on disk. Non-installed slots automatically fall back to offline
     * Android STT/TTS and `HereticCore` / `LiteRT-LM`.
     */
    fun initialize(onComplete: ((Boolean) -> Unit)? = null) {
        val currentPaths = VoiceModelConfigStore.loadPaths(appContext)
        val readiness = VoiceModelConfigStore.validate(currentPaths)
        if (!readiness.llmReady && !readiness.sttReady && !(readiness.ttsReady && readiness.styleReady)) {
            mutateState {
                it.copy(
                    paths = currentPaths,
                    readiness = readiness,
                    isInitialized = false,
                    sttNeuralActive = false,
                    llmNeuralActive = false,
                    ttsNeuralActive = false,
                    statusMessage = "Running on built-in offline engine (${it.activeSttLabel} · ${it.activeBrainLabel} · ${it.activeTtsLabel}). Import .gguf or .zip packs anytime.",
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
                statusMessage = "Booting available neural engines (ARM64 ONNX + llama.cpp JNI)...",
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

            val snap = _state.value
            val created = UnifiedVoiceOrchestrator(
                context = appContext,
                sttModelDir = File(currentPaths.sttModelDir),
                ttsModelDir = File(currentPaths.ttsModelDir),
                llamaModelPath = currentPaths.llamaModelPath,
                voiceStylePath = currentPaths.voiceStylePath,
                audioPlayer = player,
                autoPlayAudioTrack = true,
            ).apply {
                voiceSpeed = snap.voiceSpeed
                diffusionSteps = snap.diffusionSteps
            }

            val summary = runCatching { created.initModular(readiness) }.getOrElse { e ->
                Log.e(TAG, "UnifiedVoiceOrchestrator.initModular() threw exception", e)
                NeuralBootSummary(false, false, false)
            }

            if (summary.anyLoaded) {
                synchronized(controllerLock) {
                    orchestrator = created
                    initializedPaths = currentPaths
                }
                val loadedNames = buildList {
                    if (summary.sttLoaded) add("Parakeet STT")
                    if (summary.llmLoaded) add("llama.cpp GGUF")
                    if (summary.ttsLoaded) add("Supertonic TTS")
                }
                mutateState {
                    it.copy(
                        isBusy = false,
                        isInitialized = summary.allLoaded,
                        sttNeuralActive = summary.sttLoaded,
                        llmNeuralActive = summary.llmLoaded,
                        ttsNeuralActive = summary.ttsLoaded,
                        availableStyles = discoverAllStyles(File(currentPaths.ttsModelDir)),
                        statusMessage = "Activated neural tiers: ${loadedNames.joinToString(" + ")}.",
                    )
                }
                onComplete?.invoke(true)
            } else {
                created.shutdown()
                mutateState {
                    it.copy(
                        isBusy = false,
                        isInitialized = false,
                        sttNeuralActive = false,
                        llmNeuralActive = false,
                        ttsNeuralActive = false,
                        statusMessage = "Neural init fell back to built-in offline engine — verify imported model files.",
                    )
                }
                onComplete?.invoke(false)
            }
        }
    }

    /**
     * Starts voice input immediately:
     * - Uses continuous hands-free Parakeet TDT + Silero VAD v6 if `sttNeuralActive`
     * - Otherwise uses on-device Android `SpeechRecognizer` (`EXTRA_PREFER_OFFLINE = true`)
     */
    fun startListening(): Boolean {
        if (!hereticCore.gates.granted("mic.capture")) {
            mutateState {
                it.copy(statusMessage = "Microphone blocked by Authorization Gate (mic.capture) — grant it in Gates tab.")
            }
            return false
        }
        if (!PermissionHelper.hasRecordPermission(appContext)) {
            onRequestRecordPermission?.invoke()
            mutateState {
                it.copy(statusMessage = "Microphone permission required — grant RECORD_AUDIO to speak.")
            }
            return false
        }

        val active = synchronized(controllerLock) { orchestrator }
        if (active != null && active.sttLoaded) {
            active.startHandsFreeCapture(
                onUtterance = { transcript ->
                    handleSpokenOrTypedTurn(transcript, fromMic = true)
                },
                onBargeIn = {
                    platformVoice?.stop()
                    mutateState { it.copy(statusMessage = "VAD barge-in detected — audio flushed, listening...") }
                },
                onError = { err ->
                    mutateState { it.copy(isListening = false, statusMessage = "Parakeet STT error: $err") }
                },
            )
            mutateState {
                it.copy(
                    isListening = true,
                    statusMessage = "Hands-free Parakeet TDT + Silero VAD v6 listening (say \"shaz\" anytime to stop).",
                )
            }
            return true
        }

        val pv = platformVoice
        if (pv != null) {
            stopPlayback()
            mutateState {
                it.copy(
                    isListening = true,
                    statusMessage = "Listening via offline Android SpeechRecognizer...",
                )
            }
            var finalHandled = false
            pv.startListening(
                onResult = { transcript ->
                    val clean = transcript.trim()
                    if (clean.isNotEmpty() && !finalHandled) {
                        finalHandled = true
                        mutateState { it.copy(isListening = false) }
                        handleSpokenOrTypedTurn(clean, fromMic = true)
                    }
                },
                onError = { err ->
                    mutateState {
                        it.copy(
                            isListening = false,
                            statusMessage = "Speech recognition ended ($err) — import parakeet-tdt-stt-models.zip for continuous hands-free STT.",
                        )
                    }
                },
            )
            return true
        }

        mutateState {
            it.copy(statusMessage = "Import parakeet-tdt-stt-models.zip in Models tab to enable microphone capture.")
        }
        return false
    }

    fun stopListening() {
        synchronized(controllerLock) { orchestrator }?.stopListening()
        platformVoice?.stop()
        mutateState {
            it.copy(
                isListening = false,
                statusMessage = "Microphone capture stopped.",
            )
        }
    }

    /**
     * Immediate `"shaz"` / emergency barge-in stop: pauses & flushes [PcmStreamingAudioPlayer],
     * halts `llama.cpp`, `SupertonicTTS`, and `VoiceManager` TTS.
     */
    fun stopPlayback() {
        synchronized(controllerLock) { orchestrator }?.stopPlayback()
        platformVoice?.stop()
        mutateState {
            it.copy(
                isPlaying = false,
                statusMessage = "SHAZ · Playback paused & flushed immediately.",
            )
        }
    }

    fun speakPrompt(prompt: String) {
        handleSpokenOrTypedTurn(prompt, fromMic = false)
    }

    fun speakTextAloud(text: String) {
        if (!hereticCore.gates.granted("tts.speak")) {
            mutateState { it.copy(statusMessage = "Audible output muted by Gate (tts.speak).") }
            return
        }
        val active = synchronized(controllerLock) { orchestrator }
        if (active != null && active.ttsLoaded) {
            active.speakDirectText(
                text = text,
                fallbackSpeak = { platformVoice?.speak(it) },
            )
        } else {
            platformVoice?.speak(text)
        }
    }

    fun clearConversation() {
        mutateState {
            it.copy(
                conversation = emptyList(),
                transcriptHistory = emptyList(),
                statusMessage = "Cleared conversation history.",
            )
        }
    }

    private fun handleSpokenOrTypedTurn(rawInput: String, fromMic: Boolean) {
        val trimmed = rawInput.trim()
        if (trimmed.isEmpty()) return

        if (VoiceActionRouter.isImmediateStop(trimmed)) {
            stopPlayback()
            appendTurn("you", if (fromMic) "MIC" else "YOU", trimmed)
            appendTurn("action", "SHAZ INTERRUPT", "Playback halted and AudioTrack flushed immediately.")
            return
        }

        appendTurn("you", if (fromMic) "VOICE" else "YOU", trimmed)

        val routed: RoutedAssistantResult? = VoiceActionRouter.tryExecuteCommand(
            rawInput = trimmed,
            core = hereticCore,
            milestonesProvider = { _state.value.milestones },
            onUpdateMilestones = { updateMilestones(it) },
            onSaveLastWav = { saveLastSynthesizedWav() },
            onAddLexiconRule = { word, rep -> addLexiconRule(word, rep) },
            systemSummaryProvider = { buildSystemDiagnosticReport() },
        )

        if (routed != null) {
            if (routed.kind == AssistantActionKind.STOP_PLAYBACK) {
                stopPlayback()
                return
            }
            appendTurn(
                role = "action",
                badge = "ACTION · ${routed.kind.name.replace('_', ' ')}",
                text = routed.displayReply,
                spoken = routed.spokenReply,
            )
            mutateState {
                it.copy(
                    lastErrorAnalysis = routed.errorAnalysis ?: it.lastErrorAnalysis,
                    lastSolutionConfirmation = routed.solutionConfirmation ?: it.lastSolutionConfirmation,
                    lastFileAssessment = routed.fileAssessment ?: it.lastFileAssessment,
                    requestedTab = routed.targetTab,
                    statusMessage = "Executed ${routed.kind.name.lowercase().replace('_', ' ')}.",
                )
            }
            if (routed.spokenReply.isNotBlank()) {
                speakTextAloud(routed.spokenReply)
            }
            return
        }

        // Open-ended assistant turn -> 1) llama.cpp GGUF, 2) LiteRT-LM, 3) HereticCore
        val active = synchronized(controllerLock) { orchestrator }
        if (active != null && active.llmLoaded) {
            val turnId = turnSeq++
            val placeholder = AssistantTurn(
                id = turnId,
                role = "heretic",
                badge = "LLAMA.CPP",
                text = "…",
            )
            mutateState { prev ->
                prev.copy(
                    conversation = (prev.conversation + placeholder).takeLast(MAX_CONVERSATION_TURNS),
                    statusMessage = "Streaming response via llama.cpp -> ${prev.activeTtsLabel}...",
                )
            }
            val accumulated = StringBuilder()
            active.speakPrompt(
                prompt = trimmed,
                onAssistantSentence = { sentence ->
                    if (accumulated.isNotEmpty()) accumulated.append(' ')
                    accumulated.append(sentence)
                    val fullSoFar = accumulated.toString()
                    mutateState { prev ->
                        val updatedConv = prev.conversation.map { t ->
                            if (t.id == turnId) t.copy(text = fullSoFar, spokenText = fullSoFar) else t
                        }
                        val nextHist = (prev.transcriptHistory + "Heretic: $sentence").takeLast(MAX_TRANSCRIPT_HISTORY)
                        prev.copy(
                            lastAssistantSentence = sentence,
                            transcriptHistory = nextHist,
                            conversation = updatedConv,
                        )
                    }
                },
                fallbackSpeakSentence = { sentence ->
                    if (hereticCore.gates.granted("tts.speak")) {
                        platformVoice?.speak(sentence)
                    }
                },
            )
            return
        }

        val lrt = liteRtEngine
        if (lrt != null && _state.value.liteRtActive) {
            mutateState { it.copy(statusMessage = "Generating reply on LiteRT-LM (${it.liteRtModelLabel})...") }
            scope.launch(Dispatchers.IO) {
                val replyResult = runCatching { lrt.generate(trimmed) }
                val text = replyResult.getOrElse { "LiteRT-LM error: ${it.message}" }
                withContext(Dispatchers.Main.immediate) {
                    appendTurn("heretic", "LITERT-LM", text, spoken = text)
                    mutateState { it.copy(statusMessage = "Reply ready (${it.liteRtModelLabel}).") }
                    speakTextAloud(text)
                }
            }
            return
        }

        val coreReply = hereticCore.reply(trimmed)
        appendTurn(
            role = "heretic",
            badge = "HERETIC CORE · ${coreReply.intent.name}",
            text = coreReply.text,
            spoken = coreReply.speak,
        )
        mutateState {
            it.copy(
                lastAssistantSentence = coreReply.speak,
                statusMessage = "Answered via HereticCore (${(coreReply.confidence * 100).toInt()}% confidence).",
            )
        }
        speakTextAloud(coreReply.speak)
    }

    private fun appendTurn(role: String, badge: String, text: String, spoken: String = "") {
        val entryHist = "${if (role == "you") "You" else "Heretic"}: $text"
        val turn = AssistantTurn(
            id = turnSeq++,
            role = role,
            badge = badge,
            text = text,
            spokenText = spoken,
        )
        mutateState { prev ->
            prev.copy(
                lastUserTranscript = if (role == "you") text else prev.lastUserTranscript,
                transcriptHistory = (prev.transcriptHistory + entryHist).takeLast(MAX_TRANSCRIPT_HISTORY),
                conversation = (prev.conversation + turn).takeLast(MAX_CONVERSATION_TURNS),
            )
        }
    }

    private fun buildSystemDiagnosticReport(): Pair<String, String> {
        val snap = _state.value
        val ramMb = liteRtEngine?.totalRamBytes()?.let { it / 1_048_576L } ?: 0L
        val freeMb = (appContext.filesDir.usableSpace / 1_048_576L)
        val abi = Build.SUPPORTED_ABIS.firstOrNull() ?: "arm64-v8a"
        val brokenIdx = hereticCore.gates.verify()
        val display = buildString {
            appendLine("DEVICE -> ${Build.MANUFACTURER} ${Build.MODEL} · Android API ${Build.VERSION.SDK_INT} ($abi)")
            appendLine("MEMORY -> ${ramMb} MB RAM · ${freeMb} MB free internal storage")
            appendLine("ACTIVE STT   -> ${snap.activeSttLabel}")
            appendLine("ACTIVE BRAIN -> ${snap.activeBrainLabel}")
            appendLine("ACTIVE TTS   -> ${snap.activeTtsLabel}")
            appendLine("LITERT 2.3.0 -> ${snap.tfliteSummary}")
            appendLine("SILERO VAD   -> Bundled in APK assets/silero_vad.onnx (v6)")
            appendLine("PRIVACY      -> INTERNET permission = false · Background services = 0")
            append("GATE LEDGER  -> ${if (brokenIdx == -1) "SHA-256 chain intact" else "Broken at $brokenIdx"}")
        }
        val spoken = "Running on ${Build.MODEL}, ABI $abi, with $freeMb megabytes free storage. " +
            "Active speech engine is ${snap.activeSttLabel}, brain is ${snap.activeBrainLabel}, and voice output is ${snap.activeTtsLabel}. " +
            "Internet permission is physically absent."
        return display to spoken
    }

    fun onRecordPermissionResult(granted: Boolean) {
        if (granted) {
            mutateState { it.copy(statusMessage = "Microphone permission granted — starting voice capture...") }
            startListening()
        } else {
            mutateState { it.copy(statusMessage = "Microphone permission denied — grant RECORD_AUDIO to use voice.") }
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
                sttNeuralActive = false,
                llmNeuralActive = false,
                ttsNeuralActive = false,
                isListening = false,
                isPlaying = false,
            )
        }
    }

    private fun buildTierStatusSummary(r: VoiceModelReadiness): String = when {
        r.allReady -> "All 3 neural packs verified on disk (GGUF + Parakeet STT + Supertonic TTS)."
        r.llmReady || r.sttReady || (r.ttsReady && r.styleReady) ->
            "Hybrid mode active — verified neural packs run alongside built-in offline fallbacks."
        else ->
            "Voice Assistant ready offline. Import .gguf / STT .zip / TTS .zip in Models tab to upgrade."
    }

    private fun discoverAllStyles(ttsDir: File): List<File> {
        val resolved = VoiceModelConfigStore.findValidSlotRoot("tts", ttsDir, maxDepth = 3) ?: ttsDir
        val dirs = listOfNotNull(
            File(resolved, "voice_styles"),
            resolved.parentFile?.let { File(it, "voice_styles") },
        )
        for (dir in dirs) {
            if (!dir.isDirectory) continue
            val styles = dir.listFiles()
                ?.filter { it.isFile && it.extension.equals("json", ignoreCase = true) }
                ?.sortedBy { it.name }
                .orEmpty()
            if (styles.isNotEmpty()) return styles
        }
        return emptyList()
    }

    private fun listSavedWavFiles(): List<File> {
        val dir = File(appContext.filesDir, "saved_audio")
        if (!dir.isDirectory) return emptyList()
        return dir.listFiles()
            ?.filter { it.isFile && it.extension.equals("wav", ignoreCase = true) }
            ?.sortedByDescending { it.lastModified() }
            .orEmpty()
    }

    private fun loadPersistedMilestones(): List<MilestoneItem> {
        val prefs = appContext.getSharedPreferences(PREFS_ASSISTANT, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_MILESTONES, null)
        if (!raw.isNullOrBlank()) {
            val parsed = runCatching {
                val arr = JSONArray(raw)
                (0 until arr.length()).map { idx ->
                    val o = arr.getJSONObject(idx)
                    MilestoneItem(
                        title = o.getString("title"),
                        kind = MilestoneKind.valueOf(o.getString("kind")),
                        done = o.getBoolean("done"),
                    )
                }
            }.getOrNull()
            if (!parsed.isNullOrEmpty()) return parsed
        }
        return listOf(
            MilestoneItem("Native Jetpack Compose Heretic Voice Assistant shell", MilestoneKind.IMPLEMENT_NOW, true),
            MilestoneItem("ARM64 llama.cpp JNI + SentenceStreamingBuffer", MilestoneKind.IMPLEMENT_NOW, true),
            MilestoneItem("Parakeet TDT STT + built-in Silero VAD v6", MilestoneKind.IMPLEMENT_NOW, true),
            MilestoneItem("Supertonic ONNX TTS + low-latency AudioTrack shaz barge-in", MilestoneKind.IMPLEMENT_NOW, true),
            MilestoneItem("SAF .gguf / .litertlm / .zip offline model importer", MilestoneKind.IMPLEMENT_NOW, true),
            MilestoneItem("Optional Vulkan / NPU custom op acceleration", MilestoneKind.DEFER, false),
        )
    }

    private fun persistMilestones(items: List<MilestoneItem>) {
        val arr = JSONArray()
        for (item in items) {
            arr.put(
                JSONObject().apply {
                    put("title", item.title)
                    put("kind", item.kind.name)
                    put("done", item.done)
                }
            )
        }
        appContext.getSharedPreferences(PREFS_ASSISTANT, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_MILESTONES, arr.toString())
            .apply()
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
