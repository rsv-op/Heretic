package com.heretic.voice

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.util.Log
import java.io.BufferedInputStream
import java.io.File
import java.io.InputStream
import java.util.zip.ZipInputStream

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
 * selections — including `.gguf` files, model directories, and `.zip` model bundles — into
 * app-private POSIX storage (`filesDir/voice_models/{llm,stt,tts}`) so native C++ (`llama.cpp`)
 * and ONNX Runtime sessions always have unrestricted file access on Android 11–16 Scoped Storage.
 */
object VoiceModelConfigStore {
    private const val TAG = "VoiceModelConfigStore"
    internal const val PREFS_NAME = "heretic_voice_pipeline_prefs"
    private const val KEY_LLAMA_PATH = "llama_model_path"
    internal const val KEY_STT_DIR = "stt_model_dir"
    private const val KEY_TTS_DIR = "tts_model_dir"
    private const val KEY_STYLE_PATH = "voice_style_path"

    private val GGUF_MAGIC = byteArrayOf(0x47, 0x47, 0x55, 0x46) // "GGUF"

    private val STT_ENCODER_NAMES = listOf(
        "encoder.int8.onnx",
        "encoder.onnx",
        "encoder-model.int8.onnx",
        "encoder-model.onnx",
    )
    private val STT_DECODER_NAMES = listOf(
        "decoder.int8.onnx",
        "decoder.onnx",
        "decoder-model.int8.onnx",
        "decoder-model.onnx",
    )
    private val STT_JOINER_NAMES = listOf(
        "joiner.int8.onnx",
        "joiner.onnx",
        "joiner-model.int8.onnx",
        "joiner-model.onnx",
    )
    private val STT_VOCAB_NAMES = listOf("vocab.txt", "tokens.txt")
    private val STT_VAD_NAMES = listOf("silero_vad.onnx", "silero_vad_v6.onnx", "silero_vad_v5.onnx")

    private val REQUIRED_TTS_ONNX_FILES = listOf(
        "duration_predictor.onnx",
        "text_encoder.onnx",
        "vector_estimator.onnx",
        "vocoder.onnx",
        "tts.json",
        "unicode_indexer.json",
    )

