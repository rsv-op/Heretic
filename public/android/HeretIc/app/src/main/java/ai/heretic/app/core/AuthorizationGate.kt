package ai.heretic.app.core

import android.content.Context
import java.security.MessageDigest

data class GateDefinition(
    val key: String,
    val action: String,
    val scope: String,
    val risk: String,
    val reason: String,
    val permission: String,
)

data class GateEntry(
    val key: String,
    val decision: String,
    val scope: String,
    val source: String,
    val atEpochMs: Long,
    val prevHash: String,
    val auditHash: String,
)

/**
 * Consent is per instance: nothing survives a process restart unless the
 * operator explicitly chose "remember". Every decision is appended to a
 * hash-chained ledger so tampering is detectable offline.
 */
class AuthorizationGate(private val context: Context) {

    private val prefs = context.getSharedPreferences("heretic.gates", Context.MODE_PRIVATE)
    private val ledger = mutableListOf<GateEntry>()

    val catalog = listOf(
        GateDefinition("mic.capture", "Capture microphone audio for on-device STT", "this-instance-only", "high", "SpeechRecognizer needs RECORD_AUDIO; audio is discarded after the utterance.", "android.permission.RECORD_AUDIO"),
        GateDefinition("file.saf.read", "Read one user-selected file via SAF", "single-uri-grant", "medium", "OpenDocument grants exactly one URI; no directory is enumerated.", "ACTION_OPEN_DOCUMENT"),
        GateDefinition("model.load", "Load a LiteRT/GGUF model into memory", "this-instance-only", "medium", "Interpreter init pins hundreds of megabytes.", "none"),
        GateDefinition("tts.speak", "Speak responses aloud", "this-instance-only", "low", "Audible output is itself a privacy leak; silent by default.", "none"),
        GateDefinition("webview.bridge", "Expose HereticJsBridge to the WebView", "bundled-asset-origin-only", "high", "A JavascriptInterface is reachable from whatever the WebView loads.", "none"),
    )

    fun granted(key: String): Boolean = prefs.getBoolean("granted.$key", false)

    fun record(key: String, decision: String, source: String = "compose"): GateEntry {
        val def = catalog.firstOrNull { it.key == key }
        val grantedNow = decision.equals("GRANTED", ignoreCase = true)
        prefs.edit().putBoolean("granted.$key", grantedNow).apply()
        val prev = ledger.lastOrNull()?.auditHash ?: "genesis"
        val at = System.currentTimeMillis()
        val payload = "$prev|$key|$decision|${def?.scope ?: "this-instance-only"}|$source|$at"
        val hash = sha256(payload)
        val entry = GateEntry(key, decision.uppercase(), def?.scope ?: "this-instance-only", source, at, prev, hash)
        ledger += entry
        return entry
    }

    fun entries(): List<GateEntry> = ledger.toList()

    /** Re-walks the chain; returns the index of the first broken link or -1. */
    fun verify(): Int {
        var prev = "genesis"
        ledger.forEachIndexed { index, entry ->
            if (entry.prevHash != prev) return index
            prev = entry.auditHash
        }
        return -1
    }

    fun clearInstanceGrants() {
        prefs.edit().clear().apply()
        ledger.clear()
    }

    private fun sha256(input: String): String =
        MessageDigest.getInstance("SHA-256").digest(input.toByteArray()).joinToString("") { "%02x".format(it) }
}
