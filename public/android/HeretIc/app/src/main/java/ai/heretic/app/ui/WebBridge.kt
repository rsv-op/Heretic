package ai.heretic.app.ui

import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import ai.heretic.app.core.ErrorEngine
import ai.heretic.app.core.HereticCore
import ai.heretic.app.ml.LiteRtLmEngine
import ai.heretic.app.voice.VoiceManager
import com.heretic.voice.VoicePipelineController
import org.json.JSONArray
import org.json.JSONObject

/**
 * Every button in the React UI can reach a real Android API through this
 * object. It is only attached to the asset-loader origin content and every
 * sensitive call passes an [ai.heretic.app.core.AuthorizationGate] first.
 *
 * Every method here may be invoked from the WebView's JavaBridge thread, so
 * anything touching SpeechRecognizer, TextToSpeech, SAF ActivityResultLaunchers,
 * or evaluateJavascript is marshalled onto the main looper.
 */
class HereticJsBridge(
    private val core: HereticCore,
    private val voice: VoiceManager,
    private val engine: LiteRtLmEngine,
    private val onPickFileRequest: () -> Unit,
    private val onRequestMicPermission: () -> Unit,
    private val onRequestModelLoad: () -> Unit,
    private val voicePipeline: VoicePipelineController? = null,
    private val onPickGgufModel: (() -> Unit)? = null,
    private val onPickSttDir: (() -> Unit)? = null,
    private val onPickSttZip: (() -> Unit)? = null,
    private val onPickTtsDir: (() -> Unit)? = null,
    private val onPickTtsZip: (() -> Unit)? = null,
    private val onOpenNativeVoiceUi: (() -> Unit)? = null,
) {
    private val mainHandler = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun coreVersion(): String = core.version

    @JavascriptInterface
    fun reply(prompt: String): String {
        val res = core.reply(prompt)
        return JSONObject().apply {
            put("text", res.text)
            put("speak", res.speak)
            put("intent", res.intent.name.lowercase())
            put("confidence", res.confidence)
            put("engine", res.engine)
            put("actions", JSONArray(res.actions.map { JSONObject(mapOf("label" to it.label, "href" to it.href)) }))
        }.toString()
    }

    @JavascriptInterface
    fun analyzeError(rawLog: String): String {
        val res = core.analyzeError(rawLog)
        return JSONObject().apply {
            put("what", res.what)
            put("why", res.why)
            put("solution", res.solution)
            put("formatted", ErrorEngine.format(res))
            put("confidence", res.confidence)
            put("severity", res.severity)
            put("rules", JSONArray(res.rules))
            put("status", res.status)
        }.toString()
    }

    @JavascriptInterface
    fun confirmSolution(pasteBack: String): String {
        val res = core.confirmSolution(pasteBack)
        return JSONObject().apply {
            put("status", res.status.label)
            put("note", res.note)
            put("nextAction", res.nextAction)
            put("evidence", JSONArray(res.evidence))
        }.toString()
    }

    @JavascriptInterface
    fun assessFile(fileName: String): String {
        val res = core.assessFile(fileName)
        return JSONObject().apply {
            put("fileName", res.fileName)
            put("relevance", res.relevance)
            put("usefulness", res.usefulness)
            put("whyNotUseful", res.whyNotUseful ?: JSONObject.NULL)
            put("rationale", res.rationale)
            put("integrationSteps", JSONArray(res.integrationSteps))
        }.toString()
    }

    @JavascriptInterface
    fun speak(text: String) {
        if (core.gates.granted("tts.speak")) voice.speak(text) else core.log("gate.blocked", "tts.speak")
    }

    @JavascriptInterface
    fun stopSpeaking() {
        voice.stop()
        voicePipeline?.stopPlayback()
    }

    @JavascriptInterface
    fun triggerMic() = mainHandler.post { onRequestMicPermission() }.let {}

    @JavascriptInterface
    fun triggerFilePicker() = mainHandler.post { onPickFileRequest() }.let {}

    /** Offline speech-pack and TTS voice-data report, as JSON. */
    @JavascriptInterface
    fun voiceStatus(): String = voice.voiceStatusJson()

    /** LiteRT-LM 0.18.0 readiness: ABI, RAM, catalog, installed model. */
    @JavascriptInterface
    fun modelStatus(): String = engine.statusJson().toString()

    /** Opens ACTION_OPEN_DOCUMENT; a .litertlm pick is streamed into filesDir/models. */
    @JavascriptInterface
    fun triggerModelPicker() = mainHandler.post { onRequestModelLoad() }.let {}

    /** Returns JSON configuration and live readiness/playback state of the unified voice pipeline. */
    @JavascriptInterface
    fun getVoicePipelineConfig(): String =
        voicePipeline?.toJsonConfig() ?: JSONObject().put("available", false).toString()

    /** Updates local filesystem paths for `.gguf`, Parakeet STT dir, Supertonic TTS dir, and voice style JSON. */
    @JavascriptInterface
    fun setVoiceModelPaths(
        ggufPath: String,
        sttDir: String,
        ttsDir: String,
        voiceStylePath: String,
    ): String {
        val controller = voicePipeline ?: return JSONObject().put("available", false).toString()
        controller.updatePaths(
            llamaModelPath = ggufPath,
            sttModelDir = sttDir,
            ttsModelDir = ttsDir,
            voiceStylePath = voiceStylePath,
        )
        return controller.toJsonConfig()
    }

    /** Launches Android SAF document picker (`OpenDocument`) for selecting a `.gguf` LLM file. */
    @JavascriptInterface
    fun pickGgufModel() {
        mainHandler.post { onPickGgufModel?.invoke() }
    }

    /** Launches Android SAF directory picker (`OpenDocumentTree`) for selecting the Parakeet STT folder. */
    @JavascriptInterface
    fun pickSttModelDir() {
        mainHandler.post { onPickSttDir?.invoke() }
    }

    /** Launches Android SAF document picker (`OpenDocument`) for selecting a Parakeet STT `.zip` bundle. */
    @JavascriptInterface
    fun pickSttModelZip() {
        mainHandler.post { onPickSttZip?.invoke() }
    }

    /** Launches Android SAF directory picker (`OpenDocumentTree`) for selecting the Supertonic TTS folder. */
    @JavascriptInterface
    fun pickTtsModelDir() {
        mainHandler.post { onPickTtsDir?.invoke() }
    }

    /** Launches Android SAF document picker (`OpenDocument`) for selecting a Supertonic TTS `.zip` bundle. */
    @JavascriptInterface
    fun pickTtsModelZip() {
        mainHandler.post { onPickTtsZip?.invoke() }
    }

    /** Initializes `ParakeetEngine` + `SupertonicTTS` + `LlamaCppEngine` on a background IO dispatcher. */
    @JavascriptInterface
    fun initUnifiedVoicePipeline() {
        voicePipeline?.initialize()
    }

    /** Starts continuous hands-free Silero VAD + Parakeet STT + llama.cpp + Supertonic AudioTrack streaming. */
    @JavascriptInterface
    fun startUnifiedVoiceListening(): Boolean =
        voicePipeline?.startListening() ?: false

    /** Stops microphone capture while preserving loaded models in memory. */
    @JavascriptInterface
    fun stopUnifiedVoiceListening() {
        voicePipeline?.stopListening()
    }

    /** Immediate `"shaz"` / emergency barge-in stop: pauses & flushes AudioTrack and halts LLM + TTS. */
    @JavascriptInterface
    fun stopUnifiedVoicePlayback() {
        voicePipeline?.stopPlayback()
    }

    /** Streams a text prompt through `llama.cpp` -> `SentenceStreamingBuffer` -> `SupertonicTTS` -> `AudioTrack`. */
    @JavascriptInterface
    fun speakWithUnifiedVoice(prompt: String) {
        voicePipeline?.speakPrompt(prompt)
    }

    /** Switches from WebView to the native Jetpack Compose Voice Pipeline configuration screen. */
    @JavascriptInterface
    fun openNativeVoiceConsole() {
        mainHandler.post { onOpenNativeVoiceUi?.invoke() }
    }

    @JavascriptInterface
    fun isArm64Device(): Boolean = engine.isArm64Device()

    @JavascriptInterface
    fun deviceRamMb(): Long = engine.totalRamBytes() / 1_048_576L

    @JavascriptInterface
    fun grantGate(key: String, decision: String): String =
        core.gates.record(key, decision, source = "webview").toString()

    @JavascriptInterface
    fun deviceReport(): String = JSONObject().apply {
        put("model", android.os.Build.MODEL)
        put("sdk", android.os.Build.VERSION.SDK_INT)
        put("abi", android.os.Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown")
        put("backgroundServices", 0)
        put("internetPermission", false)
    }.toString()
}
