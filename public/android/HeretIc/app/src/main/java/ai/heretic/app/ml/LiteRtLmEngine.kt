package ai.heretic.app.ml

import android.app.ActivityManager
import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.Locale

/** A .litertlm weight bundle that this app knows how to load. */
data class LiteRtLmModelSpec(
    val id: String,
    val label: String,
    val fileName: String,
    /** Nominal download size in bytes (decimal GB, as published). */
    val approxBytes: Long,
    /** Total device RAM required before this model is considered. */
    val minTotalRamBytes: Long,
    val note: String,
) {
    val approxGbLabel: String
        get() = String.format(Locale.US, "%.2f GB", approxBytes / 1_000_000_000.0)

    val isFallback: Boolean get() = minTotalRamBytes < LiteRtLmModels.LARGE_RAM_THRESHOLD
}

/**
 * The model catalog and the selection rules, kept free of Android calls so the
 * JVM unit tests can exercise them.
 *
 * Default is Gemma 4 E2B on 6 GB+ RAM devices; everything else gets Gemma 3n E2B.
 */
object LiteRtLmModels {

    const val GIB = 1_073_741_824L
    const val MIB = 1_048_576L
    const val LARGE_RAM_THRESHOLD = 6 * GIB

    val GEMMA_4_E2B = LiteRtLmModelSpec(
        id = "gemma-4-e2b",
        label = "Gemma 4 E2B",
        fileName = "gemma-4-e2b-it-int4.litertlm",
        approxBytes = 2_581_000_000L,
        minTotalRamBytes = LARGE_RAM_THRESHOLD,
        note = "Default on 6 GB+ devices. int4 weights, .litertlm container.",
    )

    val GEMMA_3N_E2B = LiteRtLmModelSpec(
        id = "gemma-3n-e2b",
        label = "Gemma 3n E2B",
        fileName = "gemma-3n-e2b-it-int4.litertlm",
        approxBytes = 1_480_000_000L,
        minTotalRamBytes = 3 * GIB,
        note = "Automatic fallback below 6 GB of RAM. int4 weights, .litertlm container.",
    )

    val ALL: List<LiteRtLmModelSpec> = listOf(GEMMA_4_E2B, GEMMA_3N_E2B)

    /** The ABI the litertlm-android AAR actually ships native libraries for. */
    const val REQUIRED_ABI = "arm64-v8a"

    fun abiSupported(abis: List<String>): Boolean = abis.contains(REQUIRED_ABI)

    /**
     * Picks the largest model the device can hold. Returns null when the device
     * cannot run LiteRT-LM at all (no arm64-v8a), so the caller can explain why
     * instead of crashing with UnsatisfiedLinkError.
     */
    fun select(totalRamBytes: Long, abis: List<String>): LiteRtLmModelSpec? {
        if (!abiSupported(abis)) return null
        return if (totalRamBytes >= LARGE_RAM_THRESHOLD) GEMMA_4_E2B else GEMMA_3N_E2B
    }

    fun byFileName(name: String): LiteRtLmModelSpec? =
        ALL.firstOrNull { it.fileName == name.substringAfterLast('/').substringAfterLast('\\') }

    /** Free space required before a 1:1 copy, plus 5% slack for filesystem metadata. */
    fun requiredFreeBytes(spec: LiteRtLmModelSpec): Long = spec.approxBytes + spec.approxBytes / 20
}

/**
 * LiteRT-LM 0.18.0 runtime for on-device Gemma.
 *
 * com.google.ai.edge.litertlm:litertlm-android:0.18.0
 *
 * Weights are never bundled in the APK: they are streamed from a Storage Access
 * Framework URI into context.filesDir/models/ and loaded from there. No
 * INTERNET permission exists, so the runtime has no network path at all.
 */
class LiteRtLmEngine(private val context: Context) {

    private val modelsDir: File = File(context.filesDir, "models").apply { mkdirs() }
    private var engine: Engine? = null
    private var loaded: LiteRtLmModelSpec? = null

    fun isArm64Device(): Boolean = LiteRtLmModels.abiSupported(Build.SUPPORTED_ABIS.toList())

    fun supportedAbis(): List<String> = Build.SUPPORTED_ABIS.toList()

    fun totalRamBytes(): Long {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val info = ActivityManager.MemoryInfo()
        am.getMemoryInfo(info)
        return info.totalMem
    }

    fun defaultModel(): LiteRtLmModelSpec? =
        LiteRtLmModels.select(totalRamBytes(), supportedAbis())

    fun modelFile(spec: LiteRtLmModelSpec): File = File(modelsDir, spec.fileName)

    fun isInstalled(spec: LiteRtLmModelSpec): Boolean {
        val file = modelFile(spec)
        // A truncated copy must never be treated as installed.
        return file.isFile && file.length() >= spec.approxBytes * 95 / 100
    }

    fun installedModel(): LiteRtLmModelSpec? = LiteRtLmModels.ALL.firstOrNull { isInstalled(it) }

    fun freeBytes(): Long = modelsDir.usableSpace

