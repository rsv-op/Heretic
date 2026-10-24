package com.heretic.voice

import android.content.Context
import android.util.Log
import com.brahmadeo.supertonic.tts.SupertonicTTS
import com.brahmadeo.supertonic.tts.utils.LexiconManager
import com.brahmadeo.supertonic.tts.utils.TextNormalizer
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
import java.io.File
import java.util.concurrent.atomic.AtomicLong

class UnifiedVoiceOrchestrator(
    private val context: Context,
    private val sttModelDir: File,
    private val ttsModelDir: File,
    private val llamaModelPath: String,
    private val voiceStylePath: String
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
        private const val TTS_SPEED = 1.05f
        private const val TTS_STEPS = 5
        private const val TTS_GAIN = 2.5f
        private const val TTS_SIBILANCE_MODE = 1
    }

    private val appContext = context.applicationContext
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private val pipelineMutex = Mutex()
    private val generationCounter = AtomicLong(0L)

    private val textNormalizer = TextNormalizer()
    private val captureManager = AudioCaptureManager(appContext)
    private val parakeetEngine = ParakeetEngine()
    private val inferenceRepo = InferenceRepository(parakeetEngine)
    private val llamaEngine = LlamaCppEngine()

    @Volatile
    private var isSpeaking = false

    @Volatile
    private var isShutdown = false

    private var captureJob: Job? = null
    private var currentGenJob: Job? = null

    suspend fun init(): Boolean = withContext(Dispatchers.IO) {
        check(!isShutdown) { "UnifiedVoiceOrchestrator has already been shut down" }

        LexiconManager.load(appContext)

        if (!parakeetEngine.isLoaded) {
            parakeetEngine.load(sttModelDir)
        }

        val libPath = File(appContext.applicationInfo.nativeLibraryDir, "libonnxruntime.so").absolutePath
        val ttsReady = SupertonicTTS.initialize(
            ttsModelDir.absolutePath,
            libPath,
            DEFAULT_ORT_THREADS,
            DEFAULT_XNN_THREADS
        )
        if (!ttsReady) {
            Log.e(TAG, "SupertonicTTS failed to initialize from ${ttsModelDir.absolutePath}")
        }

        val llmReady = llamaEngine.load(
            modelPath = llamaModelPath,
            nThreads = DEFAULT_LLAMA_THREADS,
            nCtx = DEFAULT_LLAMA_CTX
        )
        if (!llmReady) {
            Log.e(TAG, "LlamaCppEngine failed to load model from $llamaModelPath")
        }

        parakeetEngine.isLoaded && ttsReady && llmReady
    }

    fun startListening(
        onFinalTranscript: (String) -> Unit,
        onTtsChunk: (ByteArray) -> Unit
    ) {
        if (isShutdown) {
            Log.w(TAG, "Ignoring startListening(): orchestrator is shut down")
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
                                Log.i(TAG, "VAD speech start detected during TTS; stopping playback")
                                stopPlayback()
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
                            if (userText.isBlank()) {
                                return@collect
                            }

                            onFinalTranscript(userText)

                            if (isStopCommand(userText)) {
                                Log.i(TAG, "Stop keyword detected in transcript; halting playback")
                                stopPlayback()
                                return@collect
                            }

                            runPipeline(userText, onTtsChunk)
                        }
                        is TranscriptResult.Failure -> {
                            Log.w(TAG, "STT stream reported failure", result.cause)
                        }
                        else -> Unit
                    }
                }
            } catch (ce: CancellationException) {
                throw ce
            } catch (e: SecurityException) {
                Log.e(TAG, "RECORD_AUDIO permission missing while starting audio capture", e)
            } catch (e: Exception) {
                Log.e(TAG, "Unexpected exception inside STT listening loop", e)
            }
        }
    }

    fun stopListening() {
        captureManager.stopCapture()
        captureJob?.cancel()
        captureJob = null
    }

    private fun runPipeline(prompt: String, onTtsChunk: (ByteArray) -> Unit) {
        val turnId = generationCounter.incrementAndGet()

        // Signal any in-flight LLM decode or TTS synthesis to abort immediately
        llamaEngine.stop()
        SupertonicTTS.setCancelled(true)
        currentGenJob?.cancel()

        currentGenJob = scope.launch(Dispatchers.IO) {
            pipelineMutex.withLock {
                if (!currentCoroutineContext().isActive || generationCounter.get() != turnId) {
                    return@withLock
                }

                isSpeaking = true
                val sentenceBuffer = SentenceStreamingBuffer { sentence ->
                    if (!currentCoroutineContext().isActive ||
                        SupertonicTTS.isCancelled() ||
                        generationCounter.get() != turnId
                    ) {
                        return@SentenceStreamingBuffer
                    }

                    val normalized = textNormalizer.normalize(sentence, TTS_LANG, false).trim()
                    if (normalized.isEmpty()) {
                        return@SentenceStreamingBuffer
                    }

                    val audio = SupertonicTTS.generateAudio(
                        text = normalized,
                        lang = TTS_LANG,
                        stylePath = voiceStylePath,
                        speed = TTS_SPEED,
                        steps = TTS_STEPS,
                        gain = TTS_GAIN,
                        sibilanceMode = TTS_SIBILANCE_MODE
                    )

                    if (audio != null &&
                        audio.isNotEmpty() &&
                        !SupertonicTTS.isCancelled() &&
                        currentCoroutineContext().isActive &&
                        generationCounter.get() == turnId
                    ) {
                        onTtsChunk(audio)
                    }
                }

                try {
                    SupertonicTTS.reset()
                    SupertonicTTS.setCancelled(false)

                    val pipelineJob = currentCoroutineContext()[Job]
                    llamaEngine.generate(prompt) { token ->
                        if (pipelineJob?.isActive == false ||
                            SupertonicTTS.isCancelled() ||
                            generationCounter.get() != turnId
                        ) {
                            false
                        } else {
                            runBlocking {
                                sentenceBuffer.appendPiece(token)
                            }
                            !SupertonicTTS.isCancelled() &&
                                pipelineJob?.isActive != false &&
                                generationCounter.get() == turnId
                        }
                    }

                    if (currentCoroutineContext().isActive &&
                        !SupertonicTTS.isCancelled() &&
                        generationCounter.get() == turnId
                    ) {
                        sentenceBuffer.flush()
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
                        isSpeaking = false
                    }
                }
            }
        }
    }

    fun stopPlayback() {
        generationCounter.incrementAndGet()
        llamaEngine.stop()
        SupertonicTTS.setCancelled(true)
        currentGenJob?.cancel()
        currentGenJob = null
        isSpeaking = false
    }

    fun shutdown() {
        if (isShutdown) return
        isShutdown = true

        stopPlayback()
        stopListening()
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
            minimumLengthMs = ENDPOINTER_MIN_LENGTH_MS
        )

    private fun isStopCommand(transcript: String): Boolean {
        val stripped = transcript.trim().trim { !it.isLetterOrDigit() }.trim()
        if (stripped.isEmpty()) return false
        return stripped.equals(STOP_KEYWORD, ignoreCase = true) ||
            stripped.startsWith("$STOP_KEYWORD ", ignoreCase = true) ||
            stripped.endsWith(" $STOP_KEYWORD", ignoreCase = true)
    }
}
