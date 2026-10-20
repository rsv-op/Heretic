package ai.heretic.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ErrorEngineTest {

    @Test
    fun classifiesUnsatisfiedLinkAsNativeLibraryFailure() {
        val log = """
            FATAL EXCEPTION: main
            java.lang.UnsatisfiedLinkError: dlopen failed: library "libheretic_jni.so" not found
                at ai.heretic.app.ml.LiteRtEngine.load(LiteRtEngine.kt:41)
        """.trimIndent()

        val analysis = ErrorEngine.analyze(log)
        assertTrue(analysis.rules.contains("unsatisfied-link"))
        assertEquals("critical", analysis.severity)
        assertTrue(analysis.what.contains("JNI"))
        assertEquals("AWAITING USER PASTE-BACK", analysis.status)
    }

    @Test
    fun pasteBackWithPassSignalClosesTheLoop() {
        val confirmation = ErrorEngine.confirm("Rebuilt with abiFilters, check passed, the .so is in lib/arm64-v8a now.")
        assertEquals(Verdict.PASSED, confirmation.status)
    }

    @Test
    fun pasteBackWithFreshTraceKeepsTheLoopOpen() {
        val confirmation = ErrorEngine.confirm("Still failing: FATAL EXCEPTION main, Caused by: java.lang.OutOfMemoryError")
        assertEquals(Verdict.FAILED, confirmation.status)
    }

    @Test
    fun emptyPasteBackAwaitsTheUser() {
        assertEquals(Verdict.AWAITING, ErrorEngine.confirm("ok").status)
    }
}

class FileAssessorTest {

    @Test
    fun tfliteGradesAsWorks() {
        val a = FileAssessor.assess("wake-word.tflite")
        assertEquals("WORKS", a.relevance)
        assertTrue(a.usefulness >= 90)
        assertTrue(a.integrationSteps.isNotEmpty())
    }

    @Test
    fun safetensorsGradesAsNotRelevantWithReason() {
        val a = FileAssessor.assess("heretic-7b.safetensors")
        assertEquals("NOT RELEVANT", a.relevance)
        assertTrue(a.whyNotUseful!!.contains("heap"))
    }

    @Test
    fun hugeGgufIsWarnedAboutAssetShipping() {
        val a = FileAssessor.assess("heretic-13b-q4.gguf", 700L * 1024 * 1024)
        assertEquals("WORKS", a.relevance)
        assertTrue(a.rationale.contains("filesDir"))
    }
}

class RepoAssessorTest {

    @Test
    fun deferredWorkCannotInflateProgress() {
        val items = listOf(
            MilestoneItem("Wire WebView bridge", MilestoneKind.IMPLEMENT_NOW, true),
            MilestoneItem("Ship Vulkan path", MilestoneKind.DEFER, true),
            MilestoneItem("Fix R8 keep rules", MilestoneKind.CHANGES_NEEDED, false),
        )
        val evaluation = RepoAssessor.evaluate(items)
        assertTrue(evaluation.progress < 80)
        assertEquals("AT_RISK", evaluation.health)
        assertTrue(evaluation.blockers.contains("Fix R8 keep rules"))
    }
}

class DecisionRuleTest {

    @Test
    fun rejectsReasoningWithoutBecause() {
        val errors = DecisionRule.validate("Use LiteRT", "LiteRT 2.3.0", "It is the smallest runtime available on device today")
        assertTrue(errors.any { it.contains("because") })
    }

    @Test
    fun acceptsFullReasoningSentence() {
        val errors = DecisionRule.validate(
            "Use LiteRT with GPU delegate",
            "litert:2.3.0 + litert-gpu:2.3.0",
            "We chose LiteRT with the GPU delegate because it is the only runtime that loads our int8 models without adding a second inference stack to a 150 MB APK.",
        )
        assertTrue(errors.isEmpty())
    }
}
