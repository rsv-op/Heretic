package ai.heretic.app.core

import android.content.Context
import android.util.Log

data class CoreReply(
    val text: String,
    val speak: String,
    val intent: Intent,
    val confidence: Double,
    val engine: String,
    val actions: List<CoreAction>,
)

data class CoreAction(val label: String, val href: String)

enum class Intent {
    GREETING, CAPABILITIES, VOICE, ERROR, MODEL, BUILD, PRIVACY, FILE, REPO, DECISION, STATUS, UNKNOWN,
}

/**
 * Deterministic, 100% offline fallback brain for the native Heretic Voice Assistant.
 */
class HereticCore(private val context: Context) {

    val version: String = "3.1.0-native-offline"
    val gates = AuthorizationGate(context)
    val decisions = DecisionLogger(context)
    private val errors = ErrorEngine
    private val files = FileAssessor
    private val repos = RepoAssessor

    private val rules: List<Pair<Intent, List<String>>> = listOf(
        Intent.GREETING to listOf("hello", "hey", "wake up", "heretic", "you there"),
        Intent.CAPABILITIES to listOf("what can you do", "help", "capabilities", "commands"),
        Intent.VOICE to listOf("voice", "wake word", "shaz", "speak", "tts", "stt", "mic", "parakeet", "silero", "supertonic"),
        Intent.ERROR to listOf("error", "crash", "exception", "stack trace", "logcat", "failing"),
        Intent.MODEL to listOf("gguf", "onnx", "tflite", "litert", "model", "quantiz", "delegate"),
        Intent.BUILD to listOf("apk", "build", "gradle", "assemble", "workflow", "sign", "dex"),
        Intent.PRIVACY to listOf("privacy", "permission", "offline", "background", "battery", "drain"),
        Intent.FILE to listOf("file", "picked", "asset", "saf", "opendocument", "relevance"),
        Intent.REPO to listOf("repo", "milestone", "progress", "branch", "implement now", "defer"),
        Intent.DECISION to listOf("decision", "adr", "architecture", "because", "rationale"),
        Intent.STATUS to listOf("status", "health", "memory", "ram", "uptime", "diagnostic"),
    )

    fun reply(prompt: String): CoreReply {
        val normalized = " ${prompt.lowercase()} "
        var best = Intent.UNKNOWN to 0
        for ((intent, keys) in rules) {
            val score: Int = keys.sumOf { key ->
                val hit: Int = if (normalized.contains(key)) 1 else 0
                hit * (if (key.length > 6) 2 else 1)
            }
            if (score > best.second) best = intent to score
        }
        val confidence = if (best.second == 0) 0.31 else minOf(0.97, 0.52 + best.second * 0.09)
        val body = responses.getValue(best.first)
        return CoreReply(
            text = body.first,
            speak = body.second,
            intent = best.first,
            confidence = confidence,
            engine = "HereticCore $version · rule-table · offline",
            actions = actionsFor(best.first),
        )
    }

    fun analyzeError(rawLog: String) = errors.analyze(rawLog)
    fun confirmSolution(pasteBack: String) = errors.confirm(pasteBack)
    fun assessFile(fileName: String, sizeBytes: Long = 0L) = files.assess(fileName, sizeBytes)
    fun evaluate(items: List<MilestoneItem>) = repos.evaluate(items)

    fun log(tag: String, message: String) {
        Log.d("Heretic/$tag", message)
    }

    private fun actionsFor(intent: Intent): List<CoreAction> = when (intent) {
        Intent.ERROR -> listOf(CoreAction("Error identification loop", "heretic://errors"))
        Intent.FILE, Intent.MODEL -> listOf(CoreAction("File assessor", "heretic://files"))
        Intent.BUILD -> listOf(CoreAction("Model & build studio", "heretic://models"))
        Intent.PRIVACY -> listOf(CoreAction("Authorization gates", "heretic://gates"))
        Intent.DECISION -> listOf(CoreAction("Decision log", "heretic://decisions"))
        Intent.REPO -> listOf(CoreAction("Repository tracker", "heretic://repos"))
        else -> listOf(CoreAction("Voice assistant", "heretic://home"))
    }

    private val responses: Map<Intent, Pair<String, String>> = mapOf(
        Intent.GREETING to ("Heretic online. Wake word is \"Heretic\", emergency cut-off word is \"shaz\". Six native offline workflows are resident: voice assistant, error loop, file assessor, repo milestones, authorization gates, and ADR decision log." to "Heretic online. Say Heretic to wake hands-free commands, or shaz anytime to cut playback."),
        Intent.CAPABILITIES to ("Six native offline workflows: voice assistant (wake word \"Heretic\", stop word \"shaz\"), error identification, file relevance, repository milestones, SHA-256 authorization gates, and ADR decision transparency." to "Six native offline workflows are active."),
        Intent.VOICE to ("Wake word \"Heretic\" activates hands-free listening; \"shaz\" immediately pauses and flushes AudioTrack. Silero VAD v6 is embedded in assets, Parakeet TDT INT8 handles neural STT, and Supertonic ONNX synthesizes speech locally." to "Say Heretic to wake me, or shaz to interrupt playback immediately."),
        Intent.ERROR to ("Send the raw logcat including the Caused by chain. I return WHAT, WHY and REQUEST SOLUTION, then grade your paste-back." to "Paste the stack trace."),
        Intent.MODEL to ("llama.cpp loads Q4_K_M .gguf weights over JNI, LiteRT-LM 0.18.0 runs .litertlm Gemma bundles, LiteRT 2.3.0 compiles TFL3 v3 .tflite models with cached GPU-to-CPU(4) fallback, and ONNX Runtime drives Parakeet STT, Silero VAD v6, and Supertonic TTS." to "Import GGUF, LiteRT-LM, TFLite, or ONNX voice zip bundles in the Models tab."),
        Intent.BUILD to ("Pure native Jetpack Compose Android 16 ARM64 build: CMake 3.22.1 compiles llama.cpp + ggml JNI, verifyVoiceAssets blocks any WebUI files, and Gradle 8.7 on JDK 17 runs 35+ unit tests and assembleDebug." to "Pure native Gradle and CMake ARM64 build with zero WebUI."),
        Intent.PRIVACY to ("No INTERNET permission is declared. No services or boot receivers exist. Every consent event is written to a SHA-256 hash-chained ledger." to "No internet permission, no background services."),
        Intent.FILE to ("Pick a file via SAF. I return WORKS, PARTIALLY MATCHES, or NOT RELEVANT with integration steps and auto-route supported model bundles." to "Pick a file to assess and import."),
        Intent.REPO to ("Milestones are graded IMPLEMENT NOW, DEFER, or CHANGES NEEDED and progress is weighted so deferrals cannot inflate it." to "Milestones are graded and weighted."),
        Intent.DECISION to ("A decision is only stored with its mandatory reasoning sentence containing because and at least twelve words." to "Decisions need a reasoning sentence."),
        Intent.STATUS to ("HereticCore $version, wake word \"Heretic\", interrupt \"shaz\", Silero VAD v6 embedded, LiteRT 2.3.0 + GPU-to-CPU(4) cache active, zero network permissions." to "All offline subsystems nominal."),
        Intent.UNKNOWN to ("No intent matched above 0.5 confidence, so I will not guess. Reframe against one of the six workflows or load a GGUF / LiteRT-LM model in Models." to "Intent not matched."),
    )
}
