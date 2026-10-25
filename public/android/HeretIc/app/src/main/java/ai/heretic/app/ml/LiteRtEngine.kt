package ai.heretic.app.ml

import android.content.Context
import android.content.res.AssetManager
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.util.Log
import com.google.ai.edge.litert.Accelerator
import com.google.ai.edge.litert.CompiledModel
import com.google.ai.edge.litert.Environment
import org.tensorflow.lite.InterpreterApi
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel

data class InferenceReport(
    val model: String,
    val backend: String,
    val latencyMs: Long,
    val ramMb: Long,
    val schemaVersion: Int = LiteRtFlatbufferSchema.EXPECTED_SCHEMA_VERSION,
    val fromBackendCache: Boolean = false,
)

/**
 * Inspects `.tflite` FlatBuffer headers before handing buffers to JNI so mismatched
 * export schemas fail cleanly in Kotlin instead of crashing native delegate compilation.
 *
 * `com.google.ai.edge.litert:litert:2.3.0` expects `file_identifier = "TFL3"` and
 * `Model.version = 3` (field slot 0 of root `tflite.Model` table).
 */
object LiteRtFlatbufferSchema {

    const val EXPECTED_IDENTIFIER = "TFL3"
    const val EXPECTED_SCHEMA_VERSION = 3
    const val LITERT_RUNTIME_VERSION = "2.3.0"
    const val MIN_FLATBUFFER_BYTES = 16
    private const val MAX_HEADER_SLICE_BYTES = 64 * 1024

    data class Header(
        val identifier: String,
        val schemaVersion: Int,
        val sizeBytes: Long,
    ) {
        val isCompatible: Boolean
            get() = identifier == EXPECTED_IDENTIFIER && schemaVersion == EXPECTED_SCHEMA_VERSION
    }

    fun inspect(bytes: ByteArray, totalSizeBytes: Long = bytes.size.toLong()): Header =
        inspect(ByteBuffer.wrap(bytes), totalSizeBytes)

    fun inspect(buffer: ByteBuffer, totalSizeBytes: Long = buffer.remaining().toLong()): Header {
        val slice = buffer.duplicate().order(ByteOrder.LITTLE_ENDIAN)
        val start = slice.position()
        val available = slice.remaining()
        if (available < MIN_FLATBUFFER_BYTES) {
            return Header(identifier = "SHORT", schemaVersion = -1, sizeBytes = totalSizeBytes)
        }

        val rootRelOffset = slice.getInt(start)
        val idBytes = ByteArray(4) { idx -> slice.get(start + 4 + idx) }
        val identifier = idBytes
            .map { b ->
                val ch = b.toInt() and 0xFF
                if (ch in 32..126) ch.toChar() else '?'
            }
            .joinToString("")

        val rootPos = start + rootRelOffset
        if (rootRelOffset < 8 || rootPos < start || rootPos + 4 > start + available) {
            return Header(identifier = identifier, schemaVersion = -1, sizeBytes = totalSizeBytes)
        }

        val vtableSignedOffset = slice.getInt(rootPos)
        val vtablePos = rootPos - vtableSignedOffset
        if (vtablePos < start || vtablePos + 4 > start + available) {
            return Header(identifier = identifier, schemaVersion = -1, sizeBytes = totalSizeBytes)
        }

        val vtableByteLen = slice.getShort(vtablePos).toInt() and 0xFFFF
        val schemaVersion = if (vtableByteLen >= 6 && vtablePos + 6 <= start + available) {
            val versionFieldOffset = slice.getShort(vtablePos + 4).toInt() and 0xFFFF
            if (versionFieldOffset == 0) {
                0
            } else if (rootPos + versionFieldOffset + 4 <= start + available) {
                slice.getInt(rootPos + versionFieldOffset)
            } else {
                -1
            }
        } else {
            0
        }

        return Header(
            identifier = identifier,
            schemaVersion = schemaVersion,
            sizeBytes = totalSizeBytes,
        )
    }

    @Throws(IOException::class)
    fun inspect(file: File): Header {
        if (!file.isFile) {
            throw IOException("LiteRT model file missing: ${file.absolutePath}")
        }
        val length = file.length()
        val toRead = minOf(length, MAX_HEADER_SLICE_BYTES.toLong()).toInt()
        val headerBytes = ByteArray(toRead)
        FileInputStream(file).use { input ->
            var offset = 0
            while (offset < toRead) {
                val read = input.read(headerBytes, offset, toRead - offset)
                if (read <= 0) break
                offset += read
            }
        }
        return inspect(headerBytes, totalSizeBytes = length)
    }

