package com.heretic.voice

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.util.Log
import java.io.File

data class VoiceModelPaths(
    val llamaModelPath: String,
    val sttModelDir: String,
    val ttsModelDir: String,
    val voiceStylePath: String,
)

data class VoiceModelReadiness(
    val llmReady: Boolean,
    val sttReady: Boolean,
    val ttsReady: Boolean,
    val styleReady: Boolean,
    val llmMessage: String,
    val sttMessage: String,
    val ttsMessage: String,
) {
    val allReady: Boolean
        get() = llmReady && sttReady && ttsReady && styleReady
}

/**
 * Persists local voice-pipeline model paths and imports SAF (`OpenDocument` / `OpenDocumentTree`)
 * selections into app-readable POSIX storage when Android Scoped Storage blocks direct C++/ONNX
 * file path access.
 */
object VoiceModelConfigStore {
    private const val TAG = "VoiceModelConfigStore"
    internal const val PREFS_NAME = "heretic_voice_pipeline_prefs"
    private const val KEY_LLAMA_PATH = "llama_model_path"
    internal const val KEY_STT_DIR = "stt_model_dir"
    private const val KEY_TTS_DIR = "tts_model_dir"
    private const val KEY_STYLE_PATH = "voice_style_path"

    private val GGUF_MAGIC = byteArrayOf(0x47, 0x47, 0x55, 0x46) // "GGUF"

    fun loadPaths(context: Context): VoiceModelPaths {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val defaultRoot = File(context.filesDir, "voice_models")

        val savedLlama = prefs.getString(KEY_LLAMA_PATH, null)?.trim().orEmpty()
        val savedStt = prefs.getString(KEY_STT_DIR, null)?.trim().orEmpty()
        val savedTts = prefs.getString(KEY_TTS_DIR, null)?.trim().orEmpty()
        val savedStyle = prefs.getString(KEY_STYLE_PATH, null)?.trim().orEmpty()

        val resolvedLlama = savedLlama.ifEmpty {
            discoverFirstGguf(context)?.absolutePath
                ?: File(defaultRoot, "llm/model.gguf").absolutePath
        }
        val resolvedStt = savedStt.ifEmpty {
            discoverSttDir(context)?.absolutePath
                ?: File(defaultRoot, "stt").absolutePath
        }
        val resolvedTts = savedTts.ifEmpty {
            discoverTtsDir(context)?.absolutePath
                ?: File(defaultRoot, "tts").absolutePath
        }
        val resolvedStyle = if (savedStyle.isNotEmpty() && File(savedStyle).exists()) {
            savedStyle
        } else {
            discoverVoiceStyle(File(resolvedTts))?.absolutePath
                ?: savedStyle.ifEmpty { File(resolvedTts, "voice_styles/M1.json").absolutePath }
        }

        return VoiceModelPaths(
            llamaModelPath = resolvedLlama,
            sttModelDir = resolvedStt,
            ttsModelDir = resolvedTts,
            voiceStylePath = resolvedStyle,
        )
    }