    /**
     * Streams one SAF URI into filesDir/models/.
     *
     * Writes to a .part file first so an interrupted copy can never masquerade as
     * a usable model, and verifies the free space budget up front.
     */
    @Throws(IOException::class)
    fun copyUriToModelsDir(uri: Uri, onProgress: (copied: Long, total: Long) -> Unit = { _, _ -> }): File {
        val resolver = context.contentResolver
        val displayName = resolveDisplayName(uri)
        var declaredSize = resolveDeclaredSize(uri)
        val spec = LiteRtLmModels.byFileName(displayName)
        if (spec != null && (declaredSize <= 0L || declaredSize < spec.approxBytes / 2)) {
            declaredSize = spec.approxBytes
        }

        if (declaredSize > 0L) {
            val budget = declaredSize + declaredSize / 20 + 64 * LiteRtLmModels.MIB
            if (freeBytes() < budget) {
                throw IOException(
                    "NOT ENOUGH SPACE: need ${budget / LiteRtLmModels.MIB} MB free in " +
                        "${modelsDir.absolutePath}, have ${freeBytes() / LiteRtLmModels.MIB} MB",
                )
            }
        }

        val target = File(modelsDir, displayName)
        val partial = File(modelsDir, "$displayName.part")
        if (partial.exists()) partial.delete()

        var copied = 0L
        try {
            val input = resolver.openInputStream(uri)
                ?: throw IOException("SAF provider returned no stream for $uri")
            input.use { source ->
                partial.outputStream().use { sink ->
                    val buffer = ByteArray(1024 * 1024)
                    var read = source.read(buffer)
                    while (read >= 0) {
                        if (read > 0) {
                            sink.write(buffer, 0, read)
                            copied += read
                            onProgress(copied, declaredSize)
                        }
                        read = source.read(buffer)
                    }
                    sink.flush()
                }
            }
            if (target.exists()) target.delete()
            if (!partial.renameTo(target)) {
                partial.copyTo(target, overwrite = true)
                partial.delete()
            }
        } catch (error: Throwable) {
            partial.delete()
            throw if (error is IOException) error else IOException(error.message ?: "copy failed", error)
        }

        if (copied == 0L) throw IOException("EMPTY FILE: $displayName copied 0 bytes")
        return target
    }

    private fun resolveDisplayName(uri: Uri): String {
        var name = uri.lastPathSegment?.substringAfterLast('/') ?: "model.litertlm"
        runCatching {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (index >= 0) cursor.getString(index)?.let { name = it }
                    }
                }
        }
        return name
    }

    private fun resolveDeclaredSize(uri: Uri): Long {
        var size = 0L
        runCatching {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)
                ?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val index = cursor.getColumnIndex(OpenableColumns.SIZE)
                        if (index >= 0 && !cursor.isNull(index)) size = cursor.getLong(index)
                    }
                }
        }
        return size
    }

    /**
     * Boots the engine for [spec]. Blocking: call from a background dispatcher,
     * initialize() takes seconds on a cold start.
     */
    @Throws(IOException::class)
    fun load(spec: LiteRtLmModelSpec): Engine {
        if (!isArm64Device()) {
            throw IOException(
                "UNSUPPORTED ABI: litertlm-android 0.18.0 ships arm64-v8a only, device reports " +
                    supportedAbis().joinToString(", "),
            )
        }
        if (!isInstalled(spec)) {
            throw IOException("MODEL MISSING: ${spec.fileName} is not in ${modelsDir.absolutePath}")
        }
        close()
        val config = EngineConfig(
            modelPath = modelFile(spec).absolutePath,
            backend = Backend.CPU(),
            cacheDir = context.cacheDir.path,
        )
        val booted = Engine(config)
        booted.initialize()
        engine = booted
        loaded = spec
        return booted
    }

    /** One blocking turn. Returns the reply text; call from a background dispatcher. */
    @Throws(IOException::class)
    fun generate(prompt: String): String {
        val booted = engine ?: throw IOException("ENGINE NOT LOADED: pick a .litertlm file first")
        val conversation = booted.createConversation()
        return try {
            conversation.sendMessage(prompt).toString().trim()
        } finally {
            conversation.close()
        }
    }

    fun close() {
        runCatching { engine?.close() }
        engine = null
        loaded = null
    }

    fun statusJson(): JSONObject {
        val selected = defaultModel()
        val installed = installedModel()
        return JSONObject().apply {
            put("runtime", "com.google.ai.edge.litertlm:litertlm-android:0.18.0")
            put("requiredAbi", LiteRtLmModels.REQUIRED_ABI)
            put("abis", JSONArray(supportedAbis()))
            put("arm64", isArm64Device())
            put("totalRamMb", totalRamBytes() / LiteRtLmModels.MIB)
            put("modelsDir", modelsDir.absolutePath)
            put("freeMb", freeBytes() / LiteRtLmModels.MIB)
            put("defaultModel", selected?.id ?: JSONObject.NULL)
            put("defaultFile", selected?.fileName ?: JSONObject.NULL)
            put("loadedModel", loaded?.id ?: JSONObject.NULL)
            put("installedModel", installed?.id ?: JSONObject.NULL)
            put("catalog", JSONArray(LiteRtLmModels.ALL.map { spec ->
                JSONObject().apply {
                    put("id", spec.id)
                    put("label", spec.label)
                    put("fileName", spec.fileName)
                    put("sizeLabel", spec.approxGbLabel)
                    put("minRamGb", spec.minTotalRamBytes / LiteRtLmModels.GIB)
                    put("installed", isInstalled(spec))
                    put("isDefault", spec == selected)
                    put("note", spec.note)
                }
            }))
        }
    }
}
