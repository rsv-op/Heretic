package com.heretic.voice

import com.brahmadeo.supertonic.tts.utils.CurrencyNormalizer
import com.brahmadeo.supertonic.tts.utils.NumberUtils
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.schabi.parakeetype.audio.SpeechEndpointer
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.file.Files
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class VoicePipelineUnitTest {

    @Test
    fun `sentence streaming buffer guards decimals and abbreviations across token boundaries`() = runTest {
        val emitted = mutableListOf<String>()
        val buffer = SentenceStreamingBuffer { emitted += it }

        buffer.appendPiece("Dr.")
        buffer.appendPiece(" Smith measured ")
        buffer.appendPiece("3.")
        assertTrue("Decimal lookahead must hold emission until next char arrives", emitted.isEmpty())

        buffer.appendPiece("14 meters")
        buffer.appendPiece(".")
        assertTrue("Period without trailing lookahead must wait", emitted.isEmpty())

        buffer.appendPiece(" Next sentence!")
        buffer.appendPiece(" ")
        assertEquals(
            listOf("Dr. Smith measured 3.14 meters.", "Next sentence!"),
            emitted,
        )
    }

    @Test
    fun `sentence streaming buffer clear discards unspoken text on barge-in`() = runTest {
        val emitted = mutableListOf<String>()
        val buffer = SentenceStreamingBuffer { emitted += it }

        buffer.appendPiece("Partial unspoken thought without boundary")
        buffer.clear()
        buffer.flush()

        assertTrue(emitted.isEmpty())
    }

    @Test
    fun `stop keyword matcher detects shaz with punctuation and ignores unrelated words`() {
        assertTrue(UnifiedVoiceOrchestrator.matchesStopKeyword("shaz"))
        assertTrue(UnifiedVoiceOrchestrator.matchesStopKeyword("Shaz."))
        assertTrue(UnifiedVoiceOrchestrator.matchesStopKeyword("SHAZ!"))
        assertTrue(UnifiedVoiceOrchestrator.matchesStopKeyword("shaz stop talking"))
        assertFalse(UnifiedVoiceOrchestrator.matchesStopKeyword("Shazam is a movie."))
        assertFalse(UnifiedVoiceOrchestrator.matchesStopKeyword("What is the weather today?"))
    }

    @Test
    fun `speech endpointer emits SpeechStart then EndOfSpeech on sustained silence`() {
        val endpointer = SpeechEndpointer(silenceMs = 640L, minimumLengthMs = 256L)

        var startFired = false
        for (i in 1..8) {
            val ev = endpointer.onFrame(0.85f)
            if (ev == SpeechEndpointer.Event.SpeechStart) startFired = true
        }
        assertTrue(startFired)

        var endEvent: SpeechEndpointer.Event? = null
        for (i in 1..20) {
            val ev = endpointer.onFrame(0.05f)
            if (ev != null) endEvent = ev
        }
        assertEquals(SpeechEndpointer.Event.EndOfSpeech, endEvent)
        assertNull(endpointer.onFrame(0.9f))
    }

    @Test
    fun `supertonic number and currency normalizers expand spoken English tokens`() {
        assertEquals("forty two", NumberUtils.convert(42L))
        val normalizedCurrency = CurrencyNormalizer().normalize("$12.50")
        assertTrue(normalizedCurrency.lowercase().contains("dollar"))
    }

    @Test
    fun `model config store extracts nested STT and TTS zip bundles and validates all 3 slots`() {
        val tempRoot = Files.createTempDirectory("heretic_voice_test").toFile()
        try {
            val ggufFile = tempRoot.resolve("qwen2.5.gguf").apply {
                writeBytes(ByteArray(32).also {
                    it[0] = 0x47; it[1] = 0x47; it[2] = 0x55; it[3] = 0x46
                })
            }

            val sttZipBytes = buildZip(
                mapOf(
                    "parakeet-tdt-stt-models/encoder.int8.onnx" to byteArrayOf(1, 2, 3),
                    "parakeet-tdt-stt-models/decoder.int8.onnx" to byteArrayOf(1, 2, 3),
                    "parakeet-tdt-stt-models/joiner.int8.onnx" to byteArrayOf(1, 2, 3),
                    "parakeet-tdt-stt-models/nemo128.onnx" to byteArrayOf(1, 2, 3),
                    "parakeet-tdt-stt-models/vocab.txt" to "<unk> 0\n".toByteArray(),
                )
            )
            val sttTarget = tempRoot.resolve("stt")
            val resolvedStt = VoiceModelConfigStore.extractModelZipStream(
                inputStream = ByteArrayInputStream(sttZipBytes),
                targetDir = sttTarget,
                slot = "stt",
            )

            val ttsZipBytes = buildZip(
                mapOf(
                    "supertonic-tts/onnx/duration_predictor.onnx" to byteArrayOf(1, 2, 3),
                    "supertonic-tts/onnx/text_encoder.onnx" to byteArrayOf(1, 2, 3),
                    "supertonic-tts/onnx/vector_estimator.onnx" to byteArrayOf(1, 2, 3),
                    "supertonic-tts/onnx/vocoder.onnx" to byteArrayOf(1, 2, 3),
                    "supertonic-tts/onnx/tts.json" to """{"ae":{"sample_rate":44100}}""".toByteArray(),
                    "supertonic-tts/onnx/unicode_indexer.json" to "[0,1,2]".toByteArray(),
                    "supertonic-tts/voice_styles/M1.json" to """{"style_ttl":{},"style_dp":{}}""".toByteArray(),
                )
            )
            val ttsTarget = tempRoot.resolve("tts")
            val resolvedTts = VoiceModelConfigStore.extractModelZipStream(
                inputStream = ByteArrayInputStream(ttsZipBytes),
                targetDir = ttsTarget,
                slot = "tts",
            )

            val styleFile = VoiceModelConfigStore.discoverVoiceStyle(resolvedTts)
            assertTrue("Expected M1.json voice style", styleFile != null && styleFile.name == "M1.json")

            val readiness = VoiceModelConfigStore.validate(
                VoiceModelPaths(
                    llamaModelPath = ggufFile.absolutePath,
                    sttModelDir = resolvedStt.absolutePath,
                    ttsModelDir = resolvedTts.absolutePath,
                    voiceStylePath = styleFile!!.absolutePath,
                )
            )
            assertTrue("Expected all 3 slots ready: $readiness", readiness.allReady)
        } finally {
            tempRoot.deleteRecursively()
        }
    }

    @Test
    fun `model config store detects GitHub source repo folder without onnx weights`() {
        val tempRoot = Files.createTempDirectory("heretic_repo_detect").toFile()
        try {
            val fakeSttRepo = tempRoot.resolve("Parakeetype-main").apply {
                mkdirs()
                resolve("build.gradle.kts").writeText("plugins {}")
            }
            val fakeTtsRepo = tempRoot.resolve("supertonic-android-main").apply {
                mkdirs()
                resolve("settings.gradle.kts").writeText("rootProject.name = \"supertonic\"")
            }
            val readiness = VoiceModelConfigStore.validate(
                VoiceModelPaths(
                    llamaModelPath = "",
                    sttModelDir = fakeSttRepo.absolutePath,
                    ttsModelDir = fakeTtsRepo.absolutePath,
                    voiceStylePath = "",
                )
            )
            assertFalse(readiness.sttReady)
            assertFalse(readiness.ttsReady)
            assertTrue(readiness.sttMessage.contains("Source code repo detected"))
            assertTrue(readiness.ttsMessage.contains("Source code repo detected"))
        } finally {
            tempRoot.deleteRecursively()
        }
    }

    private fun buildZip(entries: Map<String, ByteArray>): ByteArray {
        val baos = ByteArrayOutputStream()
        ZipOutputStream(baos).use { zos ->
            for ((name, bytes) in entries) {
                zos.putNextEntry(ZipEntry(name))
                zos.write(bytes)
                zos.closeEntry()
            }
        }
        return baos.toByteArray()
    }
}
