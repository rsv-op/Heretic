package com.brahmadeo.supertonic.tts

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.LongBuffer
import java.util.Random
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicReference
import java.util.regex.Pattern

object SupertonicTTS {
    private const val TAG = "SupertonicTTS"
    private const val DEFAULT_SAMPLE_RATE = 44_100

    private var nativeLibraryAvailable: Boolean = false
    private var nativePtr: Long = 0L
    private var ortFallbackEngine: OrtSupertonicEngine? = null
    private var currentModelPath: String? = null

    private val HINDI_SPLIT_PATTERN = Pattern.compile("([.!?\\u0964\\u0965]['\\u2019\\u201D\\u0022)}\\]]?)\\s+")
    private val JAPANESE_SPLIT_PATTERN = Pattern.compile("([。！？][」』）｝\\]]?)\\s*")
    private val DEFAULT_SPLIT_PATTERN = Pattern.compile("([.!?]['\\u2019\\u201D\\u0022)}\\]]?)\\s+")

    private val PARAGRAPH_REGEX = Regex("\\n\\s*\\n")
    private val COMMA_REGEX = Regex("[,\\u3001]")
    private val WHITESPACE_REGEX = Regex("\\s+")

    init {
        try {
            System.loadLibrary("onnxruntime")
        } catch (e: UnsatisfiedLinkError) {
            Log.w(TAG, "libonnxruntime.so not preloaded explicitly: ${e.message}")
        }
        nativeLibraryAvailable = try {
            System.loadLibrary("supertonic_tts")
            true
        } catch (_: UnsatisfiedLinkError) {
            Log.i(TAG, "libsupertonic_tts.so not bundled; using Kotlin ONNX Runtime Supertonic engine")
            false
        }
    }

    private external fun init(modelPath: String, libPath: String, ortThreads: Int, xnnThreads: Int): Long
    private external fun synthesize(
        ptr: Long,
        text: String,
        lang: String,
        stylePath: String,
        speed: Float,
        bufferSeconds: Float,
        steps: Int,
        gain: Float,
        sibilanceMode: Int
    ): ByteArray
    private external fun getSocClass(ptr: Long): Int
    private external fun getSampleRate(ptr: Long): Int
    private external fun close(ptr: Long)
    private external fun reset(ptr: Long)
    private external fun nativeChunkText(text: String, lang: String): String

    private class SessionContext(val sid: Long, val listener: ProgressListener?)
    private val currentSession = AtomicReference<SessionContext?>(null)

    interface ProgressListener {
        fun onProgress(sessionId: Long, current: Int, total: Int)
        fun onAudioChunk(sessionId: Long, data: ByteArray)
    }

    fun notifyProgress(current: Int, total: Int) {
        val ctx = currentSession.get()
        val sid = ctx?.sid ?: 0L
        ctx?.listener?.onProgress(sid, current, total)
    }

    fun notifyAudioChunk(data: ByteArray) {
        val ctx = currentSession.get()
        val sid = ctx?.sid ?: 0L
        ctx?.listener?.onAudioChunk(sid, data)
    }

    @Volatile
    private var cancelledFlag = false

    fun setCancelled(cancelled: Boolean) {
        cancelledFlag = cancelled
    }

    fun isCancelled(): Boolean = cancelledFlag

    @Volatile
    var sibilanceMode: Int = 1

    @Volatile
    private var sessionIdCounter: Long = 0L

    @Synchronized
    fun isInitialized(modelPath: String): Boolean {
        if (currentModelPath != modelPath) return false
        if (nativeLibraryAvailable && nativePtr != 0L) {
            return runCatching { getSocClass(nativePtr) != -1 }.getOrDefault(false)
        }
        return ortFallbackEngine != null
    }

