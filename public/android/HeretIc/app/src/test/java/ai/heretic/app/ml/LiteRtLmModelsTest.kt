package ai.heretic.app.ml

import ai.heretic.app.core.ErrorEngine
import ai.heretic.app.core.FileAssessor
import ai.heretic.app.core.Verdict
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

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

class LiteRtDelegateFallbackTest {

    @Test
    fun gpuDelegateExceptionFallsBackToFourCpuThreadsAndCachesOncePerInstall() {
        val store = InMemoryBackendStore()
        var gpuProbes = 0
        var cpuFallbackThreads = 0

        val (firstRuntime, firstRecord) = LiteRtBackendResolver.resolve(
            namespace = LiteRtBackendResolver.NAMESPACE_TFLITE,
            installStamp = "install-100:mali-g710:litert-2.3.0",
            store = store,
            createGpu = {
                gpuProbes++
                throw IllegalArgumentException("GpuDelegate could not be created: OpenCL not available on Mali")
            },
            createCpu = { threads ->
                cpuFallbackThreads = threads
                "cpu-interpreter(threads=$threads)"
            },
        )

        assertEquals("cpu-interpreter(threads=4)", firstRuntime)
        assertEquals(4, cpuFallbackThreads)
        assertEquals(ResolvedLiteRtBackend.CPU, firstRecord.backend)
        assertEquals(4, firstRecord.cpuThreads)
        assertFalse(firstRecord.probedFromCache)
        assertEquals(1, gpuProbes)
        assertTrue(firstRecord.probeNote.contains("OpenCL not available"))

        // Second model load on the SAME install stamp must NOT touch the broken GPU driver again.
        val (secondRuntime, secondRecord) = LiteRtBackendResolver.resolve(
            namespace = LiteRtBackendResolver.NAMESPACE_TFLITE,
            installStamp = "install-100:mali-g710:litert-2.3.0",
            store = store,
            createGpu = {
                gpuProbes++
                error("Should never re-probe GPU within the same install")
            },
            createCpu = { threads ->
                "cpu-interpreter(threads=$threads)"
            },
        )

        assertEquals("cpu-interpreter(threads=4)", secondRuntime)
        assertEquals(ResolvedLiteRtBackend.CPU, secondRecord.backend)
        assertTrue(secondRecord.probedFromCache)
        assertEquals(1, gpuProbes)

        // Fresh APK install / updated driver stamp re-probes once cleanly.
        val (thirdRuntime, thirdRecord) = LiteRtBackendResolver.resolve(
            namespace = LiteRtBackendResolver.NAMESPACE_TFLITE,
            installStamp = "install-200:vulkan-driver-ota:litert-2.3.0",
            store = store,
            createGpu = {
                gpuProbes++
                "gpu-compiled-model"
            },
            createCpu = { threads -> "cpu-interpreter(threads=$threads)" },
        )

        assertEquals("gpu-compiled-model", thirdRuntime)
        assertEquals(ResolvedLiteRtBackend.GPU, thirdRecord.backend)
        assertFalse(thirdRecord.probedFromCache)
        assertEquals(2, gpuProbes)
    }

    @Test
    fun flatbufferSchemaValidatesTfl3Version3AndRejectsMismatchedExports() {
        val validTfl3 = buildSyntheticFlatbuffer(identifier = "TFL3", schemaVersion = 3)
        val header = LiteRtFlatbufferSchema.inspect(validTfl3)
        assertTrue(header.isCompatible)
        assertEquals("TFL3", header.identifier)
        assertEquals(3, header.schemaVersion)
        assertEquals(header, LiteRtFlatbufferSchema.requireCompatible(header, "wake_word_v3.tflite"))

        val legacyTfl2 = buildSyntheticFlatbuffer(identifier = "TFL2", schemaVersion = 2)
        val mismatchErr = assertThrows(IllegalArgumentException::class.java) {
            LiteRtFlatbufferSchema.requireCompatible(
                LiteRtFlatbufferSchema.inspect(legacyTfl2),
                "legacy_v2.tflite",
            )
        }
        assertTrue(mismatchErr.message!!.contains("FLATBUFFER SCHEMA MISMATCH"))
        assertTrue(mismatchErr.message!!.contains("litert:2.3.0"))

        val wrongSchemaVersion = buildSyntheticFlatbuffer(identifier = "TFL3", schemaVersion = 4)
        assertThrows(IllegalArgumentException::class.java) {
            LiteRtFlatbufferSchema.requireCompatible(
                LiteRtFlatbufferSchema.inspect(wrongSchemaVersion),
                "future_v4.tflite",
            )
        }
    }

    @Test
    fun pasteBackVerificationLogClosesErrorEngineLitertDelegateLoop() {
        val postFixLog = "CHECK PASSED: build succeeded, 0 errors. LiteRT 2.3.0 + litert-gpu 2.3.0 " +
            "delegate wrapped in runCatching -> CPU fallback setNumThreads(4), TFL3 schema v3 verified, " +
            "resolved backend cached once per install."
        val confirmation = ErrorEngine.confirm(postFixLog)
        assertEquals(Verdict.PASSED, confirmation.status)
    }

    /**
     * Constructs a binary FlatBuffer header matching `tflite/converter/schema/schema.fbs`:
     * - `[0..3]`: uint32 offset to root `Model` table (`16`)
     * - `[4..7]`: 4-byte ASCII `file_identifier` (e.g. `"TFL3"`)
     * - `[8..15]`: vtable (`vtableLen = 6`, `tableLen = 8`, `field[0] (version) offset = 4`)
     * - `[16..19]`: int32 signed vtable offset (`16 - 8 = 8`)
     * - `[20..23]`: uint32 `Model.version`
     */
    private fun buildSyntheticFlatbuffer(identifier: String, schemaVersion: Int): ByteArray {
        require(identifier.length == 4)
        val buf = ByteBuffer.allocate(24).order(ByteOrder.LITTLE_ENDIAN)
        buf.putInt(0, 16)
        identifier.toByteArray(Charsets.US_ASCII).forEachIndexed { i, b -> buf.put(4 + i, b) }
        buf.putShort(8, 6)
        buf.putShort(10, 8)
        buf.putShort(12, 4)
        buf.putInt(16, 8)
        buf.putInt(20, schemaVersion)
        return buf.array()
    }
}