    @Throws(IOException::class)
    fun inspect(assets: AssetManager, assetPath: String): Header {
        assets.open(assetPath).use { input ->
            val buf = ByteArray(MAX_HEADER_SLICE_BYTES)
            var offset = 0
            while (offset < buf.size) {
                val read = input.read(buf, offset, buf.size - offset)
                if (read <= 0) break
                offset += read
            }
            val trimmed = if (offset == buf.size) buf else buf.copyOf(offset)
            return inspect(trimmed, totalSizeBytes = offset.toLong())
        }
    }

    fun requireCompatible(header: Header, sourceLabel: String): Header {
        require(header.isCompatible) {
            "FLATBUFFER SCHEMA MISMATCH in '$sourceLabel': litert:$LITERT_RUNTIME_VERSION requires " +
                "identifier='$EXPECTED_IDENTIFIER' and schemaVersion=$EXPECTED_SCHEMA_VERSION, " +
                "but model exported identifier='${header.identifier}' and schemaVersion=${header.schemaVersion}. " +
                "Re-export the model with a TFL3 schema v3 converter matching litert:$LITERT_RUNTIME_VERSION."
        }
        return header
    }
}

enum class ResolvedLiteRtBackend(val wireName: String) {
    GPU("gpu"),
    CPU("cpu");

    companion object {
        fun fromWire(value: String?): ResolvedLiteRtBackend? =
            entries.firstOrNull { it.wireName.equals(value, ignoreCase = true) }
    }
}

data class PersistedBackendEntry(
    val backend: ResolvedLiteRtBackend,
    val installStamp: String,
    val cpuThreads: Int,
    val probeNote: String,
    val probedAtMs: Long,
)

data class CachedBackendRecord(
    val backend: ResolvedLiteRtBackend,
    val installStamp: String,
    val cpuThreads: Int,
    val probeNote: String,
    val probedFromCache: Boolean,
)

interface BackendPreferenceStore {
    fun read(namespace: String): PersistedBackendEntry?
    fun write(namespace: String, entry: PersistedBackendEntry)
    fun clear(namespace: String)
}

class InMemoryBackendStore : BackendPreferenceStore {
    private val map = LinkedHashMap<String, PersistedBackendEntry>()

    @Synchronized
    override fun read(namespace: String): PersistedBackendEntry? = map[namespace]

    @Synchronized
    override fun write(namespace: String, entry: PersistedBackendEntry) {
        map[namespace] = entry
    }

    @Synchronized
    override fun clear(namespace: String) {
        map.remove(namespace)
    }
}

class SharedPreferencesBackendStore(context: Context) : BackendPreferenceStore {
    companion object {
        private const val PREFS_NAME = "heretic_litert_backend_cache"
    }

    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    override fun read(namespace: String): PersistedBackendEntry? {
        val rawBackend = prefs.getString("${namespace}_backend", null) ?: return null
        val backend = ResolvedLiteRtBackend.fromWire(rawBackend) ?: return null
        val stamp = prefs.getString("${namespace}_stamp", null) ?: return null
        val threads = prefs.getInt("${namespace}_threads", LiteRtBackendResolver.DEFAULT_CPU_THREADS)
        val note = prefs.getString("${namespace}_note", "") ?: ""
        val at = prefs.getLong("${namespace}_at", 0L)
        return PersistedBackendEntry(
            backend = backend,
            installStamp = stamp,
            cpuThreads = threads,
            probeNote = note,
            probedAtMs = at,
        )
    }

    override fun write(namespace: String, entry: PersistedBackendEntry) {
        prefs.edit()
            .putString("${namespace}_backend", entry.backend.wireName)
            .putString("${namespace}_stamp", entry.installStamp)
            .putInt("${namespace}_threads", entry.cpuThreads)
            .putString("${namespace}_note", entry.probeNote)
            .putLong("${namespace}_at", entry.probedAtMs)
            .apply()
    }

