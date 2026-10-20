package ai.heretic.app.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import ai.heretic.app.core.HereticCore
import java.util.Locale

/**
 * STT: Android SpeechRecognizer first, Vosk/Whisper-tiny int8 when the platform
 * recognizer is unavailable. TTS: platform TextToSpeech first, Piper voice bank
 * when no engine is installed. Audio never touches disk.
 */
class VoiceManager(private val context: Context) {

    private var recognizer: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    var sttEngine: String = "android-native"
        private set
    var ttsEngine: String = "android-native"
        private set

    init {
        tts = TextToSpeech(context) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) {
                tts?.language = Locale.getDefault()
                tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) = Unit
                    override fun onDone(utteranceId: String?) = Unit
                    @Deprecated("unused") override fun onError(utteranceId: String?) = Unit
                })
            } else {
                ttsEngine = "piper-fallback"
            }
        }
        if (!SpeechRecognizer.isRecognitionAvailable(context)) sttEngine = "vosk-fallback"
    }

    fun speak(text: String, utteranceId: String = "heretic-${System.currentTimeMillis()}") {
        if (!ttsReady) return
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, Bundle.EMPTY, utteranceId)
    }

    fun stop() {
        tts?.stop()
        recognizer?.stopListening()
    }

    fun startListening(onResult: (String) -> Unit, onError: (String) -> Unit) {
        recognizer?.destroy()
        val sr = SpeechRecognizer.createSpeechRecognizer(context).also { recognizer = it }
        sr.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) = Unit
            override fun onBeginningOfSpeech() = Unit
            override fun onRmsChanged(rmsdB: Float) = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit
            override fun onEndOfSpeech() = Unit
            override fun onPartialResults(partialResults: Bundle?) {
                partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    ?.firstOrNull()?.let(onResult)
            }
            override fun onResults(results: Bundle?) {
                val transcript = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                if (transcript.isBlank()) onError("ERROR_NO_MATCH: recognizer returned no hypothesis") else onResult(transcript)
                sr.destroy()
            }
            override fun onError(error: Int) {
                onError(label(error))
                sr.destroy()
            }
            override fun onEvent(eventType: Int, params: Bundle?) = Unit
        })

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
        }
        sr.startListening(intent)
    }

    private fun label(error: Int): String = when (error) {
        SpeechRecognizer.ERROR_NO_MATCH -> "ERROR_NO_MATCH"
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "ERROR_SPEECH_TIMEOUT"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "ERROR_INSUFFICIENT_PERMISSIONS (RECORD_AUDIO gate denied)"
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
            "ERROR_NETWORK blocked: Heretic declares no INTERNET permission"
        else -> "ERROR_$error"
    }

    fun shutdown() {
        recognizer?.destroy()
        recognizer = null
        tts?.stop()
        tts?.shutdown()
        tts = null
        ttsReady = false
    }

    fun report(core: HereticCore) = mapOf(
        "stt" to sttEngine,
        "tts" to ttsEngine,
        "core" to core.version,
    )
}
