package org.schabi.parakeetype.audio

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

data class MicCalibrationResult(
    val snrDb: Float,
    val hfFraction: Float,
    val rmsDbfs: Float,
    val qualityScore: Float,
    val verdict: String,
)

/**
 * Pure-Kotlin microphone quality scorer and live 16 kHz calibration probe adapted from
 * Parakeetype's `MicCalibration`. Evaluates signal-to-noise ratio (dB) and high-frequency
 * fricative preservation (> 3 kHz) for reliable VAD and Parakeet TDT recognition.
 */
object MicScorer {
    const val SAMPLE_RATE = 16_000
    const val HF_CUTOFF_HZ = 3_000f

    fun scoreSamples(samples: FloatArray, sampleRate: Int = SAMPLE_RATE): MicCalibrationResult {
        if (samples.size < 512) {
            return MicCalibrationResult(
                snrDb = 0f,
                hfFraction = 0f,
                rmsDbfs = -96f,
                qualityScore = 0f,
                verdict = "Insufficient audio frames captured",
            )
        }

        val frameSize = 320 // 20 ms @ 16 kHz
        val frameRms = ArrayList<Float>(samples.size / frameSize)
        var idx = 0
        var sumSqAll = 0.0
        while (idx + frameSize <= samples.size) {
            var sumSq = 0.0
            for (i in 0 until frameSize) {
                val v = samples[idx + i].toDouble()
                sumSq += v * v
            }
            sumSqAll += sumSq
            frameRms.add(sqrt(sumSq / frameSize).toFloat())
            idx += frameSize
        }

        val overallRms = sqrt(sumSqAll / idx.coerceAtLeast(1)).toFloat()
        val rmsDbfs = (20.0 * log10(max(overallRms.toDouble(), 1e-5))).toFloat()

        val sorted = frameRms.sorted()
        val noiseFloor = sorted[(sorted.size * 0.15).toInt().coerceIn(0, sorted.lastIndex)].coerceAtLeast(1e-5f)
        val peakLevel = sorted[(sorted.size * 0.90).toInt().coerceIn(0, sorted.lastIndex)].coerceAtLeast(noiseFloor)
        val snrDb = (20.0 * log10((peakLevel / noiseFloor).toDouble())).toFloat().coerceAtLeast(0f)

        val hfFraction = estimateHighFrequencyFraction(samples, sampleRate)
        val snrNorm = (snrDb / 30f).coerceIn(0f, 1f)
        val hfNorm = (hfFraction / 0.25f).coerceIn(0f, 1f)
        val quality = ((snrNorm * 0.65f + hfNorm * 0.35f) * 100f).coerceIn(0f, 100f)

        val verdict = when {
            overallRms < 0.002f -> "Quiet room / no speech detected (${String.format(java.util.Locale.US, "%.1f", rmsDbfs)} dBFS) — speak during calibration"
            quality >= 70f -> "Excellent mic clarity for hands-free VAD + Parakeet STT"
            quality >= 40f -> "Good capture clarity — suitable for offline voice commands"
            else -> "High ambient noise floor — move closer to mic or use shaz keyword"
        }

        return MicCalibrationResult(
            snrDb = snrDb,
            hfFraction = hfFraction,
            rmsDbfs = rmsDbfs,
            qualityScore = quality,
            verdict = verdict,
        )
    }

    /**
     * First-difference high-pass energy ratio paired with Goertzel probes at 3.5 kHz and 5.5 kHz.
     */
    private fun estimateHighFrequencyFraction(samples: FloatArray, sampleRate: Int): Float {
        val windowLen = minOf(samples.size, sampleRate)
        if (windowLen < 64) return 0f
        var totalEnergy = 0.0
        var diffEnergy = 0.0
        for (i in 1 until windowLen) {
            val s = samples[i].toDouble()
            val d = (samples[i] - samples[i - 1]).toDouble()
            totalEnergy += s * s
            diffEnergy += d * d
        }
        if (totalEnergy <= 1e-12) return 0f
        val goertzel35 = goertzelPower(samples, windowLen, 3_500.0, sampleRate.toDouble())
        val goertzel55 = goertzelPower(samples, windowLen, 5_500.0, sampleRate.toDouble())
        val diffRatio = (diffEnergy / (4.0 * totalEnergy)).coerceIn(0.0, 1.0)
        val probeRatio = ((goertzel35 + goertzel55) / totalEnergy).coerceIn(0.0, 1.0)
        return ((diffRatio * 0.7 + probeRatio * 0.3)).toFloat().coerceIn(0f, 1f)
    }

    private fun goertzelPower(samples: FloatArray, n: Int, targetHz: Double, fs: Double): Double {
        val k = (0.5 + (n * targetHz / fs)).toInt()
        val omega = (2.0 * PI * k) / n
        val coeff = 2.0 * cos(omega)
        var q1 = 0.0
        var q2 = 0.0
        for (i in 0 until n) {
            val q0 = coeff * q1 - q2 + samples[i]
            q2 = q1
            q1 = q0
        }
        val real = q1 - q2 * cos(omega)
        val imag = q2 * sin(omega)
        return (real * real + imag * imag) / n
    }

    @SuppressLint("MissingPermission")
    suspend fun measureLiveMicrophone(durationMs: Long = 1_800L): Result<MicCalibrationResult> =
        withContext(Dispatchers.IO) {
            runCatching {
                val minBuf = AudioRecord.getMinBufferSize(
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                ).coerceAtLeast(4096)

                val record = AudioRecord(
                    MediaRecorder.AudioSource.VOICE_RECOGNITION,
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    minBuf * 2,
                )
                check(record.state == AudioRecord.STATE_INITIALIZED) {
                    "AudioRecord failed to initialize at 16 kHz mono"
                }

                val targetSamples = ((SAMPLE_RATE * durationMs) / 1000L).toInt().coerceAtLeast(3200)
                val captured = FloatArray(targetSamples)
                val shortBuf = ShortArray(1024)
                var offset = 0

                try {
                    record.startRecording()
                    while (offset < targetSamples) {
                        val toRead = minOf(shortBuf.size, targetSamples - offset)
                        val read = record.read(shortBuf, 0, toRead)
                        if (read <= 0) break
                        for (i in 0 until read) {
                            captured[offset + i] = shortBuf[i] / 32768f
                        }
                        offset += read
                    }
                    record.stop()
                } finally {
                    record.release()
                }

                val trimmed = if (offset == captured.size) captured else captured.copyOf(offset)
                scoreSamples(trimmed, SAMPLE_RATE)
            }
        }
}
