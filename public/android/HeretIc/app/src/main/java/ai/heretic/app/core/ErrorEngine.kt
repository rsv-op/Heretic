package ai.heretic.app.core

data class ErrorAnalysis(
    val what: String,
    val why: String,
    val solution: String,
    val rules: List<String>,
    val severity: String,
    val confidence: Int,
    val status: String = "AWAITING USER PASTE-BACK",
)

data class SolutionConfirmation(
    val status: Verdict,
    val evidence: List<String>,
    val nextAction: String,
    val note: String,
)

enum class Verdict(val label: String) {
    PASSED("CHECK PASSED"),
    FAILED("CHECK FAILED"),
    AWAITING("AWAITING USER PASTE-BACK"),
}

private data class Rule(
    val id: String,
    val label: String,
    val patterns: List<Regex>,
    val what: String,
    val why: String,
    val steps: List<String>,
    val severity: String,
)

object ErrorEngine {

    private val rules = listOf(
        Rule(
            id = "unsatisfied-link",
            label = "Native library missing",
            patterns = listOf(Regex("UnsatisfiedLinkError", RegexOption.IGNORE_CASE), Regex("dlopen failed", RegexOption.IGNORE_CASE)),
            what = "A JNI native library could not be loaded at runtime; the .so is missing for this ABI.",
            why = "Only one ABI was packaged, or externalNativeBuild output never reached jniLibs.",
            steps = listOf(
                "Add abiFilters for arm64-v8a and armeabi-v7a in defaultConfig.ndk.",
                "Confirm externalNativeBuild { cmake { path } } points at a real CMakeLists.txt.",
                "Inspect the package: unzip -l app-debug.apk | grep '.so'.",
                "Rebuild with ./gradlew :app:assembleDebug --rerun-tasks.",
            ),
            severity = "critical",
        ),
        Rule(
            id = "litert-delegate",
            label = "LiteRT GPU delegate init",
            patterns = listOf(Regex("GpuDelegate", RegexOption.IGNORE_CASE), Regex("litert", RegexOption.IGNORE_CASE)),
            what = "The LiteRT interpreter failed while attaching the GPU delegate.",
            why = "litert-gpu:2.3.0 needs OpenCL or Vulkan; emulators and some Mali drivers throw instead of degrading.",
            steps = listOf(
                "Wrap delegate creation in runCatching and fall back to setNumThreads(4).",
                "Declare both litert:2.3.0 and litert-gpu:2.3.0.",
                "Match the flatbuffer schema version used at export time.",
                "Cache the resolved backend so the probe runs once per install.",
            ),
            severity = "high",
        ),
        Rule(
            id = "permission-audio",
            label = "RECORD_AUDIO denied",
            patterns = listOf(Regex("SecurityException", RegexOption.IGNORE_CASE), Regex("RECORD_AUDIO", RegexOption.IGNORE_CASE)),
            what = "Audio capture started without a granted RECORD_AUDIO runtime permission.",
            why = "Dangerous permissions are never granted at install on API 23+.",
            steps = listOf(
                "Gate startListening behind the permission launcher's granted branch.",
                "Keep the manifest entry; the prompt alone is not enough.",
                "Route permanent denial to ACTION_APPLICATION_DETAILS_SETTINGS.",
                "Persist the consent decision in the authorization ledger.",
            ),
            severity = "high",
        ),
        Rule(
            id = "oom-weights",
            label = "OOM loading weights",
            patterns = listOf(Regex("OutOfMemoryError", RegexOption.IGNORE_CASE), Regex("bad_alloc", RegexOption.IGNORE_CASE)),
            what = "The process ran out of memory mapping model weights.",
            why = "An unquantised checkpoint was loaded against a 256-512 MB per-process heap.",
            steps = listOf(
                "Re-export at Q4_K_M or int8.",
                "Load with mmap instead of a Kotlin ByteArray.",
                "Log ActivityManager.memoryClass at startup.",
                "Move weights to filesDir on first run.",
            ),
            severity = "critical",
        ),
        Rule(
            id = "generic",
            label = "Unclassified runtime failure",
            patterns = listOf(Regex("FATAL EXCEPTION"), Regex("Caused by:")),
            what = "A fatal exception reached the default handler; only the generic signature matched.",
            why = "The excerpt is missing the Caused by chain or the first app frame.",
            steps = listOf(
                "Re-capture: adb logcat -d *:E | grep -A 40 'FATAL EXCEPTION'.",
                "Keep the first at ai.heretic.app.* frame.",
                "Paste the extended log back into the loop.",
            ),
            severity = "medium",
        ),
    )

