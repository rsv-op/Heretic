package ai.heretic.app.ml

import ai.heretic.app.core.FileAssessor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LiteRtLmModelsTest {

    private val gib = LiteRtLmModels.GIB
    private val arm64 = listOf("arm64-v8a", "armeabi-v7a")

    @Test
    fun sixGbDeviceDefaultsToGemma4E2B() {
        val spec = LiteRtLmModels.select(8 * gib, arm64)
        assertEquals(LiteRtLmModels.GEMMA_4_E2B, spec)
        assertEquals("gemma-4-e2b-it-int4.litertlm", spec!!.fileName)
    }

    @Test
    fun fourGbDeviceFallsBackToGemma3nE2B() {
        val spec = LiteRtLmModels.select(4 * gib, arm64)
        assertEquals(LiteRtLmModels.GEMMA_3N_E2B, spec)
        assertEquals("gemma-3n-e2b-it-int4.litertlm", spec!!.fileName)
    }

    @Test
    fun thresholdIsExactlySixGib() {
        assertEquals(LiteRtLmModels.GEMMA_3N_E2B, LiteRtLmModels.select(6 * gib - 1, arm64))
        assertEquals(LiteRtLmModels.GEMMA_4_E2B, LiteRtLmModels.select(6 * gib, arm64))
    }

    @Test
    fun thirtyTwoBitArmIsRefusedInsteadOfCrashingTheNativeLoader() {
        assertNull(LiteRtLmModels.select(8 * gib, listOf("armeabi-v7a", "armeabi")))
        assertTrue(LiteRtLmModels.abiSupported(arm64))
        assertTrue(!LiteRtLmModels.abiSupported(listOf("x86")))
    }

    @Test
    fun freeSpaceBudgetCoversTheWholeDownload() {
        val need = LiteRtLmModels.requiredFreeBytes(LiteRtLmModels.GEMMA_4_E2B)
        assertTrue(need > LiteRtLmModels.GEMMA_4_E2B.approxBytes)
        assertTrue(need < LiteRtLmModels.GEMMA_4_E2B.approxBytes * 2)
    }

    @Test
    fun modelIsResolvedFromASafDisplayName() {
        assertEquals(LiteRtLmModels.GEMMA_4_E2B, LiteRtLmModels.byFileName("gemma-4-e2b-it-int4.litertlm"))
        assertEquals(LiteRtLmModels.GEMMA_3N_E2B, LiteRtLmModels.byFileName("primary:Download/gemma-3n-e2b-it-int4.litertlm"))
        assertNull(LiteRtLmModels.byFileName("wake-word.tflite"))
    }
}

class LiteRtLmFileAssessmentTest {

    @Test
    fun litertlmGradesAsWorksAt99Percent() {
        val a = FileAssessor.assess("gemma-4-e2b-it-int4.litertlm")
        assertEquals("WORKS", a.relevance)
        assertEquals(99, a.usefulness)
        assertTrue(a.rationale.contains("litertlm-android:0.18.0"))
    }

    @Test
    fun fullSizeBundleKeepsItsGradeAndStreamsToFilesDir() {
        val a = FileAssessor.assess("gemma-4-e2b-it-int4.litertlm", 2_581_000_000L)
        assertEquals("WORKS", a.relevance)
        assertEquals(99, a.usefulness)
        assertTrue(a.rationale.contains("filesDir/models"))
        assertTrue(a.integrationSteps.any { it.contains("copyUriToModelsDir") })
    }
}
