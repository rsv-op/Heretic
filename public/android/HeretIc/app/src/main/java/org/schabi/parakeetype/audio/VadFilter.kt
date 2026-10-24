package org.schabi.parakeetype.audio

import android.content.Context
import android.util.Log
import java.io.File

private const val TAG = "VadFilter"
private const val HANGOVER_DRAIN_SAFETY_FRAMES = 20
private const val VOICE_PREFS_NAME = "heretic_voice_pipeline_prefs"
private const val KEY_STT_MODEL_DIR = "stt_model_dir"

private val VAD_FILENAMES = listOf(
    "silero_vad.onnx",
    "silero_vad_v6.onnx",
    "silero_vad_v5.onnx",
)

interface VadFilter {
    val isSpeechActive: Boolean
    val lastSpeechProbability: Float

    fun process(chunk: AudioChunk, rms: Float): List<AudioChunk>
    fun flush(): Boolean
    fun close() {}

    companion object {
        fun load(context: Context): VadFilter = try {
            val vadBytes = findVadModelBytes(context)
            if (vadBytes != null) {
                SileroVadFilter(modelBytes = vadBytes, threshold = 0.3f)
            } else {
                Log.w(TAG, "No Silero VAD ONNX file found in local model directories; falling back to RMSVadFilter")
                RMSVadFilter(0.4f)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Silero VAD failed to load; falling back to RMSVadFilter", e)
            RMSVadFilter(0.4f)
        }

        private fun findVadModelBytes(context: Context): ByteArray? {
            val candidateDirs = mutableListOf<File>()
            val configuredStt = context
                .getSharedPreferences(VOICE_PREFS_NAME, Context.MODE_PRIVATE)
                .getString(KEY_STT_MODEL_DIR, null)
                ?.trim()
            if (!configuredStt.isNullOrEmpty()) {
                val sttDir = File(configuredStt)
                candidateDirs += sttDir
                sttDir.parentFile?.let { candidateDirs += it }
            }
            candidateDirs += File(context.filesDir, "voice_models/stt")
            candidateDirs += File(context.filesDir, "voice_models")
            candidateDirs += File(context.filesDir, "models")
            context.getExternalFilesDir(null)?.let { ext ->
                candidateDirs += File(ext, "voice_models/stt")
                candidateDirs += File(ext, "voice_models")
                candidateDirs += File(ext, "models")
            }

            for (dir in candidateDirs.distinct()) {
                if (!dir.exists() || !dir.isDirectory) continue
                for (name in VAD_FILENAMES) {
                    val f = File(dir, name)
                    if (f.exists() && f.isFile && f.canRead() && f.length() > 1024L) {
                        Log.i(TAG, "Loading Silero VAD from ${f.absolutePath}")
                        return f.readBytes()
                    }
                }
            }

            for (name in VAD_FILENAMES) {
                val assetBytes = runCatching {
                    context.assets.open(name).use { it.readBytes() }
                }.getOrNull()
                if (assetBytes != null && assetBytes.size > 1024) {
                    Log.i(TAG, "Loading Silero VAD from APK assets/$name")
                    return assetBytes
                }
            }

            return null
        }
    }
}

fun VadFilter.drainHangover(frameSamples: Int): List<AudioChunk> {
    if (!isSpeechActive) return emptyList()
    val silence = AudioChunk(ShortArray(frameSamples))
    val drained = mutableListOf<AudioChunk>()
    var safetyFrames = HANGOVER_DRAIN_SAFETY_FRAMES
    while (isSpeechActive && safetyFrames-- > 0) {
        drained += process(silence, 0f)
    }
    Log.d(TAG, "VAD hangover drain complete (framesLeft=$safetyFrames)")
    return drained
}
