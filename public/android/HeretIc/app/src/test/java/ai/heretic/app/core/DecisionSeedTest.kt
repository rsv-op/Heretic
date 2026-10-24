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
    fun baselineSeedsDocumentTheAssetLoaderAndAbiDecisions() {
        val refs = DecisionSeeds.ALL.map { it.ref }
        assertEquals(listOf("ADR-009", "ADR-010"), refs)
        assertTrue(DecisionSeeds.WEB_ASSET_LOADER.choice.contains("WebViewAssetLoader"))
        assertTrue(DecisionSeeds.WEB_ASSET_LOADER.reasoning.contains("allowFileAccess"))
        assertTrue(DecisionSeeds.ABI_FILTERS.choice.contains("arm64-v8a"))
        assertTrue(DecisionSeeds.ABI_FILTERS.reasoning.contains("UnsatisfiedLinkError"))
    }

    @Test
    fun seedingSkipsRefsAlreadyInTheLog() {
        assertEquals(2, DecisionSeeds.missing(emptyList()).size)
        assertEquals(DecisionSeeds.ALL, DecisionSeeds.missing(emptyList()))
        assertEquals(listOf(DecisionSeeds.ABI_FILTERS), DecisionSeeds.missing(listOf("ADR-009")))
        assertEquals(emptyList<Decision>(), DecisionSeeds.missing(listOf("ADR-009", "ADR-010")))
        assertEquals(DecisionSeeds.ALL, DecisionSeeds.missing(listOf("ADR-001", "ADR-008")))
    }
}
