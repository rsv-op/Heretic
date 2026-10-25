package com.heretic.voice

import ai.heretic.app.assistant.VoiceActionRouter

/**
 * Wake-word parser and hands-free standby gate for the **Heretic** Voice Assistant.
 *
 * - **Wake Word (`"heretic"`)**: Spoken alone (`"Heretic"`, `"Hey Heretic"`) or as a command
 *   prefix (`"Heretic, system status"`), wakes the assistant and opens a follow-up window.
 * - **Interrupt Word (`"shaz"`)**: Always bypasses the wake gate so playback can be paused
 *   and flushed at any instant.
 */
object WakeWordDetector {

    const val WAKE_KEYWORD = "heretic"
    const val STOP_KEYWORD = "shaz"
    const val DEFAULT_AWAKE_WINDOW_MS = 20_000L

    private val LEADING_WAKE_REGEX = Regex(
        pattern = "^(?:(?:hey|hi|ok|okay|yo|hello)\\s+|wake\\s+up\\s+|listen\\s+)?heretics?(?:['’]s)?(?:[\\s,.:;!?-]+(.*))?$",
        option = RegexOption.IGNORE_CASE,
    )

    sealed interface ParseResult {
        data object ImmediateStop : ParseResult
        data object WakeOnly : ParseResult
        data class WokeWithCommand(val command: String) : ParseResult
        data class Unprefixed(val text: String) : ParseResult
    }

    fun parse(rawTranscript: String): ParseResult {
        val trimmed = rawTranscript.trim()
        if (trimmed.isEmpty()) return ParseResult.Unprefixed("")

        if (VoiceActionRouter.isImmediateStop(trimmed)) {
            return ParseResult.ImmediateStop
        }

        val match = LEADING_WAKE_REGEX.matchEntire(trimmed)
        if (match != null) {
            val remainder = match.groupValues.getOrNull(1)
                ?.trim()
                ?.trimStart(',', ':', ';', '-', '.', '!', '?')
                ?.trim()
                .orEmpty()

            if (remainder.isEmpty()) {
                return ParseResult.WakeOnly
            }
            if (VoiceActionRouter.isImmediateStop(remainder)) {
                return ParseResult.ImmediateStop
            }
            return ParseResult.WokeWithCommand(remainder)
        }

        return ParseResult.Unprefixed(trimmed)
    }

    fun matchesWakeWord(rawTranscript: String): Boolean = when (parse(rawTranscript)) {
        is ParseResult.WakeOnly,
        is ParseResult.WokeWithCommand -> true
        else -> false
    }
}

sealed interface WakeGateDecision {
    data object IgnoredAmbient : WakeGateDecision
    data object ImmediateStop : WakeGateDecision
    data object WakeAcknowledged : WakeGateDecision
    data class Execute(val command: String, val wokeNow: Boolean) : WakeGateDecision
}

class WakeWordSessionGate(
    @Volatile var wakeWordRequired: Boolean = true,
    private val awakeWindowMs: Long = WakeWordDetector.DEFAULT_AWAKE_WINDOW_MS,
) {
    private var awakeUntilEpochMs: Long = 0L

    @Synchronized
    fun isAwake(nowMs: Long = System.currentTimeMillis()): Boolean = nowMs < awakeUntilEpochMs

    @Synchronized
    fun wake(nowMs: Long = System.currentTimeMillis()) {
        awakeUntilEpochMs = nowMs + awakeWindowMs
    }

    @Synchronized
    fun sleep() {
        awakeUntilEpochMs = 0L
    }

    @Synchronized
    fun evaluate(
        rawTranscript: String,
        fromHandsFreeStream: Boolean,
        nowMs: Long = System.currentTimeMillis(),
    ): WakeGateDecision {
        return when (val parsed = WakeWordDetector.parse(rawTranscript)) {
            WakeWordDetector.ParseResult.ImmediateStop -> WakeGateDecision.ImmediateStop

            WakeWordDetector.ParseResult.WakeOnly -> {
                awakeUntilEpochMs = nowMs + awakeWindowMs
                WakeGateDecision.WakeAcknowledged
            }

            is WakeWordDetector.ParseResult.WokeWithCommand -> {
                awakeUntilEpochMs = nowMs + awakeWindowMs
                WakeGateDecision.Execute(command = parsed.command, wokeNow = true)
            }

            is WakeWordDetector.ParseResult.Unprefixed -> {
                if (parsed.text.isEmpty()) {
                    WakeGateDecision.IgnoredAmbient
                } else if (!fromHandsFreeStream || !wakeWordRequired) {
                    WakeGateDecision.Execute(command = parsed.text, wokeNow = false)
                } else if (nowMs < awakeUntilEpochMs) {
                    awakeUntilEpochMs = nowMs + awakeWindowMs
                    WakeGateDecision.Execute(command = parsed.text, wokeNow = false)
                } else {
                    WakeGateDecision.IgnoredAmbient
                }
            }
        }
    }
}
