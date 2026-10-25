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
        title = "Package arm64-v8a exclusively with 16 KB ELF page alignment",
        context = "Unified native inference combines llama.cpp ARMv8.2-A NEON dotprod/fp16, litertlm-android, " +
            "and onnxruntime-android on Android 16 (API 36), where 16 KB page alignment and 64-bit ARM execution are mandatory.",
        options = listOf(
            "abiFilters arm64-v8a with 16 KB page alignment",
            "Keep armeabi-v7a and x86_64 multi-ABI fat APK",
            "Ship separate per-ABI APKs",
        ),
        choice = "abiFilters arm64-v8a",
        reasoning = "We filter native packaging to arm64-v8a exclusively because llama.cpp ARMv8.2-A NEON kernels " +
            "and litertlm-android target 64-bit ARM hardware, and shipping partial ABIs would crash at runtime with " +
            "UnsatisfiedLinkError while inflating uncompressed 16 KB page-aligned native libraries.",
        impact = "All packaged native libraries (libllama_jni.so, libonnxruntime.so, liblitertlm) align to 16 KB " +
            "page boundaries under jniLibs.useLegacyPackaging = false for Android 16 devices.",
    )

    val UNIFIED_VOICE_PIPELINE = Decision(
        ref = "ADR-011",
        title = "Unify Parakeet TDT STT, Silero VAD, llama.cpp JNI, and Supertonic TTS in-process",
        context = "Hands-free offline voice interaction requires streaming microphone VAD/STT, low-latency token " +
            "generation, sentence-level TTS synthesis, and instant AudioTrack barge-in without network calls.",
        options = listOf(
            "Unified in-process Kotlin + JNI + ONNX Runtime voice orchestrator",
            "Platform SpeechRecognizer and Android TextToSpeech IPC services",
            "Local loopback WebSocket server between separate processes",
        ),
        choice = "Unified in-process Kotlin + JNI + ONNX Runtime voice orchestrator",
        reasoning = "We run Parakeet TDT, Silero VAD, llama.cpp JNI, and Supertonic TTS inside one unified " +
            "orchestrator because sentence-streamed PCM chunks can feed a low-latency AudioTrack directly and " +
            "immediately pause and flush on the shaz keyword or VAD barge-in.",
        impact = "Zero network permissions, sub-sentence voice response latency, and deterministic cancellation " +
            "across LLM decoding, ONNX diffusion steps, and AudioTrack buffers.",
    )

    val NATIVE_VOICE_ASSISTANT_SHELL = Decision(
        ref = "ADR-012",
        title = "Boot directly into the native Jetpack Compose Voice Assistant without WebView",
        context = "Shipping a 20 MB WebView + PGlite web dashboard as the primary launcher experience hid the " +
            "native Android voice assistant behind browser chrome and prevented instant offline voice startup.",
        options = listOf(
            "Pure native Jetpack Compose Heretic Voice Assistant launcher",
            "WebView-first hybrid wrapper loading assets/index.html",
            "Dual-launcher APK with separate WebView activity",
        ),
        choice = "Pure native Jetpack Compose Heretic Voice Assistant launcher",
        reasoning = "We boot MainActivity directly into the native Jetpack Compose Heretic Voice Assistant " +
            "because removing the WebView eliminates twenty megabytes of web runtime overhead and gives immediate " +
            "hands-free access to all voice, model, error, file, milestone, gate, and ADR workflows.",
        impact = "Smaller APK footprint, instant cold-start into the voice assistant, out-of-the-box offline " +
            "speech fallback, and seamless modular activation of Parakeet STT, llama.cpp, LiteRT-LM, and Supertonic TTS.",
    )

    val LITERT_DELEGATE_FALLBACK_CACHE = Decision(
        ref = "ADR-013",
        title = "Cache LiteRT 2.3.0 GPU delegate probe per install with 4-thread CPU fallback",
        context = "litert-gpu:2.3.0 requires working OpenCL or Vulkan drivers, and emulators or certain Mali GPU " +
            "drivers throw during delegate attachment instead of degrading gracefully.",
        options = listOf(
            "runCatching GPU probe -> setNumThreads(4) CPU fallback + TFL3 v3 check + per-install backend cache",
            "Retry GPU delegate creation on every model load without caching",
            "Disable litert-gpu:2.3.0 globally on all Android devices",
        ),
        choice = "runCatching GPU probe -> setNumThreads(4) CPU fallback + TFL3 v3 check + per-install backend cache",
        reasoning = "We wrap LiteRT 2.3.0 GPU delegate creation in runCatching, verify the TFL3 v3 flatbuffer " +
            "schema upfront, fall back to four CPU threads, and cache the resolved backend per install because " +
            "emulators and Mali drivers that throw on OpenCL or Vulkan only pay one probe per install.",
        impact = "Eliminates LiteRT GPU delegate startup crashes, guarantees four-thread XNNPACK CPU fallback, " +
            "rejects mismatched flatbuffer schemas early, and skips repeated failing GPU probes across launches.",
    )

    val ALL: List<Decision> = listOf(
        WEB_ASSET_LOADER,
        ABI_FILTERS,
        UNIFIED_VOICE_PIPELINE,
        NATIVE_VOICE_ASSISTANT_SHELL,
        LITERT_DELEGATE_FALLBACK_CACHE,
    )

    /** Seeds whose ref is not already in the append-only log. */
    fun missing(existingRefs: Collection<String>): List<Decision> =
        ALL.filterNot { it.ref in existingRefs }
}