    @Synchronized
    fun initialize(
        modelPath: String,
        libPath: String,
        ortThreads: Int = 4,
        xnnThreads: Int = 1
    ): Boolean {
        val normalizedPath = modelPath.trim()
        if (normalizedPath.isEmpty()) {
            Log.e(TAG, "Cannot initialize SupertonicTTS with blank modelPath")
            return false
        }

        if (isInitialized(normalizedPath)) {
            return true
        }

        release()

        if (nativeLibraryAvailable) {
            val ptr = runCatching { init(normalizedPath, libPath, ortThreads, xnnThreads) }.getOrDefault(0L)
            if (ptr != 0L) {
                nativePtr = ptr
                currentModelPath = normalizedPath
                Log.i(TAG, "Initialized native SupertonicTTS engine from $normalizedPath")
                return true
            }
        }

        return try {
            val engine = OrtSupertonicEngine.load(File(normalizedPath), ortThreads.coerceAtLeast(1))
            ortFallbackEngine = engine
            currentModelPath = normalizedPath
            Log.i(TAG, "Initialized ONNX Runtime SupertonicTTS engine (${engine.sampleRate} Hz) from $normalizedPath")
            true
        } catch (e: Exception) {
            currentModelPath = null
            Log.e(TAG, "SupertonicTTS initialization failed for $normalizedPath", e)
            false
        }
    }

    @Synchronized
    fun generateAudio(
        text: String,
        lang: String,
        stylePath: String,
        speed: Float = 1.0f,
        bufferDuration: Float = 0.0f,
        steps: Int = 5,
        gain: Float = 1.0f,
        listener: ProgressListener? = null,
        sibilanceMode: Int = this.sibilanceMode
    ): ByteArray? {
        if (text.isBlank() || isCancelled()) return null

        val sid = ++sessionIdCounter
        currentSession.set(SessionContext(sid, listener))
        try {
            if (nativeLibraryAvailable && nativePtr != 0L) {
                val data = synthesize(
                    nativePtr,
                    text,
                    lang,
                    stylePath,
                    speed,
                    bufferDuration,
                    steps,
                    gain,
                    sibilanceMode
                )
                return if (data.isNotEmpty()) data else null
            }

            val engine = ortFallbackEngine
            if (engine == null) {
                Log.e(TAG, "SupertonicTTS is not initialized")
                return null
            }

            val chunks = chunkText(text, lang)
            if (chunks.isEmpty()) return null

            return engine.synthesizeChunks(
                chunks = chunks,
                lang = lang,
                stylePath = stylePath,
                speed = speed.coerceIn(0.5f, 2.5f),
                totalSteps = steps.coerceIn(1, 32),
                gain = gain.coerceIn(0.1f, 8.0f),
                isCancelledCheck = { isCancelled() },
                onProgress = { cur, tot -> notifyProgress(cur, tot) },
                onChunk = { pcm -> notifyAudioChunk(pcm) }
            )
        } catch (e: Exception) {
            Log.e(TAG, "SupertonicTTS synthesis failed: ${e.message}", e)
            return null
        } finally {
            currentSession.set(null)
        }
    }

    @Synchronized
    fun getSoC(): Int {
        if (nativeLibraryAvailable && nativePtr != 0L) {
            return runCatching { getSocClass(nativePtr) }.getOrDefault(0)
        }
        return if (ortFallbackEngine != null) 1 else -1
    }

    @Synchronized
    fun getAudioSampleRate(): Int {
        if (nativeLibraryAvailable && nativePtr != 0L) {
            return runCatching { getSampleRate(nativePtr) }.getOrDefault(DEFAULT_SAMPLE_RATE)
        }
        return ortFallbackEngine?.sampleRate ?: DEFAULT_SAMPLE_RATE
    }

    @Synchronized
    fun release() {
        val ptrToRelease = nativePtr
        if (ptrToRelease != 0L) {
            nativePtr = 0L
            runCatching { close(ptrToRelease) }
        }
        ortFallbackEngine?.close()
        ortFallbackEngine = null
        currentModelPath = null
    }

    @Synchronized
    fun reset() {
        if (nativeLibraryAvailable && nativePtr != 0L) {
            runCatching { reset(nativePtr) }
        }
    }

