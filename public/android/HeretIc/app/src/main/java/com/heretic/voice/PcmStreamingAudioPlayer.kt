package com.heretic.voice

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.util.Log
import com.brahmadeo.supertonic.tts.SupertonicTTS
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.Closeable
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Low-latency streaming PCM16 mono [AudioTrack] consumer for [UnifiedVoiceOrchestrator].
 *
 * Configured with [AudioAttributes.USAGE_ASSISTANT], [AudioAttributes.CONTENT_TYPE_SPEECH],
 * [AudioFormat.ENCODING_PCM_16BIT], and [AudioFormat.CHANNEL_OUT_MONO].
 *
 * Calling [stopImmediate] on `"shaz"` or Silero VAD barge-in immediately invokes
 * [AudioTrack.pause] and [AudioTrack.flush], drops all queued PCM chunks, and aborts any
 * in-flight write loop within one 20 ms frame slice.
 */
class PcmStreamingAudioPlayer : Closeable {
    companion object {
        private const val TAG = "PcmStreamingAudioPlayer"
        private const val DEFAULT_SAMPLE_RATE_HZ = 44_100
        private const val SUBFRAME_DIVISOR = 50 // 20 ms slices for instant barge-in responsiveness
    }

    private data class QueuedPcmChunk(
        val epoch: Long,
        val sampleRateHz: Int,
        val pcm16Le: ByteArray,
    )

    private val trackLock = Any()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val chunkChannel = Channel<QueuedPcmChunk>(Channel.UNLIMITED)
    private val playbackEpoch = AtomicLong(0L)
    private val pendingChunkCount = AtomicInteger(0)

    private var audioTrack: AudioTrack? = null
    private var activeSampleRateHz: Int = 0

    private val _playingState = MutableStateFlow(false)
    val playingState: StateFlow<Boolean> = _playingState.asStateFlow()

    val isPlaying: Boolean
        get() = _playingState.value

    init {
        scope.launch {
            consumeLoop()
        }
    }

    /**
     * Queues a synthesized 16-bit little-endian mono PCM chunk for immediate streaming playback.
     */
    fun enqueueChunk(
        pcm16Le: ByteArray,
        sampleRateHz: Int = SupertonicTTS.getAudioSampleRate(),
    ) {
        if (pcm16Le.size < 2) return
        val alignedSize = pcm16Le.size and 1.inv()
        if (alignedSize <= 0) return
        val payload = if (alignedSize == pcm16Le.size) pcm16Le else pcm16Le.copyOf(alignedSize)
        val resolvedRate = if (sampleRateHz in 8_000..96_000) sampleRateHz else DEFAULT_SAMPLE_RATE_HZ
        val epochSnapshot = playbackEpoch.get()

        pendingChunkCount.incrementAndGet()
        _playingState.value = true
        val sent = chunkChannel.trySend(
            QueuedPcmChunk(
                epoch = epochSnapshot,
                sampleRateHz = resolvedRate,
                pcm16Le = payload,
            )
        )
        if (!sent.isSuccess) {
            if (pendingChunkCount.decrementAndGet() <= 0) {
                pendingChunkCount.set(0)
                _playingState.value = false
            }
        }
    }

    /**
     * Immediately halts speaker output via [AudioTrack.pause] and [AudioTrack.flush] and discards
     * all queued PCM buffers. Safe to invoke from any thread (VAD capture thread, STT coroutine, UI).
     */
    fun stopImmediate() {
        playbackEpoch.incrementAndGet()

        while (chunkChannel.tryReceive().isSuccess) {
            // Drain queued chunks from prior epoch
        }
        pendingChunkCount.set(0)

        synchronized(trackLock) {
            val track = audioTrack
            if (track != null && track.state == AudioTrack.STATE_INITIALIZED) {
                try {
                    if (track.playState == AudioTrack.PLAYSTATE_PLAYING) {
                        track.pause()
                    }
                    track.flush()
                } catch (e: IllegalStateException) {
                    Log.w(TAG, "AudioTrack pause/flush state race during barge-in", e)
                }
            }
        }

        _playingState.value = false
    }

    override fun close() {
        release()
    }

    fun release() {
        stopImmediate()
        chunkChannel.close()
        scope.cancel()
        synchronized(trackLock) {
            val track = audioTrack
            audioTrack = null
            activeSampleRateHz = 0
            if (track != null) {
                runCatching {
                    if (track.state == AudioTrack.STATE_INITIALIZED) {
                        track.stop()
                    }
                }
                runCatching { track.release() }
            }
        }
    }

