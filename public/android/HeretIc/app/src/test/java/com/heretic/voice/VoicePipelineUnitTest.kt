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
        assertEquals("forty-two", NumberUtils.numberToWords(42L))
        val normalizedCurrency = CurrencyNormalizer.normalize("$12.50", "en")
        assertTrue(normalizedCurrency.lowercase().contains("twelve"))
    }
}
