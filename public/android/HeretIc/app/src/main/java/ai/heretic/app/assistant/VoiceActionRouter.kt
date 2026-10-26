package ai.heretic.app.assistant

import ai.heretic.app.core.Decision
import ai.heretic.app.core.DecisionRule
import ai.heretic.app.core.ErrorAnalysis
import ai.heretic.app.core.ErrorEngine
import ai.heretic.app.core.FileAssessment
import ai.heretic.app.core.FileAssessor
import ai.heretic.app.core.HereticCore
import ai.heretic.app.core.MilestoneItem
import ai.heretic.app.core.MilestoneKind
import ai.heretic.app.core.RepoAssessor
import ai.heretic.app.core.RepoEvaluation
import ai.heretic.app.core.SolutionConfirmation

enum class AssistantActionKind {
    WAKE_ACKNOWLEDGED,
    WAKE_GATE_UPDATED,
    STOP_PLAYBACK,
    ERROR_ANALYZED,
    SOLUTION_CONFIRMED,
    FILE_ASSESSED,
    REPO_EVALUATED,
    GATE_UPDATED,
    DECISION_LOGGED,
    SYSTEM_STATUS,
    SAVE_WAV,
    LEXICON_UPDATED,
    CAPABILITIES,
    CONVERSATION,
}

data class RoutedAssistantResult(
    val kind: AssistantActionKind,
    val displayReply: String,
    val spokenReply: String,
    val targetTab: Int? = null,
    val errorAnalysis: ErrorAnalysis? = null,
    val solutionConfirmation: SolutionConfirmation? = null,
    val fileAssessment: FileAssessment? = null,
    val repoEvaluation: RepoEvaluation? = null,
)

/**
 * Deterministic voice & chat action router for the native Heretic Voice Assistant.
 *
 * Intercepts spoken or typed operator commands for all six Heretic workflows
 * (Voice/System, Error Loop, File Assessor, Repo Milestones, Authorization Gates,
 * and ADR Decision Log) and executes them immediately on-device. Open-ended prompts
 * return `null` so the caller routes them to `llama.cpp` GGUF, `LiteRT-LM`, or `HereticCore`.
 */
object VoiceActionRouter {

    private val STOP_WORDS = setOf("shaz", "stop", "silence", "quiet", "mute", "shut up", "cancel speech")

    private val FILE_EXT_REGEX = Regex(
        """([A-Za-z0-9._/-]+\.(?:gguf|litertlm|tflite|task|onnx|zip|wav|pcm|kt|java|safetensors|pt|ckpt|bin|pdf|md|txt))""",
        RegexOption.IGNORE_CASE,
    )

    fun isImmediateStop(utterance: String): Boolean {
        val clean = utterance.trim().lowercase().trim { !it.isLetterOrDigit() && !it.isWhitespace() }.trim()
        if (clean.isEmpty()) return false
        if (clean in STOP_WORDS) return true
        return clean.startsWith("shaz ") || clean.endsWith(" shaz") || clean == "stop talking" || clean == "stop speaking"
    }

