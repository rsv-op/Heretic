package org.schabi.parakeetype.audio

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.util.Log
import java.nio.FloatBuffer
import java.nio.LongBuffer

private const val TAG = "SileroVadFilter"

/**
 * Stateful neural-network VAD filter using Silero VAD v5/v6 (ONNX).
 *
 * Preserves the RNN state tensor `[2, 1, 128]` and 64-sample acoustic context across
 * consecutive 512-sample chunks within a capture session, resetting cleanly on [flush].
 */
class SileroVadFilter(
    modelBytes: ByteArray,
    private val threshold: Float = 0.3f,
    private val leadInFrames: Int = LEAD_IN_FRAMES,
    private val onsetFrames: Int = ONSET_FRAMES,
) : VadFilter {

    private enum class State { SILENCE, SPEECH }

    private var env: OrtEnvironment? = null
    private var session: OrtSession? = null

    private val rnnState: FloatArray = FloatArray(STATE_SIZE)
    private val input: FloatArray = FloatArray(CONTEXT_SAMPLES + REQUIRED_SAMPLES)

    private var state = State.SILENCE
    private var onsetCount = 0
    private var hangoverFrames = 0
    private var consecutiveSilenceFrames = 0
    private val leadIn = ArrayDeque<AudioChunk>(leadInFrames + 1)

    override val isSpeechActive: Boolean get() = state == State.SPEECH

    override var lastSpeechProbability: Float = 0f
        private set

    init {
        try {
            env = OrtEnvironment.getEnvironment()
            val opts = OrtSession.SessionOptions().apply {
                setIntraOpNumThreads(1)
                setExecutionMode(OrtSession.SessionOptions.ExecutionMode.SEQUENTIAL)
                setOptimizationLevel(OrtSession.SessionOptions.OptLevel.BASIC_OPT)
            }
            session = env?.createSession(modelBytes, opts)
            Log.d(TAG, "Silero VAD loaded (${modelBytes.size} bytes)")
            opts.close()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load Silero VAD model from bytes", e)
            session = null
        }
    }

    override fun process(chunk: AudioChunk, rms: Float): List<AudioChunk> {
        val e = env
        val s = session
        var speechProb = 0f

        if (e != null && s != null && chunk.samples.size == REQUIRED_SAMPLES) {
            try {
                for (i in 0 until REQUIRED_SAMPLES) {
                    input[CONTEXT_SAMPLES + i] = chunk.samples[i] / 32_768f
                }

                val inputTensor = OnnxTensor.createTensor(
                    e,
                    FloatBuffer.wrap(input),
                    longArrayOf(1, input.size.toLong())
                )
                val srTensor = OnnxTensor.createTensor(
                    e,
                    LongBuffer.wrap(longArrayOf(SAMPLE_RATE.toLong())),
                    longArrayOf(1)
                )
                val stateTensor = OnnxTensor.createTensor(
                    e,
                    FloatBuffer.wrap(rnnState),
                    longArrayOf(2, 1, 128)
                )

                val inputs = mapOf(
                    "input" to inputTensor,
                    "sr" to srTensor,
                    "state" to stateTensor
                )

                try {
                    s.run(inputs).use { result ->
                        val outputTensor = result.get("output").get() as OnnxTensor
                        speechProb = outputTensor.floatBuffer[0]

                        val stateNTensor = result.get("stateN").get() as OnnxTensor
                        stateNTensor.floatBuffer.get(rnnState)
                    }
                } finally {
                    inputTensor.close()
                    srTensor.close()
                    stateTensor.close()
                }

                input.copyInto(input, destinationOffset = 0, startIndex = REQUIRED_SAMPLES)
            } catch (ex: Exception) {
                Log.e(TAG, "Silero VAD inference failed", ex)
            }
        } else {
            speechProb = if (rms > 0.01f) 1.0f else 0.0f
        }

        lastSpeechProbability = speechProb
        return applySmoothing(chunk, speechProb)
    }

    private fun applySmoothing(chunk: AudioChunk, prob: Float): List<AudioChunk> {
        return when (state) {
            State.SILENCE -> {
                if (leadIn.size >= leadInFrames) leadIn.removeFirst()
                leadIn.addLast(chunk)

                if (prob >= threshold) {
                    onsetCount++
                    if (onsetCount >= onsetFrames) {
                        state = State.SPEECH
                        onsetCount = 0
                        hangoverFrames = 0
                        consecutiveSilenceFrames = 0
                        val out = leadIn.toList()
                        leadIn.clear()
                        out
                    } else {
                        emptyList()
                    }
                } else {
                    onsetCount = 0
                    consecutiveSilenceFrames++
                    if (consecutiveSilenceFrames == SILENCE_BOUNDARY_FRAMES) {
                        consecutiveSilenceFrames = 0
                        listOf(AudioChunk(ShortArray(0), isSilenceBoundary = true))
                    } else {
                        emptyList()
                    }
                }
            }

            State.SPEECH -> {
                if (prob >= threshold) {
                    hangoverFrames = 0
                    listOf(chunk)
                } else {
                    hangoverFrames++
                    if (hangoverFrames >= HANGOVER_FRAMES) {
                        state = State.SILENCE
                        hangoverFrames = 0
                        onsetCount = 0
                        leadIn.clear()
                        emptyList()
                    } else {
                        listOf(chunk)
                    }
                }
            }
        }
    }

    override fun flush(): Boolean {
        val wasSpeech = state == State.SPEECH
        state = State.SILENCE
        hangoverFrames = 0
        onsetCount = 0
        consecutiveSilenceFrames = 0
        leadIn.clear()
        rnnState.fill(0f)
        input.fill(0f)
        return wasSpeech
    }

    override fun close() {
        session?.close()
        session = null
    }

    companion object {
        private const val SAMPLE_RATE = 16_000
        internal const val REQUIRED_SAMPLES = 512
        private const val CONTEXT_SAMPLES = 64
        private const val STATE_SIZE = 2 * 1 * 128
        private const val ONSET_FRAMES = 1
        private const val LEAD_IN_FRAMES = 20
        private const val HANGOVER_FRAMES = 15
        internal const val SILENCE_BOUNDARY_FRAMES = 20
        internal const val SHORT_UTT_VAD_ONSET_MS = 30
        internal const val SHORT_UTT_VAD_LEAD_IN_MS = 200
    }
}
