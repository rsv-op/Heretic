package ai.heretic.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DecisionSeedTest {

    @Test
    fun everyBaselineSeedSatisfiesTheMandatoryReasoningRule() {
        for (seed in DecisionSeeds.ALL) {
            val errors = DecisionRule.validate(seed.title, seed.choice, seed.reasoning)
            assertTrue("${seed.ref} was rejected: ${errors.joinToString(" ")}", errors.isEmpty())
        }
    }

    @Test
    fun baselineSeedsCarryBecauseAndAtLeastTwelveWords() {
        for (seed in DecisionSeeds.ALL) {
            val words = seed.reasoning.trim().split(Regex("\\s+")).filter { it.isNotBlank() }
            assertTrue("${seed.ref} reasoning is too short", words.size >= DecisionRule.MIN_WORDS)
            assertTrue("${seed.ref} has no because", seed.reasoning.contains("because", ignoreCase = true))
        }
    }

    @Test
    fun baselineSeedsDocumentAllFiveArchitectureDecisions() {
        val refs = DecisionSeeds.ALL.map { it.ref }
        assertEquals(listOf("ADR-009", "ADR-010", "ADR-011", "ADR-012", "ADR-013"), refs)
        assertTrue(DecisionSeeds.WEB_ASSET_LOADER.choice.contains("WebViewAssetLoader"))
        assertTrue(DecisionSeeds.ABI_FILTERS.choice.contains("arm64-v8a"))
        assertTrue(DecisionSeeds.UNIFIED_VOICE_PIPELINE.reasoning.contains("AudioTrack"))
        assertTrue(DecisionSeeds.NATIVE_VOICE_ASSISTANT_SHELL.choice.contains("Jetpack Compose"))
        assertTrue(DecisionSeeds.LITERT_DELEGATE_FALLBACK_CACHE.choice.contains("setNumThreads(4)"))
    }

    @Test
    fun seedingSkipsRefsAlreadyInTheLog() {
        assertEquals(5, DecisionSeeds.missing(emptyList()).size)
        assertEquals(DecisionSeeds.ALL, DecisionSeeds.missing(emptyList()))
        assertEquals(
            listOf(
                DecisionSeeds.ABI_FILTERS,
                DecisionSeeds.UNIFIED_VOICE_PIPELINE,
                DecisionSeeds.NATIVE_VOICE_ASSISTANT_SHELL,
                DecisionSeeds.LITERT_DELEGATE_FALLBACK_CACHE,
            ),
            DecisionSeeds.missing(listOf("ADR-009")),
        )
        assertEquals(
            emptyList<Decision>(),
            DecisionSeeds.missing(listOf("ADR-009", "ADR-010", "ADR-011", "ADR-012", "ADR-013")),
        )
        assertEquals(DecisionSeeds.ALL, DecisionSeeds.missing(listOf("ADR-001", "ADR-008")))
    }
}