    private val passSignals = listOf(
        Regex("check\\s*passed", RegexOption.IGNORE_CASE),
        Regex("it works", RegexOption.IGNORE_CASE),
        Regex("fixed|resolved|solved", RegexOption.IGNORE_CASE),
        Regex("build succeeded|0 errors", RegexOption.IGNORE_CASE),
    )

    private val failSignals = listOf(
        Regex("still (failing|crash|the same)", RegexOption.IGNORE_CASE),
        Regex("same error|new error", RegexOption.IGNORE_CASE),
        Regex("didn'?t work|does not work", RegexOption.IGNORE_CASE),
    )

    private val traceSignals = listOf(Regex("FATAL EXCEPTION"), Regex("Caused by:"), Regex("^\\s*at [\\w$.]+\\(", RegexOption.MULTILINE))

    fun analyze(rawLog: String): ErrorAnalysis {
        val hits = rules.filter { rule -> rule.patterns.any { it.containsMatchIn(rawLog) } }
        val matched = hits.ifEmpty { listOf(rules.last()) }
        val primary = matched.first()
        val solution = matched.flatMap { it.steps }.mapIndexed { i, s -> "${i + 1}. $s" }.joinToString("\n")
        val confidence = minOf(97, 48 + matched.size * 9 + if (rawLog.length > 900) 14 else if (rawLog.length > 260) 8 else 0)
        return ErrorAnalysis(
            what = primary.what,
            why = primary.why,
            solution = solution,
            rules = matched.map { it.id },
            severity = primary.severity,
            confidence = confidence,
        )
    }

    fun confirm(pasteBack: String): SolutionConfirmation {
        val passed = passSignals.filter { it.containsMatchIn(pasteBack) }
        val failed = failSignals.filter { it.containsMatchIn(pasteBack) }
        val traced = traceSignals.filter { it.containsMatchIn(pasteBack) }
        val evidence = buildList {
            if (passed.isNotEmpty()) add("pass signal matched")
            if (failed.isNotEmpty()) add("fail signal matched")
            if (traced.isNotEmpty()) add("stack frames present in paste-back")
        }
        return when {
            failed.isNotEmpty() || (traced.isNotEmpty() && passed.isEmpty()) -> SolutionConfirmation(
                Verdict.FAILED, evidence,
                "Re-run analysis on the new trace; the failure family may have changed.",
                "Loop stays open and both attempts remain auditable.",
            )
            passed.isNotEmpty() -> SolutionConfirmation(
                Verdict.PASSED, evidence,
                "Close the case and record the fix as a decision entry.",
                "Verified by user paste-back.",
            )
            else -> SolutionConfirmation(
                Verdict.AWAITING, evidence,
                "Apply the REQUEST SOLUTION steps, then paste the new logcat back.",
                "Heretic never claims a fix worked without your evidence.",
            )
        }
    }

    fun format(a: ErrorAnalysis): String = buildString {
        appendLine("WHAT  -> ${a.what}")
        appendLine("WHY   -> ${a.why}")
        appendLine("REQUEST SOLUTION ->")
        a.solution.lines().forEach { appendLine("   $it") }
        appendLine("SEVERITY -> ${a.severity.uppercase()}   CONFIDENCE -> ${a.confidence}%   RULES -> ${a.rules.joinToString(", ")}")
        append("NEXT -> apply, re-run, paste the new log back.")
    }
}
