package com.brahmadeo.supertonic.tts.utils

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

object WavUtils {
    private const val HEADER_BYTES = 44

    fun saveWav(
        file: File,
        pcmData: ByteArray,
        sampleRate: Int = 44_100,
        channels: Int = 1,
        bitsPerSample: Int = 16,
    ) {
        file.parentFile?.mkdirs()
        val dataSize = pcmData.size
        val byteRate = sampleRate * channels * bitsPerSample / 8
        val blockAlign = channels * bitsPerSample / 8

        val header = ByteArray(HEADER_BYTES)
        val buffer = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)

        buffer.put("RIFF".toByteArray(Charsets.US_ASCII))
        buffer.putInt(36 + dataSize)
        buffer.put("WAVE".toByteArray(Charsets.US_ASCII))

        buffer.put("fmt ".toByteArray(Charsets.US_ASCII))
        buffer.putInt(16)
        buffer.putShort(1.toShort())
        buffer.putShort(channels.toShort())
        buffer.putInt(sampleRate)
        buffer.putInt(byteRate)
        buffer.putShort(blockAlign.toShort())
        buffer.putShort(bitsPerSample.toShort())

        buffer.put("data".toByteArray(Charsets.US_ASCII))
        buffer.putInt(dataSize)

        FileOutputStream(file).use { fos ->
            fos.write(header)
            fos.write(pcmData)
            fos.flush()
        }
    }

    fun readWavPcm(file: File): Pair<ByteArray, Int>? {
        if (!file.isFile || file.length() <= HEADER_BYTES) return null
        val all = file.readBytes()
        val header = ByteBuffer.wrap(all, 0, HEADER_BYTES).order(ByteOrder.LITTLE_ENDIAN)
        val riff = String(all, 0, 4, Charsets.US_ASCII)
        val wave = String(all, 8, 4, Charsets.US_ASCII)
        if (riff != "RIFF" || wave != "WAVE") return null
        val sampleRate = header.getInt(24).coerceIn(8_000, 96_000)
        val pcm = all.copyOfRange(HEADER_BYTES, all.size)
        return pcm to sampleRate
    }

    fun playWavBlocking(file: File): Boolean {
        val (pcm, sampleRate) = readWavPcm(file) ?: return false
        if (pcm.isEmpty()) return false
        val minBuf = AudioTrack.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        ).coerceAtLeast(4096)

        val track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(sampleRate)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(maxOf(minBuf, pcm.size.coerceAtMost(sampleRate * 2)))
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()

        return try {
            track.play()
            var offset = 0
            while (offset < pcm.size) {
                val chunk = minOf(8192, pcm.size - offset)
                val written = track.write(pcm, offset, chunk)
                if (written <= 0) break
                offset += written
            }
            track.stop()
            true
        } finally {
            track.release()
        }
    }
}