    fun chunkText(text: String, lang: String): List<String> {
        val joined = if (nativeLibraryAvailable) {
            try {
                nativeChunkText(text, lang)
            } catch (_: Throwable) {
                fallbackChunkText(text, lang)
            }
        } else {
            fallbackChunkText(text, lang)
        }
        return joined.split("\u001E").filter { chunk ->
            chunk.any { it.isLetterOrDigit() }
        }
    }

    private fun fallbackChunkText(text: String, lang: String): String {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return ""

        val normalizedLang = lang.lowercase()
        val splitPattern = when {
            normalizedLang.startsWith("hi") -> HINDI_SPLIT_PATTERN
            normalizedLang.startsWith("ja") -> JAPANESE_SPLIT_PATTERN
            else -> DEFAULT_SPLIT_PATTERN
        }

        val abbreviations = if (normalizedLang.startsWith("en")) {
            listOf(
                "Mr.", "Mrs.", "Dr.", "Ms.", "Prof.", "Sr.", "Jr.",
                "etc.", "vs.", "e.g.", "i.e.",
                "Jan.", "Feb.", "Mar.", "Apr.", "May.", "Jun.",
                "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec.",
                "U.S.", "U.K.", "E.U."
            )
        } else {
            emptyList()
        }

        val maxChunkLen = when {
            normalizedLang.startsWith("ja") || normalizedLang.startsWith("ko") -> 120
            else -> 300
        }

        val rawParagraphs = trimmed.split(PARAGRAPH_REGEX)
        val paragraphs = mutableListOf<String>()
        val currentPara = StringBuilder()

        for (para in rawParagraphs) {
            val p = para.trim()
            if (p.isEmpty()) continue

            if (currentPara.isNotEmpty()) {
                if (currentPara.length + p.length + 2 > maxChunkLen || p.length >= 80) {
                    paragraphs.add(currentPara.toString())
                    currentPara.clear()
                } else {
                    val lastChar = currentPara.last()
                    if (lastChar != '.' && lastChar != '!' && lastChar != '?' && lastChar != '।') {
                        currentPara.append(" .")
                    }
                    currentPara.append(" ").append(p)
                    continue
                }
            }

            if (p.length < 80) {
                currentPara.append(p)
            } else {
                paragraphs.add(p)
            }
        }
        if (currentPara.isNotEmpty()) {
            paragraphs.add(currentPara.toString())
        }

        if (paragraphs.size > 1) {
            return paragraphs.flatMap { para ->
                val subJoined = fallbackChunkText(para, lang)
                if (subJoined.isEmpty()) emptyList() else subJoined.split("\u001E")
            }.filter { it.isNotEmpty() }.joinToString("\u001E")
        }

        val sentences = mutableListOf<String>()
        val matcher = splitPattern.matcher(trimmed)
        var lastEnd = 0
        while (matcher.find()) {
            val matchStart = matcher.start()
            val matchEnd = matcher.end()
            val puncChar = matcher.group(1) ?: ""
            val beforePunc = trimmed.substring(lastEnd, matchStart).trim()

            var isAbbrev = false
            for (abbr in abbreviations) {
                val combined = beforePunc + puncChar
                if (combined.endsWith(abbr, ignoreCase = true)) {
                    isAbbrev = true
                    break
                }
            }

            if (!isAbbrev) {
                sentences.add(trimmed.substring(lastEnd, matchEnd).trim())
                lastEnd = matchEnd
            }
        }
        if (lastEnd < trimmed.length) {
            val remaining = trimmed.substring(lastEnd).trim()
            if (remaining.isNotEmpty()) {
                sentences.add(remaining)
            }
        }

        val chunked = mutableListOf<String>()
        val currentChunk = StringBuilder()

        for (sentence in sentences) {
            val s = sentence.trim()
            if (s.isEmpty()) continue

            if (s.length > maxChunkLen) {
                if (currentChunk.isNotEmpty()) {
                    chunked.add(currentChunk.toString())
                    currentChunk.clear()
                }

                val parts = s.split(COMMA_REGEX)
                for (part in parts) {
                    val p = part.trim()
                    if (p.isEmpty()) continue

                    if (p.length > maxChunkLen) {
                        val words = if (normalizedLang.startsWith("ja") && !p.contains(WHITESPACE_REGEX)) {
                            p.map { it.toString() }
                        } else {
                            p.split(WHITESPACE_REGEX)
                        }
                        val wordChunk = StringBuilder()
                        for (word in words) {
                            if (wordChunk.length + word.length + 1 > maxChunkLen && wordChunk.isNotEmpty()) {
                                chunked.add(wordChunk.toString())
                                wordChunk.clear()
                            }
                            if (wordChunk.isNotEmpty() && !normalizedLang.startsWith("ja")) {
                                wordChunk.append(" ")
                            }
                            wordChunk.append(word)
                        }
                        if (wordChunk.isNotEmpty()) {
                            chunked.add(wordChunk.toString())
                        }
                    } else {
                        if (currentChunk.length + p.length + 1 > maxChunkLen && currentChunk.isNotEmpty()) {
                            chunked.add(currentChunk.toString())
                            currentChunk.clear()
                        }
                        if (currentChunk.isNotEmpty()) {
                            if (normalizedLang.startsWith("ja")) currentChunk.append("、") else currentChunk.append(", ")
                        }
                        currentChunk.append(p)
                    }
                }
            } else {
                if (currentChunk.length + s.length + 1 > maxChunkLen && currentChunk.isNotEmpty()) {
                    chunked.add(currentChunk.toString())
                    currentChunk.clear()
                }
                if (currentChunk.isNotEmpty() && !normalizedLang.startsWith("ja")) {
                    currentChunk.append(" ")
                }
                currentChunk.append(s)
            }
        }
        if (currentChunk.isNotEmpty()) {
            chunked.add(currentChunk.toString())
        }
        return chunked.joinToString("\u001E")
    }
}