    fun tryExecuteCommand(
        rawInput: String,
        core: HereticCore,
        milestonesProvider: () -> List<MilestoneItem>,
        onUpdateMilestones: (List<MilestoneItem>) -> Unit,
        onSaveLastWav: () -> Result<String>,
        onAddLexiconRule: (String, String) -> Unit,
        systemSummaryProvider: () -> Pair<String, String>,
        wakeWordRequiredProvider: () -> Boolean = { true },
        onSetWakeWordRequired: (Boolean) -> Unit = {},
    ): RoutedAssistantResult? {
        val rawTrimmed = rawInput.trim()
        if (rawTrimmed.isEmpty()) return null

        if (isImmediateStop(rawTrimmed)) {
            return RoutedAssistantResult(
                kind = AssistantActionKind.STOP_PLAYBACK,
                displayReply = "Playback halted immediately and audio buffers flushed.",
                spokenReply = "",
            )
        }

        val wakeParsed = com.heretic.voice.WakeWordDetector.parse(rawTrimmed)
        val trimmed = when (wakeParsed) {
            com.heretic.voice.WakeWordDetector.ParseResult.ImmediateStop -> {
                return RoutedAssistantResult(
                    kind = AssistantActionKind.STOP_PLAYBACK,
                    displayReply = "Playback halted immediately and audio buffers flushed.",
                    spokenReply = "",
                )
            }
            com.heretic.voice.WakeWordDetector.ParseResult.WakeOnly -> {
                return RoutedAssistantResult(
                    kind = AssistantActionKind.WAKE_ACKNOWLEDGED,
                    displayReply = "HERETIC AWAKE · Hands-free command window open (20s). Speak your command, or say \"shaz\" anytime to interrupt.",
                    spokenReply = "Heretic awake and listening. Go ahead.",
                )
            }
            is com.heretic.voice.WakeWordDetector.ParseResult.WokeWithCommand -> wakeParsed.command
            is com.heretic.voice.WakeWordDetector.ParseResult.Unprefixed -> wakeParsed.text
        }

        val lower = trimmed.lowercase()

        // 0. Wake-word inspection & toggle commands
        if (lower == "wake word" ||
            lower == "what is the wake word" ||
            lower == "what's the wake word" ||
            lower == "whats the wake word" ||
            lower == "what is your wake word"
        ) {
            val gateMode = if (wakeWordRequiredProvider()) "ON (hands-free waits for \"Heretic\")" else "OPEN MIC (all speech accepted)"
            return RoutedAssistantResult(
                kind = AssistantActionKind.WAKE_GATE_UPDATED,
                displayReply = "WAKE WORD      -> \"Heretic\" (or \"Hey Heretic\", e.g. \"Heretic, system status\")\n" +
                    "INTERRUPT WORD -> \"shaz\" (instant AudioTrack pause + flush)\n" +
                    "HANDS-FREE GATE -> $gateMode",
                spokenReply = "My wake word is Heretic, and my instant stop word is shaz.",
            )
        }

        if (lower == "enable wake word" ||
            lower == "require wake word" ||
            lower == "wake word on" ||
            lower == "wake gate on"
        ) {
            onSetWakeWordRequired(true)
            return RoutedAssistantResult(
                kind = AssistantActionKind.WAKE_GATE_UPDATED,
                displayReply = "Hands-free Wake Gate ENABLED -> Say \"Heretic\" (or \"Hey Heretic <command>\") to trigger hands-free actions.",
                spokenReply = "Wake word gate enabled. Say Heretic before hands-free commands.",
            )
        }

        if (lower == "disable wake word" ||
            lower == "wake word off" ||
            lower == "wake gate off" ||
            lower == "open mic mode"
        ) {
            onSetWakeWordRequired(false)
            return RoutedAssistantResult(
                kind = AssistantActionKind.WAKE_GATE_UPDATED,
                displayReply = "Hands-free Wake Gate DISABLED -> Open-mic continuous listening active (say \"shaz\" anytime to halt playback).",
                spokenReply = "Open mic mode enabled.",
            )
        }

        // 1. Raw stack trace or explicit "analyze error ..." command
        val looksLikeRawStackTrace = trimmed.contains("FATAL EXCEPTION") ||
            trimmed.contains("Caused by:") ||
            trimmed.contains("UnsatisfiedLinkError") ||
            trimmed.contains("OutOfMemoryError")
        if (looksLikeRawStackTrace ||
            lower.startsWith("analyze error") ||
            lower.startsWith("analyse error") ||
            lower.startsWith("diagnose error") ||
            lower.startsWith("diagnose crash") ||
            lower.startsWith("analyze crash")
        ) {
            val payload = trimmed
                .replace(Regex("^(analyze|analyse|diagnose)\\s+(error|crash)\\s*:?\\s*", RegexOption.IGNORE_CASE), "")
                .ifBlank { trimmed }
            val analysis = core.analyzeError(payload)
            return RoutedAssistantResult(
                kind = AssistantActionKind.ERROR_ANALYZED,
                displayReply = ErrorEngine.format(analysis),
                spokenReply = "${analysis.severity} severity. ${analysis.what} ${analysis.why}",
                targetTab = 2,
                errorAnalysis = analysis,
            )
        }

        // 2. Confirm solution paste-back
        if (lower.startsWith("confirm solution") ||
            lower.startsWith("confirm fix") ||
            lower.startsWith("paste back") ||
            lower.startsWith("check passed")
        ) {
            val payload = trimmed
                .replace(Regex("^(confirm\\s+(solution|fix)|paste\\s+back)\\s*:?\\s*", RegexOption.IGNORE_CASE), "")
                .ifBlank { trimmed }
            val conf = core.confirmSolution(payload)
            return RoutedAssistantResult(
                kind = AssistantActionKind.SOLUTION_CONFIRMED,
                displayReply = "VERDICT -> ${conf.status.label}\nEVIDENCE -> ${conf.evidence.joinToString(", ").ifEmpty { "none" }}\nNEXT -> ${conf.nextAction}\nNOTE -> ${conf.note}",
                spokenReply = "${conf.status.label}. ${conf.nextAction}",
                targetTab = 2,
                solutionConfirmation = conf,
            )
        }

        // 3. File relevance assessor ("assess file model.gguf" or bare filename)
        val explicitFileCmd = lower.startsWith("assess file") ||
            lower.startsWith("grade file") ||
            lower.startsWith("check file") ||
            lower.startsWith("evaluate file")
        val matchedFile = FILE_EXT_REGEX.find(trimmed)?.groupValues?.getOrNull(1)
        if (explicitFileCmd || (matchedFile != null && trimmed.split(Regex("\\s+")).size <= 3)) {
            val targetName = matchedFile
                ?: trimmed.replace(Regex("^(assess|grade|check|evaluate)\\s+file\\s*:?\\s*", RegexOption.IGNORE_CASE), "").trim()
            if (targetName.isNotEmpty()) {
                val assessment: FileAssessment = FileAssessor.assess(targetName)
                val formatted = buildString {
                    appendLine("FILE -> ${assessment.fileName} (${assessment.kind})")
                    appendLine("VERDICT -> ${assessment.relevance} · ${assessment.usefulness}% useful")
                    appendLine("TARGET -> ${assessment.targetModule}")
                    appendLine("RATIONALE -> ${assessment.rationale}")
                    assessment.whyNotUseful?.let { appendLine("WHY NOT -> $it") }
                    appendLine("INTEGRATION STEPS ->")
                    assessment.integrationSteps.forEachIndexed { idx, s -> appendLine("  ${idx + 1}. $s") }
                }.trimEnd()
                return RoutedAssistantResult(
                    kind = AssistantActionKind.FILE_ASSESSED,
                    displayReply = formatted,
                    spokenReply = "${assessment.fileName} graded ${assessment.relevance} at ${assessment.usefulness} percent usefulness.",
                    targetTab = 3,
                    fileAssessment = assessment,
                )
            }
        }

        // 4. Repository milestone commands
        if (lower.startsWith("complete milestone") || lower.startsWith("finish milestone")) {
            val query = trimmed.replace(Regex("^(complete|finish)\\s+milestone\\s*:?\\s*", RegexOption.IGNORE_CASE), "").trim()
            val current = milestonesProvider()
            var matchedTitle: String? = null
            val updated = current.map { item ->
                if (matchedTitle == null && item.title.contains(query, ignoreCase = true)) {
                    matchedTitle = item.title
                    item.copy(done = true)
                } else {
                    item
                }
            }
            if (matchedTitle != null) {
                onUpdateMilestones(updated)
                val eval = RepoAssessor.evaluate(updated)
                return RoutedAssistantResult(
                    kind = AssistantActionKind.REPO_EVALUATED,
                    displayReply = "Completed milestone: $matchedTitle\nWeighted progress: ${eval.progress}% (${eval.health})\nNext: ${eval.nextAction}",
                    spokenReply = "Marked $matchedTitle complete. Weighted progress is now ${eval.progress} percent, status ${eval.health}.",
                    targetTab = 4,
                    repoEvaluation = eval,
                )
            }
        }

        if (lower.startsWith("add milestone")) {
            val title = trimmed.replace(Regex("^add\\s+milestone\\s*:?\\s*", RegexOption.IGNORE_CASE), "").trim()
            if (title.length >= 3) {
                val updated = milestonesProvider() + MilestoneItem(title, MilestoneKind.IMPLEMENT_NOW, false)
                onUpdateMilestones(updated)
                val eval = RepoAssessor.evaluate(updated)
                return RoutedAssistantResult(
                    kind = AssistantActionKind.REPO_EVALUATED,
                    displayReply = "Added IMPLEMENT NOW milestone: $title\nWeighted progress: ${eval.progress}% (${eval.health})",
                    spokenReply = "Added milestone $title. Progress is ${eval.progress} percent.",
                    targetTab = 4,
                    repoEvaluation = eval,
                )
            }
        }

        if (lower.contains("repo progress") ||
            lower.contains("milestone status") ||
            lower.contains("repo status") ||
            lower == "milestones" ||
            lower == "evaluate repo"
        ) {
            val eval = RepoAssessor.evaluate(milestonesProvider())
            val summary = buildString {
                appendLine("REPO HEALTH -> ${eval.health} (${eval.progress}% weighted · ${eval.done}/${eval.total} done)")
                appendLine("VERDICT -> ${eval.verdict}")
                if (eval.blockers.isNotEmpty()) {
                    appendLine("BLOCKERS -> ${eval.blockers.joinToString("; ")}")
                }
                append("NEXT ACTION -> ${eval.nextAction}")
            }
            return RoutedAssistantResult(
                kind = AssistantActionKind.REPO_EVALUATED,
                displayReply = summary,
                spokenReply = "Repository health is ${eval.health} at ${eval.progress} percent weighted progress. ${eval.nextAction}",
                targetTab = 4,
                repoEvaluation = eval,
            )
        }

        // 5. Authorization gates & SHA-256 ledger
        if (lower.startsWith("grant gate") || lower.startsWith("allow gate") ||
            lower.startsWith("deny gate") || lower.startsWith("revoke gate")
        ) {
            val isGrant = lower.startsWith("grant") || lower.startsWith("allow")
            val targetKey = when {
                lower.contains("mic") -> "mic.capture"
                lower.contains("file") || lower.contains("saf") -> "file.saf.read"
                lower.contains("model") || lower.contains("gguf") || lower.contains("llm") -> "model.load"
                lower.contains("tts") || lower.contains("speak") || lower.contains("voice") -> "tts.speak"
                else -> "tts.speak"
            }
            val decision = if (isGrant) "GRANTED" else "DENIED"
            val entry = core.gates.record(targetKey, decision, source = "voice-assistant")
            return RoutedAssistantResult(
                kind = AssistantActionKind.GATE_UPDATED,
                displayReply = "GATE ${entry.decision} -> ${entry.key}\nAUDIT SHA-256 -> ${entry.auditHash.take(24)}…\nPREV HASH -> ${entry.prevHash.take(24)}…",
                spokenReply = "Gate ${entry.key} set to ${entry.decision.lowercase()} and appended to the SHA 256 audit ledger.",
                targetTab = 5,
            )
        }

        if (lower == "reset gates" || lower == "clear grants" || lower == "revoke all gates") {
            core.gates.clearInstanceGrants()
            return RoutedAssistantResult(
                kind = AssistantActionKind.GATE_UPDATED,
                displayReply = "All authorization gate instance grants cleared and ledger reset.",
                spokenReply = "Cleared all authorization gate grants.",
                targetTab = 5,
            )
        }

        if (lower.contains("verify gate") || lower.contains("verify ledger") ||
            lower.contains("audit chain") || lower.contains("gate status")
        ) {
            val brokenIdx = core.gates.verify()
            val entries = core.gates.entries()
            val activeGrants = core.gates.catalog.filter { core.gates.granted(it.key) }.map { it.key }
            val integrity = if (brokenIdx == -1) "VERIFIED INTACT (${entries.size} chained entries)" else "BROKEN AT INDEX $brokenIdx"
            return RoutedAssistantResult(
                kind = AssistantActionKind.GATE_UPDATED,
                displayReply = "LEDGER INTEGRITY -> $integrity\nACTIVE GRANTS -> ${activeGrants.joinToString(", ").ifEmpty { "none" }}",
                spokenReply = if (brokenIdx == -1) {
                    "Audit hash chain verified intact across ${entries.size} entries. Active grants: ${activeGrants.size}."
                } else {
                    "Warning: audit hash chain broken at index $brokenIdx."
                },
                targetTab = 5,
            )
        }

        // 6. Decision log (ADR)
        if (lower.startsWith("list decisions") || lower.startsWith("show decisions") || lower == "show adr" || lower == "decisions") {
            val all = core.decisions.all()
            val display = if (all.isEmpty()) {
                "No ADR decisions recorded yet."
            } else {
                all.joinToString("\n\n") { d ->
                    "[${d.ref}] ${d.title}\nChoice: ${d.choice}\nReasoning: ${d.reasoning}"
                }
            }
            return RoutedAssistantResult(
                kind = AssistantActionKind.DECISION_LOGGED,
                displayReply = display,
                spokenReply = "${all.size} architecture decisions are recorded in the offline log.",
                targetTab = 5,
            )
        }

        if (lower.startsWith("record decision") || lower.startsWith("log decision")) {
            val body = trimmed.replace(Regex("^(record|log)\\s+decision\\s*:?\\s*", RegexOption.IGNORE_CASE), "")
            val pipeParts = body.split("|").map { it.trim() }
            if (pipeParts.size >= 3) {
                val nextRef = "ADR-%03d".format(core.decisions.all().size + 9)
                val candidate = Decision(
                    ref = nextRef,
                    title = pipeParts[0],
                    context = "Recorded via Heretic Voice Assistant",
                    options = listOf(pipeParts[1], "Status quo"),
                    choice = pipeParts[1],
                    reasoning = pipeParts[2],
                    impact = "Persisted to append-only decisions.jsonl",
                )
                val res = core.decisions.append(candidate)
                return res.fold(
                    onSuccess = { saved ->
                        RoutedAssistantResult(
                            kind = AssistantActionKind.DECISION_LOGGED,
                            displayReply = "Saved ${saved.ref}: ${saved.title}\nChoice: ${saved.choice}\nReasoning: ${saved.reasoning}",
                            spokenReply = "Recorded ${saved.ref} into the decision log.",
                            targetTab = 5,
                        )
                    },
                    onFailure = { err ->
                        RoutedAssistantResult(
                            kind = AssistantActionKind.DECISION_LOGGED,
                            displayReply = "Decision rejected by validation rule: ${err.message}",
                            spokenReply = "Decision rejected. ${err.message}",
                            targetTab = 5,
                        )
                    },
                )
            } else {
                val hint = "Use format: record decision Title | Chosen Option | We chose X because at least twelve words..."
                val checkErrs = DecisionRule.validate("Sample", "Option", body)
                return RoutedAssistantResult(
                    kind = AssistantActionKind.DECISION_LOGGED,
                    displayReply = "$hint\nValidation notes: ${checkErrs.joinToString(" ")}",
                    spokenReply = "To record a decision, provide title, choice, and a reasoning sentence containing because with at least twelve words.",
                    targetTab = 5,
                )
            }
        }

        // 7. Save synthesized audio (.wav) & custom pronunciation lexicon
        if (lower == "save audio" || lower == "export wav" || lower == "save wav" || lower == "save last reply") {
            val saved = onSaveLastWav()
            return saved.fold(
                onSuccess = { path ->
                    RoutedAssistantResult(
                        kind = AssistantActionKind.SAVE_WAV,
                        displayReply = "Saved synthesized 16-bit PCM WAV audio to:\n$path",
                        spokenReply = "Saved the last voice response as a WAV file.",
                    )
                },
                onFailure = { err ->
                    RoutedAssistantResult(
                        kind = AssistantActionKind.SAVE_WAV,
                        displayReply = "WAV export unavailable: ${err.message}",
                        spokenReply = "No neural PCM audio buffer available to export yet.",
                    )
                },
            )
        }

        val pronounceMatch = Regex("^pronounce\\s+([A-Za-z0-9_-]+)\\s+as\\s+(.+)$", RegexOption.IGNORE_CASE).find(trimmed)
        if (pronounceMatch != null) {
            val word = pronounceMatch.groupValues[1].trim()
            val phonetic = pronounceMatch.groupValues[2].trim()
            onAddLexiconRule(word, phonetic)
            return RoutedAssistantResult(
                kind = AssistantActionKind.LEXICON_UPDATED,
                displayReply = "Added custom pronunciation rule: \"$word\" -> \"$phonetic\"",
                spokenReply = "Updated lexicon. I will pronounce $word as $phonetic.",
                targetTab = 1,
            )
        }

        // 8. System status & capabilities
        if (lower == "status" || lower == "system status" || lower == "device report" || lower == "diagnostics") {
            val (display, spoken) = systemSummaryProvider()
            return RoutedAssistantResult(
                kind = AssistantActionKind.SYSTEM_STATUS,
                displayReply = display,
                spokenReply = spoken,
            )
        }

        if (lower == "help" || lower == "commands" || lower == "what can you do" || lower == "list capabilities") {
            val display = buildString {
                appendLine("HERETIC NATIVE VOICE ASSISTANT — ACTIVE COMMANDS:")
                appendLine("• Wake Word: Say \"Heretic\" or \"Hey Heretic <command>\" in hands-free mode.")
                appendLine("• Interrupt / Barge-In: Say \"shaz\" or \"stop\" to immediately pause & flush AudioTrack.")
                appendLine("• Error Loop: \"analyze error <logcat>\" and \"confirm solution <paste-back>\"")
                appendLine("• File Assessor: \"assess file <name.gguf | .litertlm | .onnx | .zip>\"")
                appendLine("• Repo Milestones: \"repo progress\", \"complete milestone <name>\", \"add milestone <title>\"")
                appendLine("• Auth Gates: \"verify gates\", \"grant gate <mic|file|model|tts>\", \"deny gate <...>\"")
                appendLine("• Decision Log: \"list decisions\", \"record decision Title | Choice | ... because ...\"")
                appendLine("• Audio & Lexicon: \"save wav\", \"pronounce <word> as <phonetic>\", \"system status\"")
            }.trimEnd()
            return RoutedAssistantResult(
                kind = AssistantActionKind.CAPABILITIES,
                displayReply = display,
                spokenReply = "Say Heretic to wake hands-free listening, or say shaz anytime to interrupt playback. Seven offline workflows are ready: conversational AI, error analysis, file assessment, milestone tracking, SHA 256 authorization gates, architecture decision logging, and neural voice synthesis.",
            )
        }

        return null
    }
}
