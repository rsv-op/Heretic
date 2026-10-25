package com.heretic.voice

import android.content.Context
import android.util.Log
import com.brahmadeo.supertonic.tts.SupertonicTTS
import com.brahmadeo.supertonic.tts.utils.LexiconManager
import com.brahmadeo.supertonic.tts.utils.TextNormalizer
import com.brahmadeo.supertonic.tts.utils.WavUtils
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.schabi.parakeetype.audio.AudioCaptureManager
import org.schabi.parakeetype.audio.SpeechEndpointer
import org.schabi.parakeetype.inference.InferenceRepository
import org.schabi.parakeetype.inference.ParakeetEngine
import org.schabi.parakeetype.inference.TranscriptResult
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.atomic.AtomicLong

data class NeuralBootSummary(
    val sttLoaded: Boolean,
    val llmLoaded: Boolean,
    val ttsLoaded: Boolean,
) {
    val anyLoaded: Boolean get() = sttLoaded || llmLoaded || ttsLoaded
    val allLoaded: Boolean get() = sttLoaded && llmLoaded && ttsLoaded
}

class UnifiedVoiceOrchestrator(
    private val context: Context,
    private val sttModelDir: File,
    private val ttsModelDir: File,
    private val llamaModelPath: String,
    @Volatile var voiceStylePath: String,
    val audioPlayer: PcmStreamingAudioPlayer = PcmStreamingAudioPlayer(),
    private val autoPlayAudioTrack: Boolean = true,
) {
    companion object {
        private const val TAG = "UnifiedVoiceOrchestrator"
        private const val STOP_KEYWORD = "shaz"
        private const val ENDPOINTER_SILENCE_MS = 1200L
        private const val ENDPOINTER_MIN_LENGTH_MS = 256L
        private const val DEFAULT_LLAMA_THREADS = 4
        private const val DEFAULT_LLAMA_CTX = 2048
        private const val DEFAULT_ORT_THREADS = 4
        private const val DEFAULT_XNN_THREADS = 1
        private const val TTS_LANG = "en"
        private const val TTS_GAIN = 2.5f
        private const val TTS_SIBILANCE_MODE = 1

        internal fun matchesStopKeyword(transcript: String): Boolean {
            val stripped = transcript.trim().trim { !it.isLetterOrDigit() }.trim()
            if (stripped.isEmpty()) return false
            return stripped.equals(STOP_KEYWORD, ignoreCase = true) ||
                stripped.startsWith("$STOP_KEYWORD ", ignoreCase = true) ||
                stripped.endsWith(" $STOP_KEYWORD", ignoreCase = true)
        }
    }

    private val appContext = context.applicationContext
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private val pipelineMutex = Mutex()
    private val generationCounter = AtomicLong(0L)
    private val lastAudioLock = Any()

    private val textNormalizer = TextNormalizer()
    private val captureManager = AudioCaptureManager(appContext)
    private val parakeetEngine = ParakeetEngine()
    private val inferenceRepo = InferenceRepository(parakeetEngine)
    private val llamaEngine = LlamaCppEngine()

    @Volatile
    var voiceSpeed: Float = 1.05f

    @Volatile
    var diffusionSteps: Int = 5

    @Volatile
    var sttLoaded: Boolean = false
        private set

    @Volatile
    var llmLoaded: Boolean = false
        private set

    @Volatile
    var ttsLoaded: Boolean = false
        private set

    @Volatile
    private var isSynthesizing = false

    @Volatile
    private var isShutdown = false

    private var lastTurnPcm: ByteArray? = null
    private var lastTurnSampleRate: Int = 44_100

    private var captureJob: Job? = null
    private var currentGenJob: Job? = null

    val isSpeaking: Boolean
        get() = isSynthesizing || audioPlayer.isPlaying

    val isListening: Boolean
        get() = captureJob?.isActive == true

    /**
     * Modular initializer: loads whichever of Parakeet TDT STT, Supertonic ONNX TTS, and
     * `llama.cpp` GGUF have valid model files on disk so each engine works independently.
     */
    suspend fun initModular(readiness: VoiceModelReadiness): NeuralBootSummary = withContext(Dispatchers.IO) {
        check(!isShutdown) { "UnifiedVoiceOrchestrator has already been shut down" }

        LexiconManager.load(appContext)

        sttLoaded = if (readiness.sttReady) {
            try {
                if (!parakeetEngine.isLoaded) {
                    parakeetEngine.load(sttModelDir)
                }
                parakeetEngine.isLoaded
            } catch (e: Exception) {
                Log.e(TAG, "ParakeetEngine failed to load from ${sttModelDir.absolutePath}", e)
                false
            }
        } else {
            false
        }

        ttsLoaded = if (readiness.ttsReady && readiness.styleReady) {
            val libPath = File(appContext.applicationInfo.nativeLibraryDir, "libonnxruntime.so").absolutePath
            val ok = SupertonicTTS.initialize(
                ttsModelDir.absolutePath,
                libPath,
                DEFAULT_ORT_THREADS,
                DEFAULT_XNN_THREADS,
            )
            if (!ok) {
                Log.e(TAG, "SupertonicTTS failed to initialize from ${ttsModelDir.absolutePath}")
            }
            ok
        } else {
            false
        }

        llmLoaded = if (readiness.llmReady) {
            val ok = llamaEngine.load(
                modelPath = llamaModelPath,
                nThreads = DEFAULT_LLAMA_THREADS,
                nCtx = DEFAULT_LLAMA_CTX,
            )
            if (!ok) {
                Log.e(TAG, "LlamaCppEngine failed to load model from $llamaModelPath")
            }
            ok
        } else {
            false
        }

        NeuralBootSummary(
            sttLoaded = sttLoaded,
            llmLoaded = llmLoaded,
            ttsLoaded = ttsLoaded,
        )
    }

    suspend fun init(): Boolean {
        val readiness = VoiceModelConfigStore.validate(
            VoiceModelPaths(
                llamaModelPath = llamaModelPath,
                sttModelDir = sttModelDir.absolutePath,
                ttsModelDir = ttsModelDir.absolutePath,
                voiceStylePath = voiceStylePath,
            )
        )
        return initModular(readiness).allLoaded
    }

    /**
     * Starts continuous hands-free Parakeet TDT + Silero VAD v6 capture.
     * Invokes [onUtterance] on every finalized spoken transcript so the caller can route
     * voice commands, `"shaz"` interrupts, or LLM turns uniformly.
     */
    fun startHandsFreeCapture(
        onUtterance: (String) -> Unit,
        onBargeIn: () -> Unit = {},
        onError: (String) -> Unit = {},
    ) {
        if (isShutdown || !sttLoaded) {
            onError("Parakeet TDT STT is not loaded")
            return
        }

        captureManager.stopCapture()
        captureJob?.cancel()

        captureJob = scope.launch(Dispatchers.IO) {
            var endpointer = newSpeechEndpointer()

            val audioFlow = captureManager.startCapture(
                vadEnabled = true,
                onSpeechProbability = { prob ->
                    when (endpointer.onFrame(prob)) {
                        SpeechEndpointer.Event.SpeechStart -> {
                            if (isSpeaking) {
                                Log.i(TAG, "VAD speech start detected during TTS playback; executing barge-in stop")
                                stopPlayback()
                                onBargeIn()
                            }
                        }
                        SpeechEndpointer.Event.EndOfSpeech,
                        SpeechEndpointer.Event.NoSpeech -> {
                            endpointer = newSpeechEndpointer()
                        }
                        null -> Unit
                    }
                }
            )

            try {
                inferenceRepo.transcribe(audioFlow).collect { result ->
                    when (result) {
                        is TranscriptResult.Final -> {
                            val userText = result.text.trim()
                            if (userText.isBlank()) return@collect
                            if (matchesStopKeyword(userText)) {
                                stopPlayback()
                            }
                            onUtterance(userText)
                        }
                        is TranscriptResult.Failure -> {
                            Log.w(TAG, "STT stream reported failure", result.cause)
                            onError(result.cause.message ?: "STT inference failure")
                        }
                        else -> Unit
                    }
                }
            } catch (ce: CancellationException) {
                throw ce
            } catch (e: SecurityException) {
                Log.e(TAG, "RECORD_AUDIO permission missing while starting audio capture", e)
                onError("RECORD_AUDIO permission required")
            } catch (e: Exception) {
                Log.e(TAG, "Unexpected exception inside STT listening loop", e)
                onError(e.message ?: "Microphone capture error")
            }
        }
    }

    fun startListening(
        onFinalTranscript: (String) -> Unit,
        onTtsChunk: (ByteArray) -> Unit = {},
    ) {
        startHandsFreeCapture(
            onUtterance = { userText ->
                onFinalTranscript(userText)
                if (!matchesStopKeyword(userText)) {
                    speakPrompt(userText, onTtsChunk = onTtsChunk)
                }
            }
        )
    }

    fun stopListening() {
        captureManager.stopCapture()
        captureJob?.cancel()
        captureJob = null
    }

    /**
     * Synthesizes and plays an already-computed reply (e.g. from `VoiceActionRouter`,
     * `LiteRtLmEngine`, or `HereticCore`) via Supertonic ONNX -> AudioTrack if loaded,
     * otherwise delegates to [fallbackSpeak].
     */
    fun speakDirectText(
        text: String,
        fallbackSpeak: (String) -> Unit = {},
        onTtsChunk: (ByteArray) -> Unit = {},
    ) {
        val trimmed = text.trim()
        if (trimmed.isEmpty() || isShutdown) return
        if (!ttsLoaded) {
            fallbackSpeak(trimmed)
            return
        }

        val turnId = generationCounter.incrementAndGet()
        llamaEngine.stop()
        SupertonicTTS.setCancelled(true)
        audioPlayer.stopImmediate()
        currentGenJob?.cancel()

        currentGenJob = scope.launch(Dispatchers.IO) {
            pipelineMutex.withLock {
                if (!currentCoroutineContext().isActive || generationCounter.get() != turnId) {
                    return@withLock
                }
                isSynthesizing = true
                val pcmCollector = ByteArrayOutputStream()
                try {
                    SupertonicTTS.reset()
                    SupertonicTTS.setCancelled(false)
                    synthesizeAndPlaySentence(trimmed, turnId, pcmCollector, onTtsChunk)
                    val allBytes = pcmCollector.toByteArray()
                    if (allBytes.isNotEmpty() && generationCounter.get() == turnId) {
                        synchronized(lastAudioLock) {
                            lastTurnPcm = allBytes
                            lastTurnSampleRate = SupertonicTTS.getAudioSampleRate()
                        }
                    }
                } finally {
                    if (generationCounter.get() == turnId) {
                        isSynthesizing = false
                    }
                }
            }
        }
    }

    /**
     * Streams a conversational prompt through `llama.cpp` -> [SentenceStreamingBuffer] ->
     * Supertonic ONNX TTS (or [fallbackSpeakSentence] when Supertonic isn't loaded yet).
     */
    fun speakPrompt(
        prompt: String,
        onAssistantSentence: (String) -> Unit = {},
        onTtsChunk: (ByteArray) -> Unit = {},
        fallbackSpeakSentence: (String) -> Unit = {},
    ) {
        val trimmed = prompt.trim()
        if (trimmed.isEmpty() || isShutdown) return
        if (matchesStopKeyword(trimmed)) {
            stopPlayback()
            return
        }
        runLlamaPipeline(trimmed, onTtsChunk, onAssistantSentence, fallbackSpeakSentence)
    }

    private fun runLlamaPipeline(
        prompt: String,
        onTtsChunk: (ByteArray) -> Unit,
        onAssistantSentence: (String) -> Unit,
        fallbackSpeakSentence: (String) -> Unit,
    ) {
        val turnId = generationCounter.incrementAndGet()

        llamaEngine.stop()
        SupertonicTTS.setCancelled(true)
        audioPlayer.stopImmediate()
        currentGenJob?.cancel()

        currentGenJob = scope.launch(Dispatchers.IO) {
            pipelineMutex.withLock {
                if (!currentCoroutineContext().isActive || generationCounter.get() != turnId) {
                    return@withLock
                }

                isSynthesizing = true
                val pcmCollector = ByteArrayOutputStream()

                val sentenceBuffer = SentenceStreamingBuffer { sentence ->
                    if (!currentCoroutineContext().isActive ||
                        generationCounter.get() != turnId
                    ) {
                        return@SentenceStreamingBuffer
                    }

                    onAssistantSentence(sentence)

                    if (ttsLoaded) {
                        if (!SupertonicTTS.isCancelled()) {
                            synthesizeAndPlaySentence(sentence, turnId, pcmCollector, onTtsChunk)
                        }
                    } else {
                        fallbackSpeakSentence(sentence)
                    }
                }

                try {
                    if (ttsLoaded) {
                        SupertonicTTS.reset()
                        SupertonicTTS.setCancelled(false)
                    }

                    val pipelineJob = currentCoroutineContext()[Job]
                    llamaEngine.generate(prompt) { token ->
                        if (pipelineJob?.isActive == false ||
                            (ttsLoaded && SupertonicTTS.isCancelled()) ||
                            generationCounter.get() != turnId
                        ) {
                            false
                        } else {
                            runBlocking {
                                sentenceBuffer.appendPiece(token)
                            }
                            (!ttsLoaded || !SupertonicTTS.isCancelled()) &&
                                pipelineJob?.isActive != false &&
                                generationCounter.get() == turnId
                        }
                    }

                    if (currentCoroutineContext().isActive &&
                        (!ttsLoaded || !SupertonicTTS.isCancelled()) &&
                        generationCounter.get() == turnId
                    ) {
                        sentenceBuffer.flush()
                        val bytes = pcmCollector.toByteArray()
                        if (bytes.isNotEmpty()) {
                            synchronized(lastAudioLock) {
                                lastTurnPcm = bytes
                                lastTurnSampleRate = SupertonicTTS.getAudioSampleRate()
                            }
                        }
                    } else {
                        sentenceBuffer.clear()
                    }
                } catch (ce: CancellationException) {
                    sentenceBuffer.clear()
                    throw ce
                } catch (e: Exception) {
                    sentenceBuffer.clear()
                    Log.e(TAG, "Error during LLM->TTS streaming pipeline", e)
                } finally {
                    if (generationCounter.get() == turnId) {
                        isSynthesizing = false
                    }
                }
            }
        }
    }

    private fun synthesizeAndPlaySentence(
        sentence: String,
        turnId: Long,
        pcmCollector: ByteArrayOutputStream,
        onTtsChunk: (ByteArray) -> Unit,
    ) {
        val withLexicon = LexiconManager.apply(sentence)
        val normalized = textNormalizer.normalize(withLexicon, TTS_LANG, false).trim()
        if (normalized.isEmpty()) return

        val audio = SupertonicTTS.generateAudio(
            text = normalized,
            lang = TTS_LANG,
            stylePath = voiceStylePath,
            speed = voiceSpeed.coerceIn(0.75f, 1.5f),
            steps = diffusionSteps.coerceIn(2, 10),
            gain = TTS_GAIN,
            sibilanceMode = TTS_SIBILANCE_MODE,
        )

        if (audio != null &&
            audio.isNotEmpty() &&
            !SupertonicTTS.isCancelled() &&
            generationCounter.get() == turnId
        ) {
            pcmCollector.write(audio)
            if (autoPlayAudioTrack) {
                audioPlayer.enqueueChunk(audio, SupertonicTTS.getAudioSampleRate())
            }
            onTtsChunk(audio)
        }
    }

    fun exportLastWav(destFile: File): Result<File> = runCatching {
        val (pcm, sr) = synchronized(lastAudioLock) {
            val data = lastTurnPcm ?: error("Synthesize at least one Supertonic TTS reply before exporting WAV")
            data to lastTurnSampleRate
        }
        WavUtils.saveWav(destFile, pcm, sampleRate = sr)
        destFile
    }

    fun stopPlayback() {
        generationCounter.incrementAndGet()
        llamaEngine.stop()
        SupertonicTTS.setCancelled(true)
        audioPlayer.stopImmediate()
        currentGenJob?.cancel()
        currentGenJob = null
        isSynthesizing = false
    }

    fun shutdown() {
        if (isShutdown) return
        isShutdown = true

        stopPlayback()
        stopListening()
        audioPlayer.release()
        scope.cancel()

        try {
            parakeetEngine.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing ParakeetEngine", e)
        }

        try {
            SupertonicTTS.release()
        } catch (e: Exception) {
            Log.w(TAG, "Error releasing SupertonicTTS", e)
        }

        try {
            llamaEngine.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing LlamaCppEngine", e)
        }
    }

    private fun newSpeechEndpointer(): SpeechEndpointer =
        SpeechEndpointer(
            silenceMs = ENDPOINTER_SILENCE_MS,
            minimumLengthMs = ENDPOINTER_MIN_LENGTH_MS,
        )
}
