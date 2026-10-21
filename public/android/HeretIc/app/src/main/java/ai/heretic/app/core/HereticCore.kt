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
 * Deterministic, offline. The same rule tables are mirrored in TypeScript in
 * src/lib/engines.ts so the WebView UI and the Compose UI answer identically.
 */
class HereticCore(private val context: Context) {

    val version: String = "2.3.0-offline"
    val gates = AuthorizationGate(context)
    val decisions = DecisionLogger(context)
    private val errors = ErrorEngine
    private val files = FileAssessor
    private val repos = RepoAssessor

    private val rules: List<Pair<Intent, List<String>>> = listOf(
        Intent.GREETING to listOf("hello", "hey", "wake up", "jarvis", "alfred", "you there"),
        Intent.CAPABILITIES to listOf("what can you do", "help", "capabilities", "commands"),
        Intent.VOICE to listOf("voice", "speak", "tts", "stt", "mic", "whisper", "vosk", "piper"),
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
        Intent.BUILD -> listOf(CoreAction("Build pipeline", "heretic://android"))
        Intent.PRIVACY -> listOf(CoreAction("Authorization gates", "heretic://gates"))
        Intent.DECISION -> listOf(CoreAction("Decision log", "heretic://decisions"))
        Intent.REPO -> listOf(CoreAction("Repository tracker", "heretic://repos"))
        else -> listOf(CoreAction("Command center", "heretic://home"))
    }

    private val responses: Map<Intent, Pair<String, String>> = mapOf(
        Intent.GREETING to ("Heretic online. Fully offline, no telemetry, no background services. Six workflows are resident: chat & voice, the error loop, the file assessor, the repo tracker, authorization gates and the decision log." to "Heretic online. All processing stays on this device."),
        Intent.CAPABILITIES to ("Six local workflows: voice pipeline, error identification, file relevance, repository progress, authorization gates, decision transparency." to "Six workflows, all offline."),
        Intent.VOICE to ("Mic tap requests RECORD_AUDIO at that instant, SpeechRecognizer or Vosk transcribes locally, TextToSpeech or Piper answers. Nothing is stored." to "Voice stays on device."),
        Intent.ERROR to ("Send the raw logcat including the Caused by chain. I return WHAT, WHY and REQUEST SOLUTION, then grade your paste-back." to "Paste the stack trace."),
        Intent.MODEL to ("LiteRT .tflite loads natively with the GPU delegate. GGUF works through llama.cpp at Q4. ONNX only partially matches; convert it." to "Use LiteRT models with the GPU delegate."),
        Intent.BUILD to ("npm run build produces a single dist/index.html, it is copied into assets, then Gradle 8.7 on JDK 17 runs assembleDebug." to "Build the web UI, copy to assets, assemble debug."),
        Intent.PRIVACY to ("No INTERNET permission is declared. No services or boot receivers exist. Every consent event is written to a hash-chained ledger." to "No internet permission, no background services."),
        Intent.FILE to ("Pick exactly one file. I return WORKS, PARTIALLY MATCHES or NOT RELEVANT with integration steps." to "Pick one file."),
        Intent.REPO to ("Milestones are graded IMPLEMENT NOW, DEFER or CHANGES NEEDED and progress is weighted so deferrals cannot inflate it." to "Milestones are graded and weighted."),
        Intent.DECISION to ("A decision is only stored with its mandatory reasoning sentence containing because and at least twelve words." to "Decisions need a reasoning sentence."),
        Intent.STATUS to ("HereticCore $version, LiteRT 2.3.0, STT android-native, TTS android-native, background services none." to "All subsystems nominal."),
        Intent.UNKNOWN to ("No intent matched above 0.5 confidence, so I will not guess. Reframe against one of the six workflows." to "Intent not matched."),
    )
}
