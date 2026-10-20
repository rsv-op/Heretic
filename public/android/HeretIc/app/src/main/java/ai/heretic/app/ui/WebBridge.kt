package ai.heretic.app.ui

import android.webkit.JavascriptInterface
import ai.heretic.app.core.ErrorEngine
import ai.heretic.app.core.HereticCore
import ai.heretic.app.voice.VoiceManager
import org.json.JSONArray
import org.json.JSONObject

/**
 * Every button in the React UI can reach a real Android API through this
 * object. It is only attached for file:///android_asset content and every
 * sensitive call passes an [ai.heretic.app.core.AuthorizationGate] first.
 */
class HereticJsBridge(
    private val core: HereticCore,
    private val voice: VoiceManager,
    private val onPickFileRequest: () -> Unit,
    private val onRequestMicPermission: () -> Unit,
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
