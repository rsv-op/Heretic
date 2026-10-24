package org.schabi.parakeetype.audio

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.isActive
import kotlin.math.sqrt

private const val TAG = "AudioCaptureManager"
private const val SAMPLE_RATE = 16_000
private const val CHUNK_SAMPLES = 512
private const val SILENCED_CHECK_INTERVAL_CHUNKS = 10
private const val VOICE_PREFS_NAME = "heretic_voice_pipeline_prefs"
private const val KEY_PREFERRED_MIC_ID = "preferred_mic_id"

class AudioCaptureManager(private val context: Context) {

    @Volatile
    private var stopRequested: Boolean = false

    fun stopCapture() {
        stopRequested = true
    }

    @SuppressLint("MissingPermission")
    fun startCapture(
        vadEnabled: Boolean = true,
        rawSource: Boolean = false,
        onLevel: ((Float) -> Unit)? = null,
        onSpeechProbability: ((Float) -> Unit)? = null,
    ): Flow<AudioChunk> =
        channelFlow {
            if (!PermissionHelper.hasRecordPermission(context)) {
                throw SecurityException(
                    "RECORD_AUDIO permission is not granted. Grant microphone access in HeretIc to start voice capture."
                )
            }

            stopRequested = false

            val vad: VadFilter? = if (vadEnabled) {
                VadFilter.load(context)
            } else {
                Log.d(TAG, "VAD disabled")
                null
            }

            val minBufferBytes = AudioRecord.getMinBufferSize(
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
            )
            val bufferBytes = maxOf(minBufferBytes, CHUNK_SAMPLES * 2 * 2)

            val source = if (rawSource && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                MediaRecorder.AudioSource.UNPROCESSED
            } else {
                MediaRecorder.AudioSource.DEFAULT
            }

            val recorder = try {
                val builder = AudioRecord.Builder()
                    .setAudioSource(source)
                    .setAudioFormat(
                        AudioFormat.Builder()
                            .setSampleRate(SAMPLE_RATE)
                            .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .build()
                    )
                    .setBufferSizeInBytes(bufferBytes)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    builder.setContext(context)
                }
                builder.build()
            } catch (e: UnsupportedOperationException) {
                throw IllegalStateException("AudioRecord failed to initialise: ${e.message}", e)
            }

            check(recorder.state == AudioRecord.STATE_INITIALIZED) {
                "AudioRecord failed to initialise (state=${recorder.state})"
            }

            applyPreferredMic(recorder)

            val buffer = ShortArray(CHUNK_SAMPLES)

            try {
                recorder.startRecording()
                if (recorder.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
                    throw MicrophoneBusyException("AudioRecord did not start recording")
                }
                Log.d(TAG, "AudioRecord started - chunk=$CHUNK_SAMPLES samples, buf=$bufferBytes bytes")

                var chunksRead = 0
                while (currentCoroutineContext().isActive && !stopRequested) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
                        chunksRead++ % SILENCED_CHECK_INTERVAL_CHUNKS == 0 &&
                        recorder.activeRecordingConfiguration?.isClientSilenced == true
                    ) {
                        throw MicrophoneBusyException("Recording is silenced - another app holds the microphone")
                    }
                    val read = recorder.read(buffer, 0, buffer.size)
                    when {
                        read > 0 -> {
                            val samples = buffer.copyOf(read)
                            val chunk = AudioChunk(samples = samples)
                            val rms = calculateRms(chunk.samples)
                            onLevel?.invoke(rms)

                            val toSend = vad?.process(chunk, rms) ?: listOf(chunk)
                            if (vad != null) onSpeechProbability?.invoke(vad.lastSpeechProbability)
                            for (c in toSend) {
                                send(c)
                            }
                        }

                        read == AudioRecord.ERROR_DEAD_OBJECT -> {
                            Log.e(TAG, "AudioRecord ERROR_DEAD_OBJECT - stopping capture")
                            return@channelFlow
                        }

                        read < 0 -> {
                            Log.w(TAG, "AudioRecord read returned error code: $read")
                        }
                    }
                }

                if (stopRequested && currentCoroutineContext().isActive) {
                    var drained: Int
                    do {
                        drained = recorder.read(buffer, 0, buffer.size, AudioRecord.READ_NON_BLOCKING)
                        if (drained > 0) {
                            val chunk = AudioChunk(samples = buffer.copyOf(drained))
                            val rms = calculateRms(chunk.samples)
                            val toSend = vad?.process(chunk, rms) ?: listOf(chunk)
                            for (c in toSend) {
                                send(c)
                            }
                        }
                    } while (drained > 0)

                    if (vad != null) {
                        for (c in vad.drainHangover(CHUNK_SAMPLES)) {
                            send(c)
                        }
                    }
                }
            } finally {
                vad?.flush()
                vad?.close()
                runCatching { recorder.stop() }
                runCatching { recorder.release() }
                Log.d(TAG, "AudioRecord stopped and released")
            }
        }.flowOn(Dispatchers.IO)

    private fun applyPreferredMic(recorder: AudioRecord) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return
        val id = context
            .getSharedPreferences(VOICE_PREFS_NAME, Context.MODE_PRIVATE)
            .getInt(KEY_PREFERRED_MIC_ID, 0)
        if (id == 0) return

        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        val device: AudioDeviceInfo = audioManager
            .getDevices(AudioManager.GET_DEVICES_INPUTS)
            .firstOrNull { it.id == id }
            ?: run {
                Log.w(TAG, "Preferred mic id=$id not present — using system default")
                return
            }
        try {
            recorder.setPreferredDevice(device)
            Log.d(TAG, "Applied preferred mic id=$id")
        } catch (e: Exception) {
            Log.w(TAG, "setPreferredDevice failed for id=$id", e)
        }
    }
}

internal fun calculateRms(samples: ShortArray): Float {
    if (samples.isEmpty()) return 0f
    val sumOfSquares = samples.fold(0.0) { acc, s -> acc + s.toDouble() * s.toDouble() }
    val rms = sqrt(sumOfSquares / samples.size)
    return (rms / Short.MAX_VALUE.toDouble()).toFloat().coerceIn(0f, 1f)
}
