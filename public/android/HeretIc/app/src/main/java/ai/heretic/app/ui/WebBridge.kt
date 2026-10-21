package ai.heretic.app.ui

import android.webkit.JavascriptInterface
import ai.heretic.app.core.ErrorEngine
import ai.heretic.app.core.HereticCore
import ai.heretic.app.ml.LiteRtLmEngine
import ai.heretic.app.voice.VoiceManager
import org.json.JSONArray
import org.json.JSONObject

/**
 * Every button in the React UI can reach a real Android API through this
 * object. It is only attached to the asset-loader origin content and every
 * sensitive call passes an [ai.heretic.app.core.AuthorizationGate] first.
 *
 * Every method here may be invoked from the WebView's JavaBridge thread, so
 * anything touching SpeechRecognizer, TextToSpeech or evaluateJavascript is
 * marshalled onto the main looper by [VoiceManager] / the activity.
 */
class HereticJsBridge(
    private val core: HereticCore,
    private val voice: VoiceManager,
    private val engine: LiteRtLmEngine,
    private val onPickFileRequest: () -> Unit,
    private val onRequestMicPermission: () -> Unit,
    private val onRequestModelLoad: () -> Unit,
) {

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
    fun stopSpeaking() = voice.stop()

    @JavascriptInterface
    fun triggerMic() = onRequestMicPermission()

    @JavascriptInterface
    fun triggerFilePicker() = onPickFileRequest()

    /** Offline speech-pack and TTS voice-data report, as JSON. */
    @JavascriptInterface
    fun voiceStatus(): String = voice.voiceStatusJson()

    /** LiteRT-LM 0.18.0 readiness: ABI, RAM, catalog, installed model. */
    @JavascriptInterface
    fun modelStatus(): String = engine.statusJson().toString()

    /** Opens ACTION_OPEN_DOCUMENT; a .litertlm pick is streamed into filesDir/models. */
    @JavascriptInterface
    fun triggerModelPicker() = onRequestModelLoad()

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