    fun savePaths(context: Context, paths: VoiceModelPaths): VoiceModelPaths {
        val cleanTts = paths.ttsModelDir.trim()
        val effectiveStyle = paths.voiceStylePath.trim().let { candidate ->
            if (candidate.isNotEmpty() && File(candidate).exists()) {
                candidate
            } else if (cleanTts.isNotEmpty()) {
                discoverVoiceStyle(File(cleanTts))?.absolutePath ?: candidate
            } else {
                candidate
            }
        }
        val normalized = VoiceModelPaths(
            llamaModelPath = paths.llamaModelPath.trim(),
            sttModelDir = paths.sttModelDir.trim(),
            ttsModelDir = cleanTts,
            voiceStylePath = effectiveStyle,
        )
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_LLAMA_PATH, normalized.llamaModelPath)
            .putString(KEY_STT_DIR, normalized.sttModelDir)
            .putString(KEY_TTS_DIR, normalized.ttsModelDir)
            .putString(KEY_STYLE_PATH, normalized.voiceStylePath)
            .apply()
        return normalized
    }

    fun validate(paths: VoiceModelPaths): VoiceModelReadiness {
        val llmFile = File(paths.llamaModelPath)
        val llmHeaderOk = llmFile.exists() && llmFile.isFile && llmFile.canRead() && hasGgufMagic(llmFile)
        val llmMsg = when {
            paths.llamaModelPath.isBlank() -> "No .gguf model selected"
            !llmFile.exists() -> "Missing: ${llmFile.name}"
            !llmFile.canRead() -> "Unreadable: ${llmFile.absolutePath}"
            !llmHeaderOk -> "Invalid GGUF header in ${llmFile.name}"
            else -> "Ready (${formatSizeMb(llmFile.length())} · ${llmFile.name})"
        }

        val sttDir = File(paths.sttModelDir)
        val hasEncoder = listOf("encoder.int8.onnx", "encoder.onnx", "encoder-model.int8.onnx", "encoder-model.onnx")
            .any { File(sttDir, it).isFile }
        val hasDecoder = listOf("decoder.int8.onnx", "decoder.onnx", "decoder-model.int8.onnx", "decoder-model.onnx")
            .any { File(sttDir, it).isFile }
        val hasJoiner = listOf("joiner.int8.onnx", "joiner.onnx", "joiner-model.int8.onnx", "joiner-model.onnx")
            .any { File(sttDir, it).isFile }
        val hasVocab = File(sttDir, "vocab.txt").isFile || File(sttDir, "tokens.txt").isFile
        val hasVad = listOf("silero_vad.onnx", "silero_vad_v6.onnx", "silero_vad_v5.onnx")
            .any { File(sttDir, it).isFile }
        val sttReady = sttDir.isDirectory && sttDir.canRead() && hasEncoder && hasDecoder && hasJoiner && hasVocab
        val sttMsg = when {
            !sttDir.exists() -> "Directory not created yet (${sttDir.name})"
            !sttReady -> {
                val missing = buildList {
                    if (!hasEncoder) add("encoder*.onnx")
                    if (!hasDecoder) add("decoder*.onnx")
                    if (!hasJoiner) add("joiner*.onnx")
                    if (!hasVocab) add("vocab.txt")
                }
                "Missing: ${missing.joinToString(", ")}"
            }
            hasVad -> "Ready (Parakeet TDT + Silero VAD)"
            else -> "Ready (Parakeet TDT · RMS VAD fallback)"
        }

        val ttsDir = File(paths.ttsModelDir)
        val onnxSubdir = when {
            File(ttsDir, "duration_predictor.onnx").isFile -> ttsDir
            File(ttsDir, "onnx/duration_predictor.onnx").isFile -> File(ttsDir, "onnx")
            else -> null
        }
        val requiredTtsFiles = listOf(
            "duration_predictor.onnx",
            "text_encoder.onnx",
            "vector_estimator.onnx",
            "vocoder.onnx",
            "tts.json",
            "unicode_indexer.json",
        )
        val ttsReady = onnxSubdir != null && requiredTtsFiles.all { File(onnxSubdir, it).isFile }
        val styleFile = paths.voiceStylePath.takeIf { it.isNotBlank() }?.let(::File)
            ?.takeIf { it.isFile && it.canRead() }
            ?: discoverVoiceStyle(ttsDir)
        val styleReady = styleFile != null
        val ttsMsg = when {
            !ttsDir.exists() -> "Directory not created yet (${ttsDir.name})"
            !ttsReady -> "Missing Supertonic ONNX/config files in ${ttsDir.name}"
            !styleReady -> "ONNX ready, missing voice_styles/*.json"
            else -> "Ready (style: ${styleFile?.name})"
        }

        return VoiceModelReadiness(
            llmReady = llmHeaderOk,
            sttReady = sttReady,
            ttsReady = ttsReady,
            styleReady = styleReady,
            llmMessage = llmMsg,
            sttMessage = sttMsg,
            ttsMessage = ttsMsg,
        )
    }

    /**
     * Imports a `.gguf` file selected via `ActivityResultContracts.OpenDocument`.
     * Uses direct POSIX file access if readable; otherwise copies into `filesDir/voice_models/llm/`.
     */
    fun importGgufDocument(
        context: Context,
        uri: Uri,
        onProgress: (String) -> Unit = {},
    ): Result<File> = runCatching {
        takePersistableReadIfPossible(context.contentResolver, uri)

        resolveDirectPosixFile(uri)?.let { direct ->
            if (direct.isFile && direct.canRead() && hasGgufMagic(direct)) {
                return@runCatching direct
            }
        }

        val rawName = queryDisplayName(context.contentResolver, uri) ?: "model.gguf"
        val safeName = sanitizeFileName(rawName).let {
            if (it.lowercase().endsWith(".gguf")) it else "$it.gguf"
        }

        val llmDir = File(context.filesDir, "voice_models/llm").apply { mkdirs() }
        val destFile = File(llmDir, safeName)

        onProgress("Copying $safeName into local storage...")
        context.contentResolver.openInputStream(uri)?.use { input ->
            destFile.outputStream().use { output ->
                val buf = ByteArray(256 * 1024)
                var copied = 0L
                while (true) {
                    val read = input.read(buf)
                    if (read <= 0) break
                    output.write(buf, 0, read)
                    copied += read
                }
                output.flush()
                Log.i(TAG, "Imported GGUF model ($copied bytes) -> ${destFile.absolutePath}")
            }
        } ?: error("Unable to open selected GGUF document stream")

        check(hasGgufMagic(destFile)) {
            val badName = destFile.name
            destFile.delete()
            "Selected file '$badName' does not start with GGUF magic header"
        }

        val current = loadPaths(context)
        savePaths(context, current.copy(llamaModelPath = destFile.absolutePath))
        destFile
    }

    /**
     * Imports a Parakeet STT (`slot = "stt"`) or Supertonic TTS (`slot = "tts"`) directory selected
     * via `ActivityResultContracts.OpenDocumentTree`.
     */
    fun importModelDirectoryTree(
        context: Context,
        treeUri: Uri,
        slot: String,
        onProgress: (String) -> Unit = {},
    ): Result<File> = runCatching {
        require(slot == "stt" || slot == "tts") { "Unsupported model slot: $slot" }
        takePersistableReadIfPossible(context.contentResolver, treeUri)

        val rootDocId = DocumentsContract.getTreeDocumentId(treeUri)
        resolveDirectPosixTreeDirectory(rootDocId)?.let { directDir ->
            if (directDir.isDirectory && directDir.canRead() && directDir.listFiles() != null) {
                Log.i(TAG, "Using direct POSIX directory for $slot: ${directDir.absolutePath}")
                persistImportedDirectory(context, slot, directDir)
                return@runCatching directDir
            }
        }

        val targetDir = File(context.filesDir, "voice_models/$slot").apply { mkdirs() }
        var filesCopied = 0
        copyDocumentTreeRecursive(
            resolver = context.contentResolver,
            treeUri = treeUri,
            parentDocId = rootDocId,
            destDir = targetDir,
            onFileCopying = { name ->
                filesCopied++
                onProgress("Importing $slot file ($filesCopied): $name")
            }
        )
        check(targetDir.listFiles()?.isNotEmpty() == true) {
            "Selected directory did not contain any readable files"
        }

        persistImportedDirectory(context, slot, targetDir)
        targetDir
    }

    private fun persistImportedDirectory(context: Context, slot: String, dir: File) {
        val current = loadPaths(context)
        val updated = if (slot == "stt") {
            current.copy(sttModelDir = dir.absolutePath)
        } else {
            val discoveredStyle = discoverVoiceStyle(dir)?.absolutePath ?: current.voiceStylePath
            current.copy(
                ttsModelDir = dir.absolutePath,
                voiceStylePath = discoveredStyle,
            )
        }
        savePaths(context, updated)
    }

    private fun copyDocumentTreeRecursive(
        resolver: ContentResolver,
        treeUri: Uri,
        parentDocId: String,
        destDir: File,
        onFileCopying: (String) -> Unit,
    ) {
        destDir.mkdirs()
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocId)
        val projection = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE,
        )

        resolver.query(childrenUri, projection, null, null, null)?.use { cursor ->
            val idIdx = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
            val nameIdx = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
            val mimeIdx = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)
            val sizeIdx = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_SIZE)

            while (cursor.moveToNext()) {
                val docId = cursor.getString(idIdx) ?: continue
                val rawName = cursor.getString(nameIdx) ?: continue
                if (rawName.startsWith(".")) continue
                val safeName = sanitizeFileName(rawName)
                val mime = cursor.getString(mimeIdx).orEmpty()
                val expectedSize = if (cursor.isNull(sizeIdx)) -1L else cursor.getLong(sizeIdx)

                if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
                    copyDocumentTreeRecursive(
                        resolver = resolver,
                        treeUri = treeUri,
                        parentDocId = docId,
                        destDir = File(destDir, safeName),
                        onFileCopying = onFileCopying,
                    )
                } else {
                    val outFile = File(destDir, safeName)
                    if (outFile.exists() && expectedSize > 0L && outFile.length() == expectedSize) {
                        continue
                    }
                    onFileCopying(safeName)
                    val docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId)
                    resolver.openInputStream(docUri)?.use { input ->
                        outFile.outputStream().use { output ->
                            input.copyTo(output, bufferSize = 128 * 1024)
                        }
                    }
                }
            }
        }
    }

    internal fun discoverVoiceStyle(ttsDir: File): File? {
        val candidateDirs = listOfNotNull(
            File(ttsDir, "voice_styles"),
            ttsDir.parentFile?.let { File(it, "voice_styles") },
            ttsDir,
        )
        for (dir in candidateDirs) {
            if (!dir.isDirectory) continue
            val style = dir.listFiles()
                ?.filter {
                    it.isFile &&
                        it.extension.equals("json", ignoreCase = true) &&
                        it.name != "tts.json" &&
                        it.name != "unicode_indexer.json"
                }
                ?.sortedWith(
                    compareBy<File>(
                        { !it.name.equals("M1.json", ignoreCase = true) },
                        { !it.name.equals("F1.json", ignoreCase = true) },
                        { it.name }
                    )
                )
                ?.firstOrNull()
            if (style != null) return style
        }
        return null
    }

    private fun discoverFirstGguf(context: Context): File? {
        val roots = listOfNotNull(
            File(context.filesDir, "voice_models/llm"),
            File(context.filesDir, "models"),
            context.getExternalFilesDir(null)?.let { File(it, "voice_models/llm") },
            context.getExternalFilesDir(null)?.let { File(it, "models") },
        )
        for (dir in roots) {
            val found = dir.listFiles()
                ?.firstOrNull { it.isFile && it.extension.equals("gguf", ignoreCase = true) && hasGgufMagic(it) }
            if (found != null) return found
        }
        return null
    }

    private fun discoverSttDir(context: Context): File? {
        val roots = listOfNotNull(
            File(context.filesDir, "voice_models/stt"),
            context.getExternalFilesDir(null)?.let { File(it, "voice_models/stt") },
        )
        return roots.firstOrNull { it.isDirectory && it.listFiles()?.isNotEmpty() == true }
    }

    private fun discoverTtsDir(context: Context): File? {
        val roots = listOfNotNull(
            File(context.filesDir, "voice_models/tts"),
            context.getExternalFilesDir(null)?.let { File(it, "voice_models/tts") },
        )
        return roots.firstOrNull { it.isDirectory && it.listFiles()?.isNotEmpty() == true }
    }

    private fun hasGgufMagic(file: File): Boolean = runCatching {
        if (!file.isFile || file.length() < 16L) return@runCatching false
        val header = ByteArray(4)
        file.inputStream().use { stream ->
            if (stream.read(header) != 4) return@runCatching false
        }
        header.contentEquals(GGUF_MAGIC)
    }.getOrDefault(false)

    private fun takePersistableReadIfPossible(resolver: ContentResolver, uri: Uri) {
        runCatching {
            resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }

    private fun resolveDirectPosixFile(uri: Uri): File? {
        if (uri.scheme == "file") {
            return uri.path?.let(::File)
        }
        val docId = runCatching { DocumentsContract.getDocumentId(uri) }.getOrNull() ?: return null
        return resolveDirectPosixTreeDirectory(docId)
    }

    private fun resolveDirectPosixTreeDirectory(docId: String): File? {
        val parts = docId.split(":", limit = 2)
        if (parts.size != 2) return null
        val volume = parts[0]
        val rel = parts[1].trimStart('/')
        return if (volume.equals("primary", ignoreCase = true)) {
            val base = Environment.getExternalStorageDirectory()
            if (rel.isEmpty()) base else File(base, rel)
        } else {
            val mounted = File("/storage/$volume")
            if (!mounted.exists()) null else if (rel.isEmpty()) mounted else File(mounted, rel)
        }
    }

    private fun queryDisplayName(resolver: ContentResolver, uri: Uri): String? =
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }

    private fun sanitizeFileName(raw: String): String =
        raw.replace(Regex("[^A-Za-z0-9._-]"), "_").ifBlank { "model" }

    private fun formatSizeMb(bytes: Long): String =
        String.format(java.util.Locale.US, "%.1f MB", bytes / 1_048_576.0)
}
