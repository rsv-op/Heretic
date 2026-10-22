package ai.heretic.app.core

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class Decision(
    val ref: String,
    val title: String,
    val context: String,
    val options: List<String>,
    val choice: String,
    val reasoning: String,
    val impact: String,
)

object DecisionRule {
    const val MIN_WORDS = 12

    fun validate(title: String, choice: String, reasoning: String): List<String> {
        val errors = mutableListOf<String>()
        val words = reasoning.trim().split(Regex("\\s+")).filter { it.isNotBlank() }
        if (title.trim().length < 4) errors += "A decision needs a title of at least 4 characters."
        if (choice.trim().length < 2) errors += "Record the option that was actually chosen."
        if (reasoning.isBlank()) errors += "The mandatory reasoning sentence is missing."
        else {
            if (!Regex("\\bbecause\\b", RegexOption.IGNORE_CASE).containsMatchIn(reasoning)) {
                errors += "The reasoning sentence must contain the word because."
            }
            if (words.size < MIN_WORDS) errors += "The reasoning sentence must be at least $MIN_WORDS words (currently ${words.size})."
        }
        return errors
    }
}

/** Append-only JSON lines store inside the app sandbox. Never synced. */
class DecisionLogger(context: Context) {

    private val file = File(context.filesDir, "decisions.jsonl")

    fun append(decision: Decision): Result<Decision> {
        val errors = DecisionRule.validate(decision.title, decision.choice, decision.reasoning)
        if (errors.isNotEmpty()) return Result.failure(IllegalStateException(errors.joinToString(" ")))
        val json = JSONObject().apply {
            put("ref", decision.ref)
            put("title", decision.title)
            put("context", decision.context)
            put("options", JSONArray(decision.options))
            put("choice", decision.choice)
            put("reasoning", decision.reasoning)
            put("impact", decision.impact)
            put("at", System.currentTimeMillis())
        }
        file.appendText(json.toString() + "\n")
        return Result.success(decision)
    }

    /**
     * Writes the baseline ADRs from [DecisionSeeds] once. Idempotent: refs already
     * present in the log are skipped, so repeated launches never duplicate entries
     * and a failed write is retried on the next start.
     */
    fun seedBaseline(): List<Decision> {
        val existing = all().map { it.ref }.toSet()
        return DecisionSeeds.missing(existing).mapNotNull { append(it).getOrNull() }
    }

    fun all(): List<Decision> = runCatching {
        file.readLines().filter { it.isNotBlank() }.map {
            val o = JSONObject(it)
            Decision(
                ref = o.getString("ref"),
                title = o.getString("title"),
                context = o.optString("context"),
                options = o.optJSONArray("options")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList(),
                choice = o.getString("choice"),
                reasoning = o.getString("reasoning"),
                impact = o.optString("impact"),
            )
        }
    }.getOrDefault(emptyList())
}

/**
 * Baseline ADRs that ship with the build.
 *
 * The web command center seeds the same entries (ADR-009 / ADR-010) from
 * `webui/src/lib/seed.ts`, so the native log and the dashboard agree. Each
 * reasoning sentence must satisfy [DecisionRule]: the word "because" and at
 * least twelve words.
 */
object DecisionSeeds {

    val WEB_ASSET_LOADER = Decision(
        ref = "ADR-009",
        title = "Serve the web UI through WebViewAssetLoader instead of file://",
        context = "Splitting the PGlite runtime out of index.html produced ES module chunks and a 10 MB .wasm " +
            "asset. A WebView loading file:///android_asset/ cannot import modules or stream WebAssembly, and " +
            "setting allowFileAccess = true to work around it re-opens local file reads the assessor was built to avoid.",
        options = listOf(
            "WebViewAssetLoader on https://appassets.androidplatform.net",
            "file:///android_asset with allowFileAccess = true",
            "Re-inline the runtime as base64 and keep the single file",
            "Loopback HTTP server bound to 127.0.0.1",
        ),
        choice = "WebViewAssetLoader on https://appassets.androidplatform.net",
        reasoning = "We serve app/src/main/assets through androidx.webkit WebViewAssetLoader because it gives the " +
            "page a real https origin so ES module imports and wasm streaming work while allowFileAccess stays " +
            "false, and a loopback server would have required the INTERNET permission this app refuses to declare.",
        impact = "index.html drops from 53.1 MB to 1.08 MB, the 16 MB of wasm/data ship as compressible assets, " +
            "and the manifest still declares no network permission.",
    )

    val ABI_FILTERS = Decision(
        ref = "ADR-010",
        title = "Package arm64-v8a and x86_64 only, dropping armeabi-v7a",
        context = "com.google.ai.edge.litertlm:litertlm-android:0.18.0 is now a direct dependency and it ships " +
            "native libraries for 64-bit ABIs only. The build previously filtered arm64-v8a and armeabi-v7a.",
        options = listOf(
            "abiFilters arm64-v8a + x86_64",
            "Keep armeabi-v7a and skip LiteRT-LM on 32-bit",
            "Ship a separate 32-bit APK flavour",
        ),
        choice = "abiFilters arm64-v8a + x86_64",
        reasoning = "We filter to arm64-v8a and x86_64 because litertlm-android 0.18.0 publishes no armeabi-v7a " +
            "binaries, so a 32-bit device would install successfully and then die with UnsatisfiedLinkError the " +
            "moment the engine loaded, which is far worse than a clean install refusal.",
        impact = "32-bit ARM devices are excluded by the installer; LiteRtLmEngine.isArm64Device() still refuses " +
            "the engine with a readable message, and x86_64 keeps emulator and CI runs working.",
    )

    val ALL: List<Decision> = listOf(WEB_ASSET_LOADER, ABI_FILTERS)

    /** Seeds whose ref is not already in the append-only log. */
    fun missing(existingRefs: Collection<String>): List<Decision> =
        ALL.filterNot { it.ref in existingRefs }
}