    override fun clear(namespace: String) {
        prefs.edit()
            .remove("${namespace}_backend")
            .remove("${namespace}_stamp")
            .remove("${namespace}_threads")
            .remove("${namespace}_note")
            .remove("${namespace}_at")
            .apply()
    }
}

/**
 * Resolves the LiteRT hardware backend (`GPU` delegate vs 4-thread `CPU` fallback) and
 * caches the outcome per application install stamp so emulators and Mali drivers that
 * throw during OpenCL/Vulkan initialisation only pay a single failed probe per install.
 */
object LiteRtBackendResolver {

    const val DEFAULT_CPU_THREADS = 4
    const val NAMESPACE_TFLITE = "litert_2_3_0_tflite"
    const val NAMESPACE_LITERTLM = "litertlm_0_18_0"

    fun computeInstallStamp(context: Context): String {
        val pkg = runCatching {
            val info = context.packageManager.getPackageInfo(context.packageName, 0)
            val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                info.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                info.versionCode.toLong()
            }
            "${info.firstInstallTime}:${info.lastUpdateTime}:$versionCode"
        }.getOrDefault("unknown-pkg")
        return "$pkg:${Build.FINGERPRINT}:litert-${LiteRtFlatbufferSchema.LITERT_RUNTIME_VERSION}"
    }

    fun <T> resolve(
        namespace: String,
        installStamp: String,
        store: BackendPreferenceStore,
        cpuThreads: Int = DEFAULT_CPU_THREADS,
        createGpu: () -> T,
        createCpu: (numThreads: Int) -> T,
    ): Pair<T, CachedBackendRecord> {
        val safeThreads = cpuThreads.coerceAtLeast(1)
        val cached = store.read(namespace)

        // 1. Cached CPU fallback for this install -> skip GPU delegate probe completely.
        if (cached != null && cached.installStamp == installStamp && cached.backend == ResolvedLiteRtBackend.CPU) {
            val resolvedThreads = cached.cpuThreads.coerceAtLeast(1)
            val cpuInstance = createCpu(resolvedThreads)
            return cpuInstance to CachedBackendRecord(
                backend = ResolvedLiteRtBackend.CPU,
                installStamp = installStamp,
                cpuThreads = resolvedThreads,
                probeNote = cached.probeNote,
                probedFromCache = true,
            )
        }

        // 2. Cached GPU for this install -> reuse GPU in runCatching, degrading to CPU(4) if driver regresses.
        if (cached != null && cached.installStamp == installStamp && cached.backend == ResolvedLiteRtBackend.GPU) {
            val gpuAttempt = runCatching { createGpu() }
            if (gpuAttempt.isSuccess) {
                return gpuAttempt.getOrThrow() to CachedBackendRecord(
                    backend = ResolvedLiteRtBackend.GPU,
                    installStamp = installStamp,
                    cpuThreads = safeThreads,
                    probeNote = cached.probeNote,
                    probedFromCache = true,
                )
            }
            val reason = formatProbeFailure(gpuAttempt.exceptionOrNull())
            val fallbackEntry = PersistedBackendEntry(
                backend = ResolvedLiteRtBackend.CPU,
                installStamp = installStamp,
                cpuThreads = safeThreads,
                probeNote = reason,
                probedAtMs = System.currentTimeMillis(),
            )
            store.write(namespace, fallbackEntry)
            val cpuInstance = createCpu(safeThreads)
            return cpuInstance to CachedBackendRecord(
                backend = ResolvedLiteRtBackend.CPU,
                installStamp = installStamp,
                cpuThreads = safeThreads,
                probeNote = reason,
                probedFromCache = false,
            )
        }

        // 3. First probe for this install -> try GPU inside runCatching, fall back to CPU(setNumThreads(4)).
        val gpuProbe = runCatching { createGpu() }
        return gpuProbe.fold(
            onSuccess = { gpuInstance ->
                val note = "LiteRT GPU delegate attached cleanly (litert-gpu:${LiteRtFlatbufferSchema.LITERT_RUNTIME_VERSION})"
                store.write(
                    namespace,
                    PersistedBackendEntry(
                        backend = ResolvedLiteRtBackend.GPU,
                        installStamp = installStamp,
                        cpuThreads = safeThreads,
                        probeNote = note,
                        probedAtMs = System.currentTimeMillis(),
                    ),
                )
                gpuInstance to CachedBackendRecord(
                    backend = ResolvedLiteRtBackend.GPU,
                    installStamp = installStamp,
                    cpuThreads = safeThreads,
                    probeNote = note,
                    probedFromCache = false,
                )
            },
            onFailure = { error ->
                val reason = formatProbeFailure(error)
                store.write(
                    namespace,
                    PersistedBackendEntry(
                        backend = ResolvedLiteRtBackend.CPU,
                        installStamp = installStamp,
                        cpuThreads = safeThreads,
                        probeNote = reason,
                        probedAtMs = System.currentTimeMillis(),
                    ),
                )
                val cpuInstance = createCpu(safeThreads)
                cpuInstance to CachedBackendRecord(
                    backend = ResolvedLiteRtBackend.CPU,
                    installStamp = installStamp,
                    cpuThreads = safeThreads,
                    probeNote = reason,
                    probedFromCache = false,
                )
            },
        )
    }

    private fun formatProbeFailure(error: Throwable?): String {
        if (error == null) return "GPU delegate unavailable; fell back to CPU(${DEFAULT_CPU_THREADS} threads)"
        val msg = error.message?.lineSequence()?.firstOrNull()?.trim().orEmpty()
        return "${error::class.java.simpleName}: ${msg.ifEmpty { "GPU delegate init failed" }} -> CPU(${DEFAULT_CPU_THREADS} threads)"
    }
}