/**
 * Pure-Kotlin ONNX Runtime execution engine for Supertonic TTS models
 * (`duration_predictor.onnx`, `text_encoder.onnx`, `vector_estimator.onnx`, `vocoder.onnx`).
 */
private class OrtSupertonicEngine(
    private val env: OrtEnvironment,
    private val rootDir: File,
    val sampleRate: Int,
    private val baseChunkSize: Int,
    private val chunkCompressFactor: Int,
    private val latentDim: Int,
    private val unicodeIndexer: LongArray,
    private val dpSession: OrtSession,
    private val textEncSession: OrtSession,
    private val vectorEstSession: OrtSession,
    private val vocoderSession: OrtSession,
) {
    private data class VoiceStyleTensors(
        val ttlData: FloatArray,
        val ttlShape: LongArray,
        val dpData: FloatArray,
        val dpShape: LongArray,
    )

    private val styleCache = ConcurrentHashMap<String, VoiceStyleTensors>()
    private val rng = Random()

    fun synthesizeChunks(
        chunks: List<String>,
        lang: String,
        stylePath: String,
        speed: Float,
        totalSteps: Int,
        gain: Float,
        isCancelledCheck: () -> Boolean,
        onProgress: (Int, Int) -> Unit,
        onChunk: (ByteArray) -> Unit,
    ): ByteArray? {
        val style = resolveVoiceStyle(stylePath)
        val total = chunks.size
        val allBytes = ArrayList<ByteArray>(total)
        var totalByteLen = 0
        val silenceBytesLen = ((0.08f * sampleRate).toInt().coerceAtLeast(0)) * 2

        for ((idx, rawChunk) in chunks.withIndex()) {
            if (isCancelledCheck()) return null
            onProgress(idx, total)

            val pcm = synthesizeSingle(
                rawText = rawChunk,
                lang = lang,
                style = style,
                speed = speed,
                totalSteps = totalSteps,
                gain = gain,
                isCancelledCheck = isCancelledCheck
            ) ?: return null

            if (isCancelledCheck()) return null
            onChunk(pcm)

            if (idx > 0 && silenceBytesLen > 0) {
                val silence = ByteArray(silenceBytesLen)
                allBytes.add(silence)
                totalByteLen += silence.size
            }
            allBytes.add(pcm)
            totalByteLen += pcm.size
        }

        onProgress(total, total)
        if (totalByteLen == 0) return null

        val combined = ByteArray(totalByteLen)
        var offset = 0
        for (part in allBytes) {
            part.copyInto(combined, destinationOffset = offset)
            offset += part.size
        }
        return combined
    }

    private fun synthesizeSingle(
        rawText: String,
        lang: String,
        style: VoiceStyleTensors,
        speed: Float,
        totalSteps: Int,
        gain: Float,
        isCancelledCheck: () -> Boolean,
    ): ByteArray? {
        val prepared = preprocessForTokenizer(rawText, lang)
        if (prepared.isEmpty()) return ByteArray(0)

        val codePoints = IntArray(prepared.codePointCount(0, prepared.length))
        var cpIdx = 0
        var charOffset = 0
        while (charOffset < prepared.length) {
            val cp = prepared.codePointAt(charOffset)
            codePoints[cpIdx++] = cp
            charOffset += Character.charCount(cp)
        }

        val seqLen = codePoints.size
        val textIds = LongArray(seqLen) { j ->
            val cp = codePoints[j]
            if (cp in unicodeIndexer.indices) {
                val mapped = unicodeIndexer[cp]
                if (mapped < 0L) 0L else mapped
            } else {
                0L
            }
        }
        val textMask = FloatArray(seqLen) { 1.0f }

        val textIdsTensor = OnnxTensor.createTensor(
            env,
            LongBuffer.wrap(textIds),
            longArrayOf(1L, seqLen.toLong())
        )
        val textMaskTensor = OnnxTensor.createTensor(
            env,
            FloatBuffer.wrap(textMask),
            longArrayOf(1L, 1L, seqLen.toLong())
        )
        val styleDpTensor = OnnxTensor.createTensor(
            env,
            FloatBuffer.wrap(style.dpData),
            style.dpShape
        )
        val styleTtlTensor = OnnxTensor.createTensor(
            env,
            FloatBuffer.wrap(style.ttlData),
            style.ttlShape
        )

        var textEmbTensor: OnnxTensor? = null
        try {
            val rawDurationSec = dpSession.run(
                mapOf(
                    "text_ids" to textIdsTensor,
                    "style_dp" to styleDpTensor,
                    "text_mask" to textMaskTensor
                )
            ).use { res ->
                val t = res.get("duration").get() as OnnxTensor
                t.floatBuffer.get(0)
            }
            val durationSec = (rawDurationSec / speed).coerceAtLeast(0.1f)
            if (isCancelledCheck()) return null

            val (embData, embShape) = textEncSession.run(
                mapOf(
                    "text_ids" to textIdsTensor,
                    "style_ttl" to styleTtlTensor,
                    "text_mask" to textMaskTensor
                )
            ).use { res ->
                val t = res.get("text_emb").get() as OnnxTensor
                val buf = t.floatBuffer
                val copy = FloatArray(buf.remaining())
                buf.get(copy)
                copy to t.info.shape
            }
            textEmbTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(embData), embShape)

            val wavLenSamples = (durationSec * sampleRate).toInt().coerceAtLeast(1)
            val chunkSize = (baseChunkSize * chunkCompressFactor).coerceAtLeast(1)
            val latentLen = ((wavLenSamples + chunkSize - 1) / chunkSize).coerceAtLeast(1)
            val latentChannels = (latentDim * chunkCompressFactor).coerceAtLeast(1)

            val latentSize = latentChannels * latentLen
            var xt = FloatArray(latentSize) { rng.nextGaussian().toFloat() }
            val latentMask = FloatArray(latentLen) { 1.0f }

            val latentMaskTensor = OnnxTensor.createTensor(
                env,
                FloatBuffer.wrap(latentMask),
                longArrayOf(1L, 1L, latentLen.toLong())
            )
            val totalStepTensor = OnnxTensor.createTensor(
                env,
                FloatBuffer.wrap(floatArrayOf(totalSteps.toFloat())),
                longArrayOf(1L)
            )

            try {
                val latentShape = longArrayOf(1L, latentChannels.toLong(), latentLen.toLong())
                for (step in 0 until totalSteps) {
                    if (isCancelledCheck()) return null
                    val xtTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(xt), latentShape)
                    val curStepTensor = OnnxTensor.createTensor(
                        env,
                        FloatBuffer.wrap(floatArrayOf(step.toFloat())),
                        longArrayOf(1L)
                    )
                    try {
                        xt = vectorEstSession.run(
                            mapOf(
                                "noisy_latent" to xtTensor,
                                "text_emb" to textEmbTensor,
                                "style_ttl" to styleTtlTensor,
                                "latent_mask" to latentMaskTensor,
                                "text_mask" to textMaskTensor,
                                "current_step" to curStepTensor,
                                "total_step" to totalStepTensor
                            )
                        ).use { res ->
                            val out = res.get("denoised_latent").get() as OnnxTensor
                            val buf = out.floatBuffer
                            FloatArray(buf.remaining()).also { buf.get(it) }
                        }
                    } finally {
                        xtTensor.close()
                        curStepTensor.close()
                    }
                }

                if (isCancelledCheck()) return null

                val finalLatentTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(xt), latentShape)
                val wavSamples: FloatArray = try {
                    vocoderSession.run(mapOf("latent" to finalLatentTensor)).use { res ->
                        val out = res.get("wav_tts").get() as OnnxTensor
                        val buf = out.floatBuffer
                        FloatArray(buf.remaining()).also { buf.get(it) }
                    }
                } finally {
                    finalLatentTensor.close()
                }

                val sampleLimit = minOf(wavLenSamples, wavSamples.size)
                val pcmBuffer = ByteBuffer.allocate(sampleLimit * 2).order(ByteOrder.LITTLE_ENDIAN)
                for (i in 0 until sampleLimit) {
                    val scaled = (wavSamples[i] * gain).coerceIn(-1.0f, 1.0f)
                    pcmBuffer.putShort((scaled * 32767.0f).toInt().toShort())
                }
                return pcmBuffer.array()
            } finally {
                latentMaskTensor.close()
                totalStepTensor.close()
            }
        } finally {
            textEmbTensor?.close()
            textIdsTensor.close()
            textMaskTensor.close()
            styleDpTensor.close()
            styleTtlTensor.close()
        }
    }

    private fun preprocessForTokenizer(text: String, lang: String): String {
        var cleaned = text.trim().replace(Regex("\\s+"), " ")
        if (cleaned.isEmpty()) return ""
        val last = cleaned.last()
        if (last != '.' && last != '!' && last != '?' && last != '।' && last != '。') {
            cleaned += "."
        }
        val normalizedLang = lang.lowercase().trim()
        return if (normalizedLang.isNotEmpty() && !normalizedLang.startsWith("en") && normalizedLang != "na") {
            "<$normalizedLang>$cleaned</$normalizedLang>"
        } else {
            cleaned
        }
    }

    private fun resolveVoiceStyle(stylePath: String): VoiceStyleTensors {
        val candidateFile = resolveVoiceStyleFile(stylePath)
        val canonicalKey = candidateFile.absolutePath
        styleCache[canonicalKey]?.let { return it }

        val rootJson = JSONObject(candidateFile.readText())
        val ttlObj = rootJson.getJSONObject("style_ttl")
        val dpObj = rootJson.getJSONObject("style_dp")

        val (ttlData, ttlShape) = parseStyleComponent(ttlObj)
        val (dpData, dpShape) = parseStyleComponent(dpObj)

        return VoiceStyleTensors(
            ttlData = ttlData,
            ttlShape = ttlShape,
            dpData = dpData,
            dpShape = dpShape,
        ).also { styleCache[canonicalKey] = it }
    }

    private fun resolveVoiceStyleFile(stylePath: String): File {
        val trimmed = stylePath.split(';').firstOrNull()?.trim().orEmpty()
        if (trimmed.isNotEmpty()) {
            val direct = File(trimmed)
            if (direct.exists() && direct.isFile && direct.canRead()) {
                return direct
            }
        }

        val searchDirs = listOfNotNull(
            File(rootDir, "voice_styles"),
            rootDir.parentFile?.let { File(it, "voice_styles") },
            rootDir
        )
        for (dir in searchDirs) {
            if (!dir.exists() || !dir.isDirectory) continue
            val candidate = dir.listFiles()
                ?.filter {
                    it.isFile &&
                        it.extension.equals("json", ignoreCase = true) &&
                        it.name != "tts.json" &&
                        it.name != "unicode_indexer.json"
                }
                ?.sortedBy { it.name }
                ?.firstOrNull()
            if (candidate != null) {
                return candidate
            }
        }

        throw IllegalArgumentException(
            "No readable Supertonic voice style JSON found at '$stylePath' or under ${rootDir.absolutePath}/voice_styles"
        )
    }

    private fun parseStyleComponent(comp: JSONObject): Pair<FloatArray, LongArray> {
        val dimsArr = comp.getJSONArray("dims")
        val shape = LongArray(dimsArr.length()) { idx -> dimsArr.getLong(idx) }
        val total = shape.fold(1L) { acc, d -> acc * d }.toInt()
        val flat = FloatArray(total)
        var cursor = 0

        fun flatten(arr: JSONArray) {
            for (i in 0 until arr.length()) {
                val elem = arr.get(i)
                if (elem is JSONArray) {
                    flatten(elem)
                } else if (cursor < flat.size) {
                    flat[cursor++] = (elem as Number).toFloat()
                }
            }
        }
        flatten(comp.getJSONArray("data"))
        return flat to shape
    }

    fun close() {
        runCatching { dpSession.close() }
        runCatching { textEncSession.close() }
        runCatching { vectorEstSession.close() }
        runCatching { vocoderSession.close() }
        styleCache.clear()
    }

    companion object {
        fun load(modelDir: File, intraThreads: Int): OrtSupertonicEngine {
            val onnxDir = when {
                File(modelDir, "duration_predictor.onnx").exists() -> modelDir
                File(modelDir, "onnx/duration_predictor.onnx").exists() -> File(modelDir, "onnx")
                else -> throw IllegalArgumentException(
                    "Supertonic ONNX files not found in ${modelDir.absolutePath} (expected duration_predictor.onnx, text_encoder.onnx, vector_estimator.onnx, vocoder.onnx, tts.json, unicode_indexer.json)"
                )
            }

            val cfgJson = JSONObject(File(onnxDir, "tts.json").readText())
            val ae = cfgJson.getJSONObject("ae")
            val ttl = cfgJson.getJSONObject("ttl")
            val sampleRate = ae.optInt("sample_rate", 44_100)
            val baseChunkSize = ae.optInt("base_chunk_size", 512)
            val chunkCompress = ttl.optInt("chunk_compress_factor", 6)
            val latentDim = ttl.optInt("latent_dim", 24)

            val indexerJson = JSONArray(File(onnxDir, "unicode_indexer.json").readText())
            val indexer = LongArray(indexerJson.length()) { i -> indexerJson.getLong(i) }

            val env = OrtEnvironment.getEnvironment()
            val opts = OrtSession.SessionOptions().apply {
                setIntraOpNumThreads(intraThreads)
                setExecutionMode(OrtSession.SessionOptions.ExecutionMode.SEQUENTIAL)
                setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
            }

            return try {
                val dp = env.createSession(File(onnxDir, "duration_predictor.onnx").absolutePath, opts)
                val enc = env.createSession(File(onnxDir, "text_encoder.onnx").absolutePath, opts)
                val est = env.createSession(File(onnxDir, "vector_estimator.onnx").absolutePath, opts)
                val voc = env.createSession(File(onnxDir, "vocoder.onnx").absolutePath, opts)
                OrtSupertonicEngine(
                    env = env,
                    rootDir = modelDir,
                    sampleRate = sampleRate,
                    baseChunkSize = baseChunkSize,
                    chunkCompressFactor = chunkCompress,
                    latentDim = latentDim,
                    unicodeIndexer = indexer,
                    dpSession = dp,
                    textEncSession = enc,
                    vectorEstSession = est,
                    vocoderSession = voc,
                )
            } finally {
                opts.close()
            }
        }
    }
}
