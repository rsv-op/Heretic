package ai.heretic.app.voice

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import ai.heretic.app.core.HereticCore
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * STT: Android SpeechRecognizer first, Vosk/Whisper-tiny int8 when the platform
 * recognizer is unavailable. TTS: platform TextToSpeech first, Piper voice bank
 * when no engine is installed. Audio never touches disk.
 *
 * Every SpeechRecognizer, TextToSpeech and listener callback is created and
 * driven on the main looper: the framework throws
 * "SpeechRecognizer should be used only from the main thread" and silently drops
 * TTS calls made from a WebView/JavascriptInterface thread otherwise.
 */
class VoiceManager(private val context: Context) {

    private val main = Handler(Looper.getMainLooper())

    private var recognizer: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var ttsError: String? = null
    private var ttsVoices = 0
    private var lastError: String? = null

    var sttEngine: String = "android-native"
        private set
    var ttsEngine: String = "android-native"
        private set

    init {
        // Constructing SpeechRecognizer/TextToSpeech off the main thread throws.
        main.post {
            tts = TextToSpeech(context) { status ->
                // The callback already arrives on the main looper.
                ttsReady = status == TextToSpeech.SUCCESS
                if (ttsReady) {
                    val engine = tts
                    engine?.language = Locale.getDefault()
                    ttsVoices = runCatching { engine?.voices?.size ?: 0 }.getOrDefault(0)
                    engine?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                        override fun onStart(utteranceId: String?) = Unit
                        override fun onDone(utteranceId: String?) = Unit
                        @Deprecated("unused") override fun onError(utteranceId: String?) = Unit
                    })
                } else {
                    ttsEngine = "piper-fallback"
                    ttsError = "TextToSpeech init returned status=$status (no TTS engine or no voice data)"
                }
            }
            if (!SpeechRecognizer.isRecognitionAvailable(context)) {
                sttEngine = "vosk-fallback"
                lastError = "SpeechRecognizer unavailable: no recognizer service installed"
            }
        }
    }

    fun speak(text: String, utteranceId: String = "heretic-${System.currentTimeMillis()}") {
        main.post {
            if (!ttsReady) {
                lastError = "TTS not ready: ${ttsError ?: "engine still initialising"}"
                return@post
            }
            val result = tts?.speak(text, TextToSpeech.QUEUE_FLUSH, Bundle.EMPTY, utteranceId)
            if (result != TextToSpeech.SUCCESS) lastError = "TextToSpeech.speak returned $result"
        }
    }

    fun stop() {
        main.post {
            tts?.stop()
            recognizer?.stopListening()
        }
    }

    fun startListening(onResult: (String) -> Unit, onError: (String) -> Unit) {
        main.post {
            recognizer?.destroy()
            val sr = runCatching { SpeechRecognizer.createSpeechRecognizer(context) }.getOrElse { error ->
                // Fallback engines handle the utterance; report so the UI can say so.
                sttEngine = "vosk-fallback"
                onError("NO_RECOGNIZER: ${error.message ?: "createSpeechRecognizer failed"}")
                return@post
            }
            recognizer = sr
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
                    val transcript = results
                        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()
                        .orEmpty()
                    if (transcript.isBlank()) {
                        onError("ERROR_NO_MATCH: recognizer returned no hypothesis")
                    } else {
                        onResult(transcript)
                    }
                    sr.destroy()
                }
                override fun onError(error: Int) {
                    val message = label(error)
                    lastError = message
                    onError(message)
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
                // No INTERNET permission exists, so only on-device packs can answer.
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            }
            sr.startListening(intent)
        }
    }

    private fun label(error: Int): String = when (error) {
        SpeechRecognizer.ERROR_NO_MATCH -> "ERROR_NO_MATCH"
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "ERROR_SPEECH_TIMEOUT"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
            "ERROR_INSUFFICIENT_PERMISSIONS (RECORD_AUDIO gate denied)"
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
            "ERROR_NETWORK blocked: Heretic declares no INTERNET permission"
        SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE ->
            "ERROR_LANGUAGE_UNAVAILABLE: install the offline speech pack for this locale"
        SpeechRecognizer.ERROR_SERVER_DISCONNECTED ->
            "ERROR_SERVER_DISCONNECTED: offline recognizer dropped the session"
        else -> "ERROR_$error"
    }

    /**
     * Offline readiness report for the Settings screen and the bridge: does the
     * device actually have speech packs and TTS voice data on disk? Both answers
     * come from the platform, never from a network probe.
     */
    fun voiceStatusJson(): String {
        val locale = Locale.getDefault()
        val recognizerAvailable = runCatching { SpeechRecognizer.isRecognitionAvailable(context) }
            .getOrDefault(false)
        val onDeviceAvailable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            runCatching { SpeechRecognizer.isOnDeviceRecognitionAvailable(context) }.getOrDefault(false)
        } else {
            false
        }
        val ttsEngineName = runCatching { tts?.defaultEngine }.getOrNull()
            ?: runCatching { tts?.engines?.firstOrNull() }.getOrNull()
        val languageStatus = runCatching { tts?.isLanguageAvailable(locale) ?: TextToSpeech.LANG_NOT_SUPPORTED }
            .getOrDefault(TextToSpeech.LANG_NOT_SUPPORTED)
        val voiceNames = JSONArray(
            runCatching { tts?.voices?.map { it.name } ?: emptyList() }.getOrDefault(emptyList()).sorted(),
        )

        return JSONObject().apply {
            put("stt", sttEngine)
            put("tts", ttsEngine)
            put("ttsReady", ttsReady)
            put("recognizerAvailable", recognizerAvailable)
            put("onDeviceRecognizerAvailable", onDeviceAvailable)
            put("preferOffline", true)
            // isRecognitionAvailable() is true even with zero downloadable packs,
            // so surface both signals instead of a single boolean.
            put("offlineSpeechPacks", recognizerAvailable || onDeviceAvailable)
            put("ttsEngineName", ttsEngineName ?: JSONObject.NULL)
            put("ttsLanguage", locale.toLanguageTag())
            put("ttsLanguageAvailable", languageStatus >= TextToSpeech.LANG_AVAILABLE)
            put("ttsVoiceCount", ttsVoices)
            put("ttsVoices", voiceNames)
            put("ttsError", ttsError ?: JSONObject.NULL)
            put("lastError", lastError ?: JSONObject.NULL)
            put("internetPermission", false)
        }.toString()
    }

    fun shutdown() {
        main.post {
            recognizer?.destroy()
            recognizer = null
            tts?.stop()
            tts?.shutdown()
            tts = null
            ttsReady = false
        }
    }

    fun report(core: HereticCore) = mapOf(
        "stt" to sttEngine,
        "tts" to ttsEngine,
        "core" to core.version,
    )
}