    private suspend fun consumeLoop() {
        for (item in chunkChannel) {
            try {
                if (!scope.isActive) break
                if (item.epoch != playbackEpoch.get()) {
                    continue
                }
                writeChunkStreaming(item)
            } catch (ce: CancellationException) {
                throw ce
            } catch (e: Exception) {
                Log.e(TAG, "Error streaming PCM chunk to AudioTrack", e)
            } finally {
                val remaining = pendingChunkCount.decrementAndGet()
                if (remaining <= 0) {
                    pendingChunkCount.set(0)
                    if (item.epoch == playbackEpoch.get()) {
                        // Allow hardware ring buffer tail (~80 ms) to finish audible playout while keeping
                        // isPlaying=true for VAD barge-in detection unless interrupted.
                        delay(80L)
                        if (pendingChunkCount.get() == 0) {
                            _playingState.value = false
                        }
                    } else {
                        _playingState.value = false
                    }
                }
            }
        }
    }

    private fun writeChunkStreaming(item: QueuedPcmChunk) {
        val track = ensureTrackInitialized(item.sampleRateHz) ?: return
        val sliceBytes = (((item.sampleRateHz / SUBFRAME_DIVISOR) * 2).coerceAtLeast(512)) and 1.inv()

        synchronized(trackLock) {
            if (item.epoch != playbackEpoch.get()) return
            if (track.state == AudioTrack.STATE_INITIALIZED && track.playState != AudioTrack.PLAYSTATE_PLAYING) {
                try {
                    track.play()
                } catch (e: IllegalStateException) {
                    Log.e(TAG, "Failed to transition AudioTrack to PLAYSTATE_PLAYING", e)
                    return
                }
            }
        }

        var offset = 0
        val total = item.pcm16Le.size
        while (offset < total && item.epoch == playbackEpoch.get()) {
            val toWrite = minOf(sliceBytes, total - offset) and 1.inv()
            if (toWrite <= 0) break

            val written = try {
                track.write(item.pcm16Le, offset, toWrite, AudioTrack.WRITE_BLOCKING)
            } catch (e: IllegalStateException) {
                Log.w(TAG, "AudioTrack write interrupted", e)
                break
            }

            if (written <= 0) {
                if (written < 0) {
                    Log.w(TAG, "AudioTrack.write returned error code $written")
                }
                break
            }
            offset += written
        }
    }

    private fun ensureTrackInitialized(sampleRateHz: Int): AudioTrack? {
        synchronized(trackLock) {
            val existing = audioTrack
            if (existing != null &&
                existing.state == AudioTrack.STATE_INITIALIZED &&
                activeSampleRateHz == sampleRateHz
            ) {
                return existing
            }

            if (existing != null) {
                runCatching {
                    if (existing.state == AudioTrack.STATE_INITIALIZED) {
                        existing.pause()
                        existing.flush()
                        existing.stop()
                    }
                }
                runCatching { existing.release() }
                audioTrack = null
                activeSampleRateHz = 0
            }

            val minBuf = AudioTrack.getMinBufferSize(
                sampleRateHz,
                AudioFormat.CHANNEL_OUT_MONO,
                AudioFormat.ENCODING_PCM_16BIT
            )
            if (minBuf <= 0) {
                Log.e(TAG, "Invalid AudioTrack minBufferSize=$minBuf for sampleRate=$sampleRateHz")
                return null
            }

            val bufferBytes = (minBuf * 2).coerceAtLeast(4096)
            val attributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()

            val format = AudioFormat.Builder()
                .setSampleRate(sampleRateHz)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .build()

            return try {
                val created = AudioTrack.Builder()
                    .setAudioAttributes(attributes)
                    .setAudioFormat(format)
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .setBufferSizeInBytes(bufferBytes)
                    .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
                    .build()

                if (created.state != AudioTrack.STATE_INITIALIZED) {
                    created.release()
                    Log.e(TAG, "AudioTrack failed to reach STATE_INITIALIZED")
                    null
                } else {
                    audioTrack = created
                    activeSampleRateHz = sampleRateHz
                    Log.i(TAG, "AudioTrack initialized (${sampleRateHz} Hz, PCM16 mono, buf=$bufferBytes bytes)")
                    created
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to construct low-latency AudioTrack", e)
                null
            }
        }
    }
}