    private val SOURCE_REPO_MARKERS = listOf(
        "build.gradle",
        "build.gradle.kts",
        "settings.gradle",
        "settings.gradle.kts",
        "Cargo.toml",
        "pyproject.toml",
    )

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
        val resolvedStt = savedStt.let { raw ->
            if (raw.isNotEmpty()) {
                findValidSlotRoot("stt", File(raw), maxDepth = 3)?.absolutePath ?: raw
            } else {
                discoverSttDir(context)?.absolutePath
                    ?: File(defaultRoot, "stt").absolutePath
            }
        }
        val resolvedTts = savedTts.let { raw ->
            if (raw.isNotEmpty()) {
                findValidSlotRoot("tts", File(raw), maxDepth = 3)?.absolutePath ?: raw
            } else {
                discoverTtsDir(context)?.absolutePath
                    ?: File(defaultRoot, "tts").absolutePath
            }
        }
        val resolvedStyle = if (savedStyle.isNotEmpty() && File(savedStyle).isFile) {
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
        val cleanStt = paths.sttModelDir.trim().let { raw ->
            if (raw.isNotEmpty()) {
                findValidSlotRoot("stt", File(raw), maxDepth = 3)?.absolutePath ?: raw
            } else {
                raw
            }
        }
        val cleanTts = paths.ttsModelDir.trim().let { raw ->
            if (raw.isNotEmpty()) {
                findValidSlotRoot("tts", File(raw), maxDepth = 3)?.absolutePath ?: raw
            } else {
                raw
            }
        }
        val effectiveStyle = paths.voiceStylePath.trim().let { candidate ->
            if (candidate.isNotEmpty() && File(candidate).isFile) {
                candidate
            } else if (cleanTts.isNotEmpty()) {
                discoverVoiceStyle(File(cleanTts))?.absolutePath ?: candidate
            } else {
                candidate
            }
        }
        val normalized = VoiceModelPaths(
            llamaModelPath = paths.llamaModelPath.trim(),
            sttModelDir = cleanStt,
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
            !llmFile.exists() -> "Missing: ${llmFile.name} (pick a quantized .gguf file)"
            !llmFile.canRead() -> "Scoped Storage blocked direct read — use Pick .gguf File (SAF)"
            !llmHeaderOk -> "Invalid GGUF header in ${llmFile.name}"
            else -> "Ready (${formatSizeMb(llmFile.length())} · ${llmFile.name})"
        }

        val rawSttDir = File(paths.sttModelDir)
        val sttDir = findValidSlotRoot("stt", rawSttDir, maxDepth = 3) ?: rawSttDir
        val hasPreprocessor = File(sttDir, "nemo128.onnx").isFile
        val hasEncoder = STT_ENCODER_NAMES.any { File(sttDir, it).isFile }
        val hasDecoder = STT_DECODER_NAMES.any { File(sttDir, it).isFile }
        val hasJoiner = STT_JOINER_NAMES.any { File(sttDir, it).isFile }
        val hasVocab = STT_VOCAB_NAMES.any { File(sttDir, it).isFile }
        val hasExternalVad = STT_VAD_NAMES.any { File(sttDir, it).isFile }
        val sttReady = sttDir.isDirectory && sttDir.canRead() &&
            hasPreprocessor && hasEncoder && hasDecoder && hasJoiner && hasVocab
        val sttMsg = when {
            !sttDir.exists() -> "Not imported yet — pick STT folder or parakeet-tdt-stt-models.zip"
            !sttReady && looksLikeSourceRepo(sttDir) ->
                "Source code repo detected (${sttDir.name}) — import parakeet-tdt-stt-models.zip instead"
            !sttReady -> {
                val missing = buildList {
                    if (!hasEncoder) add("encoder.int8.onnx")
                    if (!hasDecoder) add("decoder.int8.onnx")
                    if (!hasJoiner) add("joiner.int8.onnx")
                    if (!hasPreprocessor) add("nemo128.onnx")
                    if (!hasVocab) add("vocab.txt")
                }
                "Missing: ${missing.joinToString(", ")}"
            }
            hasExternalVad -> "Ready (Parakeet TDT + Silero VAD)"
            else -> "Ready (Parakeet TDT + built-in Silero VAD)"
        }

        val rawTtsDir = File(paths.ttsModelDir)
        val ttsDir = findValidSlotRoot("tts", rawTtsDir, maxDepth = 3) ?: rawTtsDir
        val onnxSubdir = resolveTtsOnnxDir(ttsDir)
        val ttsReady = onnxSubdir != null && REQUIRED_TTS_ONNX_FILES.all { File(onnxSubdir, it).isFile }
        val styleFile = paths.voiceStylePath.takeIf { it.isNotBlank() }?.let(::File)
            ?.takeIf { it.isFile && it.canRead() }
            ?: discoverVoiceStyle(ttsDir)
        val styleReady = styleFile != null
        val ttsMsg = when {
            !ttsDir.exists() -> "Not imported yet — pick TTS folder or supertonic-tts-models.zip"
            !ttsReady && looksLikeSourceRepo(ttsDir) ->
                "Source code repo detected (${ttsDir.name}) — import supertonic-tts-models.zip instead"
            !ttsReady -> {
                val searchBase = if (File(ttsDir, "onnx").isDirectory) File(ttsDir, "onnx") else ttsDir
                val missing = REQUIRED_TTS_ONNX_FILES.filterNot { File(searchBase, it).isFile }
                "Missing in ${ttsDir.name}: ${missing.joinToString(", ")}"
            }
            !styleReady -> "ONNX ready, missing voice_styles/M1.json (or F1.json)"
            else -> "Ready (Supertonic ONNX · style: ${styleFile?.name})"
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
     * Uses direct POSIX file access ONLY if `hasGgufMagic(direct)` succeeds; otherwise copies
     * into `filesDir/voice_models/llm/` via `ContentResolver`.
     */
    fun importGgufDocument(
        context: Context,
        uri: Uri,
        onProgress: (String) -> Unit = {},
    ): Result<File> = runCatching {
        takePersistableReadIfPossible(context.contentResolver, uri)

        resolveDirectPosixFile(uri)?.let { direct ->
            if (direct.isFile && direct.canRead() && hasGgufMagic(direct)) {
                val current = loadPaths(context)
                savePaths(context, current.copy(llamaModelPath = direct.absolutePath))
                return@runCatching direct
            }
        }

        val rawName = queryDisplayName(context.contentResolver, uri) ?: "model.gguf"
        val safeName = sanitizeFileName(rawName).let {
            if (it.lowercase().endsWith(".gguf")) it else "$it.gguf"
        }

        val llmDir = File(context.filesDir, "voice_models/llm").apply { mkdirs() }
        val destFile = File(llmDir, safeName)

        onProgress("Copying $safeName into app-private storage...")
        context.contentResolver.openInputStream(uri)?.use { input ->
            destFile.outputStream().use { output ->
                val buf = ByteArray(256 * 1024)
                var copied = 0L
                var nextReportMb = 25L
                while (true) {
                    val read = input.read(buf)
                    if (read <= 0) break
                    output.write(buf, 0, read)
                    copied += read
                    val copiedMb = copied / 1_048_576L
                    if (copiedMb >= nextReportMb) {
                        onProgress("Copying $safeName (${copiedMb} MB)...")
                        nextReportMb = copiedMb + 25L
                    }
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
     *
     * Note on Android 11–16 Scoped Storage: `/storage/emulated/0/...` FUSE mounts return non-null
     * empty arrays from `File.listFiles()` while hiding `.onnx`, `.json`, and `.txt` files from
     * direct POSIX calls. Therefore we ONLY use `directDir` when [findValidSlotRoot] confirms the
     * actual model files are readable via `java.io.File`; otherwise we always copy via
     * `DocumentsContract` into `filesDir/voice_models/$slot`.
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
            val validDirectRoot = findValidSlotRoot(slot, directDir, maxDepth = 3)
            if (validDirectRoot != null) {
                Log.i(TAG, "Verified direct POSIX model directory for $slot: ${validDirectRoot.absolutePath}")
                persistImportedDirectory(context, slot, validDirectRoot)
                return@runCatching validDirectRoot
            }
        }

        val targetDir = File(context.filesDir, "voice_models/$slot")
        resetDirectory(targetDir)

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
        check(filesCopied > 0 || targetDir.walkTopDown().any { it.isFile }) {
            "Selected directory did not contain any readable files"
        }

        val effectiveDir = findValidSlotRoot(slot, targetDir, maxDepth = 3) ?: targetDir
        persistImportedDirectory(context, slot, effectiveDir)
        effectiveDir
    }

    /**
     * Imports a `.zip` model bundle (`parakeet-tdt-stt-models.zip` / `parakeetype_models.zip` for
     * `slot = "stt"`, or `supertonic-tts-models.zip` for `slot = "tts"`) selected via SAF
     * `ActivityResultContracts.OpenDocument` directly into `filesDir/voice_models/$slot`.
     */
    fun importModelArchiveDocument(
        context: Context,
        uri: Uri,
        slot: String,
        onProgress: (String) -> Unit = {},
    ): Result<File> = runCatching {
        require(slot == "stt" || slot == "tts") { "Unsupported model slot: $slot" }
        takePersistableReadIfPossible(context.contentResolver, uri)

        val targetDir = File(context.filesDir, "voice_models/$slot")
        val extracted = context.contentResolver.openInputStream(uri)?.use { rawStream ->
            extractModelZipStream(
                inputStream = rawStream,
                targetDir = targetDir,
                slot = slot,
                onProgress = onProgress,
            )
        } ?: error("Unable to open selected .zip model archive")

        persistImportedDirectory(context, slot, extracted)
        extracted
    }

    /**
     * Extracts a Parakeet STT or Supertonic TTS `.zip` stream into [targetDir], protecting against
     * Zip-Slip path traversal and normalizing nested wrapper folders automatically.
     */
    internal fun extractModelZipStream(
        inputStream: InputStream,
        targetDir: File,
        slot: String,
        onProgress: (String) -> Unit = {},
    ): File {
        require(slot == "stt" || slot == "tts") { "Unsupported model slot: $slot" }
        resetDirectory(targetDir)
        val canonicalTarget = targetDir.canonicalPath + File.separator

        var extractedFiles = 0
        ZipInputStream(BufferedInputStream(inputStream, 256 * 1024)).use { zis ->
            val buf = ByteArray(256 * 1024)
            while (true) {
                val entry = zis.nextEntry ?: break
                try {
                    val normalizedEntry = entry.name.replace('\\', '/').trimStart('/')
                    if (entry.isDirectory || normalizedEntry.isBlank()) continue

                    val segments = normalizedEntry.split('/').filter { it.isNotBlank() }
                    if (segments.isEmpty()) continue
                    if (segments.any { it == ".." || it == "__MACOSX" }) continue
                    val leafRaw = segments.last()
                    if (leafRaw.startsWith(".")) continue

                    val relativeDest = normalizeArchiveRelativePath(slot, segments)
                    val outFile = File(targetDir, relativeDest)
                    val canonicalOut = outFile.canonicalPath
                    check(canonicalOut.startsWith(canonicalTarget)) {
                        "Blocked unsafe zip entry path: ${entry.name}"
                    }

                    outFile.parentFile?.mkdirs()
                    extractedFiles++
                    onProgress("Extracting $slot file ($extractedFiles): ${outFile.name}")
                    outFile.outputStream().use { out ->
                        while (true) {
                            val read = zis.read(buf)
                            if (read <= 0) break
                            out.write(buf, 0, read)
                        }
                        out.flush()
                    }
                } finally {
                    zis.closeEntry()
                }
            }
        }

        check(extractedFiles > 0) {
            "Selected file is not a non-empty .zip archive"
        }

        val resolved = findValidSlotRoot(slot, targetDir, maxDepth = 3)
        check(resolved != null) {
            if (looksLikeSourceRepo(targetDir)) {
                "Selected .zip is a source-code repository without trained .onnx weights"
            } else if (slot == "stt") {
                "Archive did not contain required Parakeet STT files (encoder.int8.onnx, decoder.int8.onnx, joiner.int8.onnx, nemo128.onnx, vocab.txt)"
            } else {
                "Archive did not contain required Supertonic TTS files (duration_predictor.onnx, text_encoder.onnx, vector_estimator.onnx, vocoder.onnx, tts.json, unicode_indexer.json, voice_styles/*.json)"
            }
        }
        return resolved
    }

    private fun normalizeArchiveRelativePath(slot: String, segments: List<String>): String {
        val safeLeaf = sanitizeFileName(segments.last())
        if (slot == "tts") {
            val styleIdx = segments.indexOfLast { it.equals("voice_styles", ignoreCase = true) }
            if (styleIdx >= 0 && styleIdx < segments.lastIndex) {
                return "voice_styles/$safeLeaf"
            }
            val onnxIdx = segments.indexOfLast { it.equals("onnx", ignoreCase = true) }
            if (onnxIdx >= 0 && onnxIdx < segments.lastIndex) {
                return safeLeaf
            }
        }
        if (segments.size == 1) return safeLeaf
        return segments.map(::sanitizeFileName).joinToString("/")
    }

    private fun resetDirectory(dir: File) {
        if (dir.exists()) {
            dir.deleteRecursively()
        }
        dir.mkdirs()
    }

    internal fun findValidSlotRoot(slot: String, root: File, maxDepth: Int = 3): File? {
        if (!root.exists() || !root.isDirectory || !root.canRead()) return null
        if (isSlotDirectoryValid(slot, root)) return root
        if (maxDepth <= 0) return null

        val subdirs = root.listFiles()
            ?.filter { it.isDirectory && !it.name.startsWith(".") }
            ?.sortedBy { it.name }
            .orEmpty()

        for (child in subdirs) {
            val match = findValidSlotRoot(slot, child, maxDepth - 1)
            if (match != null) return match
        }
        return null
    }

    private fun isSlotDirectoryValid(slot: String, dir: File): Boolean {
        if (!dir.isDirectory || !dir.canRead()) return false
        return when (slot) {
            "stt" -> {
                File(dir, "nemo128.onnx").isFile &&
                    STT_ENCODER_NAMES.any { File(dir, it).isFile } &&
                    STT_DECODER_NAMES.any { File(dir, it).isFile } &&
                    STT_JOINER_NAMES.any { File(dir, it).isFile } &&
                    STT_VOCAB_NAMES.any { File(dir, it).isFile }
            }
            "tts" -> {
                val onnxDir = resolveTtsOnnxDir(dir) ?: return false
                REQUIRED_TTS_ONNX_FILES.all { File(onnxDir, it).isFile } &&
                    discoverVoiceStyle(dir) != null
            }
            else -> false
        }
    }

    private fun resolveTtsOnnxDir(ttsDir: File): File? = when {
        File(ttsDir, "duration_predictor.onnx").isFile -> ttsDir
        File(ttsDir, "onnx/duration_predictor.onnx").isFile -> File(ttsDir, "onnx")
        else -> null
    }

    private fun looksLikeSourceRepo(dir: File): Boolean {
        if (!dir.isDirectory) return false
        if (SOURCE_REPO_MARKERS.any { File(dir, it).exists() }) return true
        val children = dir.listFiles()?.filter { it.isDirectory }.orEmpty()
        return children.any { sub -> SOURCE_REPO_MARKERS.any { File(sub, it).exists() } }
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
                            input.copyTo(output, bufferSize = 256 * 1024)
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
                        !it.name.equals("tts.json", ignoreCase = true) &&
                        !it.name.equals("unicode_indexer.json", ignoreCase = true)
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
        for (dir in roots) {
            val valid = findValidSlotRoot("stt", dir, maxDepth = 3)
            if (valid != null) return valid
        }
        return roots.firstOrNull { it.isDirectory && it.listFiles()?.isNotEmpty() == true }
    }

    private fun discoverTtsDir(context: Context): File? {
        val roots = listOfNotNull(
            File(context.filesDir, "voice_models/tts"),
            context.getExternalFilesDir(null)?.let { File(it, "voice_models/tts") },
        )
        for (dir in roots) {
            val valid = findValidSlotRoot("tts", dir, maxDepth = 3)
            if (valid != null) return valid
        }
        return roots.firstOrNull { it.isDirectory && it.listFiles()?.isNotEmpty() == true }
    }

    internal fun hasGgufMagic(file: File): Boolean = runCatching {
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