/**
 * On-device `.tflite` inference through LiteRT 2.3.0 (`com.google.ai.edge.litert:litert:2.3.0` +
 * `com.google.ai.edge.litert:litert-gpu:2.3.0`).
 *
 * Implements all four `litert-delegate` hardening guarantees:
 * 1. Wraps GPU delegate / accelerator creation in `runCatching` and falls back to 4 CPU threads
 *    (`CompiledModel.CpuOptions(numThreads = 4)` and `InterpreterApi.Options().setNumThreads(4)`).
 * 2. Pairs `litert:2.3.0` with `litert-gpu:2.3.0`.
 * 3. Validates the `TFL3` v3 FlatBuffer schema version upfront before JNI model compilation.
 * 4. Caches the resolved backend per install stamp so broken Mali/emulator OpenCL/Vulkan drivers
 *    are probed at most once per app install.
 */
class LiteRtEngine(
    context: Context,
    private val backendStore: BackendPreferenceStore = SharedPreferencesBackendStore(context),
) {
    companion object {
        private const val TAG = "LiteRtEngine"
    }

    private sealed interface ActiveRuntime : AutoCloseable {
        val backendTag: String
        fun execute(inputs: Array<FloatArray>)
    }

    private class CompiledModelRuntime(
        private val compiledModel: CompiledModel,
        override val backendTag: String,
        private val ownedEnvironment: Environment? = null,
    ) : ActiveRuntime {
        override fun execute(inputs: Array<FloatArray>) {
            val inBuffers = compiledModel.createInputBuffers()
            val outBuffers = compiledModel.createOutputBuffers()
            try {
                inputs.forEachIndexed { index, data ->
                    if (index < inBuffers.size) {
                        inBuffers[index].writeFloat(data)
                    }
                }
                compiledModel.run(inBuffers, outBuffers)
            } finally {
                inBuffers.forEach { runCatching { it.close() } }
                outBuffers.forEach { runCatching { it.close() } }
            }
        }

        override fun close() {
            runCatching { compiledModel.close() }
            runCatching { ownedEnvironment?.close() }
        }
    }

    private class InterpreterCpuRuntime(
        private val interpreter: InterpreterApi,
        override val backendTag: String,
    ) : ActiveRuntime {
        override fun execute(inputs: Array<FloatArray>) {
            if (inputs.isEmpty()) return
            val outCount = interpreter.outputTensorCount.coerceAtLeast(1)
            val outputs = HashMap<Int, Any>(outCount)
            for (i in 0 until outCount) {
                val shape = interpreter.getOutputTensor(i).shape()
                val numElements = shape.fold(1) { acc, dim -> acc * dim.coerceAtLeast(1) }
                outputs[i] = FloatArray(numElements)
            }
            val boxedInputs: Array<Any> = Array(inputs.size) { idx -> inputs[idx] }
            interpreter.runForMultipleInputsOutputs(boxedInputs, outputs)
        }

        override fun close() {
            runCatching { interpreter.close() }
        }
    }

    private val appContext = context.applicationContext
    private val modelsDir: File = File(appContext.filesDir, "models").apply { mkdirs() }

    private var activeRuntime: ActiveRuntime? = null
    private var modelName: String = ""
    private var backend: String = "cpu"
    private var lastSchemaVersion: Int = LiteRtFlatbufferSchema.EXPECTED_SCHEMA_VERSION
    private var lastBackendRecord: CachedBackendRecord? = null

    val loadedModelName: String get() = modelName
    val activeBackendLabel: String get() = backend
    val isLoaded: Boolean get() = activeRuntime != null

    fun cachedBackendRecord(): CachedBackendRecord? {
        lastBackendRecord?.let { return it }
        val stamp = LiteRtBackendResolver.computeInstallStamp(appContext)
        val persisted = backendStore.read(LiteRtBackendResolver.NAMESPACE_TFLITE) ?: return null
        if (persisted.installStamp != stamp) return null
        return CachedBackendRecord(
            backend = persisted.backend,
            installStamp = persisted.installStamp,
            cpuThreads = persisted.cpuThreads,
            probeNote = persisted.probeNote,
            probedFromCache = true,
        )
    }

    fun resetBackendCache() {
        backendStore.clear(LiteRtBackendResolver.NAMESPACE_TFLITE)
        lastBackendRecord = null
    }

    /**
     * Streams a SAF `.tflite` / `.task` URI into `filesDir/models/` via an atomic `.part` file
     * and validates its `TFL3` v3 FlatBuffer header before replacing any existing file.
     */
    @Throws(IOException::class)
    fun copyUriToModelsDir(
        uri: Uri,
        onProgress: (copied: Long, total: Long) -> Unit = { _, _ -> },
    ): File {
        val displayName = resolveDisplayName(uri)
        val declaredSize = resolveDeclaredSize(uri)
        val target = File(modelsDir, displayName)
        val partial = File(modelsDir, "$displayName.part")
        if (partial.exists()) partial.delete()

        var copied = 0L
        try {
            val stream = appContext.contentResolver.openInputStream(uri)
                ?: throw IOException("SAF provider returned null stream for $uri")
            stream.use { src ->
                partial.outputStream().use { dst ->
                    val buf = ByteArray(256 * 1024)
                    while (true) {
                        val read = src.read(buf)
                        if (read < 0) break
                        if (read > 0) {
                            dst.write(buf, 0, read)
                            copied += read
                            onProgress(copied, declaredSize)
                        }
                    }
                    dst.flush()
                }
            }
            if (copied == 0L) {
                throw IOException("EMPTY FILE: $displayName copied 0 bytes")
            }
            val header = LiteRtFlatbufferSchema.inspect(partial)
            LiteRtFlatbufferSchema.requireCompatible(header, displayName)
            if (target.exists()) target.delete()
            if (!partial.renameTo(target)) {
                partial.copyTo(target, overwrite = true)
                partial.delete()
            }
            return target
        } catch (err: Throwable) {
            partial.delete()
            throw when (err) {
                is IOException -> err
                is IllegalArgumentException -> err
                else -> IOException(err.message ?: "Failed importing $displayName", err)
            }
        }
    }

    /** Loads a `.tflite` flatbuffer bundled under `app/src/main/assets/`. */
    fun load(assetPath: String): CachedBackendRecord {
        close()
        val header = LiteRtFlatbufferSchema.requireCompatible(
            LiteRtFlatbufferSchema.inspect(appContext.assets, assetPath),
            assetPath,
        )
        val installStamp = LiteRtBackendResolver.computeInstallStamp(appContext)
        val modelKey = assetPath.replace('/', '_')

        val (runtime, record) = LiteRtBackendResolver.resolve(
            namespace = LiteRtBackendResolver.NAMESPACE_TFLITE,
            installStamp = installStamp,
            store = backendStore,
            cpuThreads = LiteRtBackendResolver.DEFAULT_CPU_THREADS,
            createGpu = {
                compileAssetWithGpu(assetPath, modelKey)
            },
            createCpu = { threads ->
                compileAssetWithCpuFallback(assetPath, threads)
            },
        )

        activeRuntime = runtime
        modelName = assetPath
        backend = runtime.backendTag
        lastSchemaVersion = header.schemaVersion
        lastBackendRecord = record
        Log.i(
            TAG,
            "Loaded LiteRT asset '$assetPath' on ${runtime.backendTag} " +
                "(schema=TFL3 v${header.schemaVersion}, cached=${record.probedFromCache})",
        )
        return record
    }

    /** Loads a `.tflite` flatbuffer from internal storage (`filesDir/models/`). */
    fun loadFile(file: File): CachedBackendRecord {
        close()
        val header = LiteRtFlatbufferSchema.requireCompatible(
            LiteRtFlatbufferSchema.inspect(file),
            file.name,
        )
        val installStamp = LiteRtBackendResolver.computeInstallStamp(appContext)
        val modelKey = "${file.name}_${file.length()}"

        val (runtime, record) = LiteRtBackendResolver.resolve(
            namespace = LiteRtBackendResolver.NAMESPACE_TFLITE,
            installStamp = installStamp,
            store = backendStore,
            cpuThreads = LiteRtBackendResolver.DEFAULT_CPU_THREADS,
            createGpu = {
                compileFileWithGpu(file, modelKey)
            },
            createCpu = { threads ->
                compileFileWithCpuFallback(file, threads)
            },
        )

        activeRuntime = runtime
        modelName = file.name
        backend = runtime.backendTag
        lastSchemaVersion = header.schemaVersion
        lastBackendRecord = record
        Log.i(
            TAG,
            "Loaded LiteRT file '${file.name}' on ${runtime.backendTag} " +
                "(schema=TFL3 v${header.schemaVersion}, cached=${record.probedFromCache})",
        )
        return record
    }

    /** Runs one inference pass on the active GPU or 4-thread CPU backend. */
    fun run(input: Array<FloatArray>): InferenceReport {
        val active = activeRuntime ?: error("LiteRT model not loaded; call load() or loadFile() first")
        val runtime = Runtime.getRuntime()
        val before = (runtime.totalMemory() - runtime.freeMemory()) / 1024 / 1024
        val started = System.nanoTime()
        active.execute(input)
        val latency = (System.nanoTime() - started) / 1_000_000
        val after = (runtime.totalMemory() - runtime.freeMemory()) / 1024 / 1024
        return InferenceReport(
            model = modelName,
            backend = backend,
            latencyMs = latency,
            ramMb = maxOf(0L, after - before),
            schemaVersion = lastSchemaVersion,
            fromBackendCache = lastBackendRecord?.probedFromCache ?: false,
        )
    }

    fun statusSummary(): String {
        val cached = cachedBackendRecord()
        return when {
            activeRuntime != null ->
                "Active: $modelName on $backend (TFL3 v$lastSchemaVersion · " +
                    "${if (cached?.probedFromCache == true) "cached per-install" else "probed this install"})"
            cached != null ->
                "Cached LiteRT 2.3.0 backend: ${cached.backend.wireName.uppercase()} " +
                    "(CPU fallback=${cached.cpuThreads} threads · ${cached.probeNote})"
            else ->
                "LiteRT 2.3.0 + litert-gpu 2.3.0 ready (TFL3 v3 · GPU probe -> setNumThreads(4) cached once per install)"
        }
    }

    fun close() {
        activeRuntime?.close()
        activeRuntime = null
    }

    private fun compileAssetWithGpu(assetPath: String, modelKey: String): ActiveRuntime {
        val env = Environment.create(appContext)
        try {
            val available = env.getAvailableAccelerators()
            if (Accelerator.GPU !in available) {
                throw IllegalStateException("GpuDelegate unavailable: Accelerator.GPU not in $available")
            }
            val options = CompiledModel.Options(Accelerator.GPU).apply {
                gpuOptions = CompiledModel.GpuOptions(
                    serializationDir = appContext.cacheDir.absolutePath,
                    modelCacheKey = modelKey,
                    serializeProgramCache = true,
                    backend = CompiledModel.GpuOptions.Backend.AUTOMATIC,
                )
            }
            val compiled = CompiledModel.create(appContext.assets, assetPath, options, env)
            return CompiledModelRuntime(compiled, "gpu", ownedEnvironment = env)
        } catch (err: Throwable) {
            runCatching { env.close() }
            throw err
        }
    }

    private fun compileFileWithGpu(file: File, modelKey: String): ActiveRuntime {
        val env = Environment.create(appContext)
        try {
            val available = env.getAvailableAccelerators()
            if (Accelerator.GPU !in available) {
                throw IllegalStateException("GpuDelegate unavailable: Accelerator.GPU not in $available")
            }
            val options = CompiledModel.Options(Accelerator.GPU).apply {
                gpuOptions = CompiledModel.GpuOptions(
                    serializationDir = appContext.cacheDir.absolutePath,
                    modelCacheKey = modelKey,
                    serializeProgramCache = true,
                    backend = CompiledModel.GpuOptions.Backend.AUTOMATIC,
                )
            }
            val compiled = CompiledModel.create(file.absolutePath, options, env)
            return CompiledModelRuntime(compiled, "gpu", ownedEnvironment = env)
        } catch (err: Throwable) {
            runCatching { env.close() }
            throw err
        }
    }

    private fun compileAssetWithCpuFallback(assetPath: String, threads: Int): ActiveRuntime {
        val xnnCache = File(appContext.cacheDir, "litert_xnnpack.cache").absolutePath
        val compiledCpu = runCatching {
            val cpuOpts = CompiledModel.Options(Accelerator.CPU).apply {
                cpuOptions = CompiledModel.CpuOptions(
                    numThreads = threads,
                    xnnPackWeightCachePath = xnnCache,
                )
            }
            CompiledModel.create(appContext.assets, assetPath, cpuOpts, null)
        }
        compiledCpu.getOrNull()?.let { model ->
            return CompiledModelRuntime(model, "cpu(threads=$threads)")
        }

        val interpreterOptions = InterpreterApi.Options()
            .setNumThreads(threads)
            .setUseXNNPACK(true)
        val mapped = mapAssetToDirectBuffer(assetPath)
        val interpreter = InterpreterApi.create(mapped, interpreterOptions)
        return InterpreterCpuRuntime(interpreter, "cpu(threads=$threads)")
    }

    private fun compileFileWithCpuFallback(file: File, threads: Int): ActiveRuntime {
        val xnnCache = File(appContext.cacheDir, "litert_xnnpack.cache").absolutePath
        val compiledCpu = runCatching {
            val cpuOpts = CompiledModel.Options(Accelerator.CPU).apply {
                cpuOptions = CompiledModel.CpuOptions(
                    numThreads = threads,
                    xnnPackWeightCachePath = xnnCache,
                )
            }
            CompiledModel.create(file.absolutePath, cpuOpts, null)
        }
        compiledCpu.getOrNull()?.let { model ->
            return CompiledModelRuntime(model, "cpu(threads=$threads)")
        }

        val interpreterOptions = InterpreterApi.Options()
            .setNumThreads(threads)
            .setUseXNNPACK(true)
        val mapped = FileInputStream(file).channel.use { ch ->
            ch.map(FileChannel.MapMode.READ_ONLY, 0L, ch.size())
        }
        val interpreter = InterpreterApi.create(mapped, interpreterOptions)
        return InterpreterCpuRuntime(interpreter, "cpu(threads=$threads)")
    }

    private fun mapAssetToDirectBuffer(assetPath: String): ByteBuffer {
        val afd = runCatching { appContext.assets.openFd(assetPath) }.getOrNull()
        if (afd != null) {
            afd.use { fd ->
                FileInputStream(fd.fileDescriptor).channel.use { ch ->
                    return ch.map(FileChannel.MapMode.READ_ONLY, fd.startOffset, fd.declaredLength)
                }
            }
        }
        val raw = appContext.assets.open(assetPath).use { it.readBytes() }
        return ByteBuffer.allocateDirect(raw.size).order(ByteOrder.nativeOrder()).apply {
            put(raw)
            rewind()
        }
    }

    private fun resolveDisplayName(uri: Uri): String {
        var name = uri.lastPathSegment?.substringAfterLast('/') ?: "model.tflite"
        runCatching {
            appContext.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (idx >= 0 && !cursor.isNull(idx)) name = cursor.getString(idx)
                    }
                }
        }
        return name
    }

    private fun resolveDeclaredSize(uri: Uri): Long {
        var size = 0L
        runCatching {
            appContext.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)
                ?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val idx = cursor.getColumnIndex(OpenableColumns.SIZE)
                        if (idx >= 0 && !cursor.isNull(idx)) size = cursor.getLong(idx)
                    }
                }
        }
        return size
    }
}
