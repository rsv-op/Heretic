package ai.heretic.app

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import ai.heretic.app.core.FileAssessment
import ai.heretic.app.core.HereticCore
import ai.heretic.app.ml.LiteRtLmEngine
import ai.heretic.app.ui.HereticApp
import ai.heretic.app.ui.HereticTheme
import ai.heretic.app.voice.VoiceManager
import com.heretic.voice.VoicePipelineController

/**
 * Pure Native Android Launcher for the Heretic Voice Assistant.
 *
 * Boots directly into the Jetpack Compose `HereticApp` voice command center with zero WebView
 * overhead, zero network permissions, and full offline voice + neural model integration.
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            HereticTheme(darkTheme = true) {
                val core = remember { HereticCore(applicationContext) }
                val voice = remember { VoiceManager(this) }
                val liteRtEngine = remember { LiteRtLmEngine(applicationContext) }
                var assessedSafFile by remember { mutableStateOf<FileAssessment?>(null) }

                val micLauncherRef = remember { java.util.concurrent.atomic.AtomicReference<(() -> Unit)?>(null) }

                val voicePipeline = remember {
                    VoicePipelineController(
                        context = applicationContext,
                        core = core,
                        platformVoice = voice,
                        liteRtEngine = liteRtEngine,
                        onRequestRecordPermission = { micLauncherRef.get()?.invoke() },
                    )
                }

                val micPermissionLauncher = rememberLauncherForActivityResult(
                    ActivityResultContracts.RequestPermission(),
                ) { granted ->
                    voicePipeline.onRecordPermissionResult(granted)
                }

                SideEffect {
                    micLauncherRef.set {
                        micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                    }
                }

                val ggufPickerLauncher = rememberLauncherForActivityResult(
                    ActivityResultContracts.OpenDocument(),
                ) { uri: Uri? ->
                    uri?.let { voicePipeline.importGgufUri(it) }
                }

                val liteRtPickerLauncher = rememberLauncherForActivityResult(
                    ActivityResultContracts.OpenDocument(),
                ) { uri: Uri? ->
                    uri?.let {
                        val (name, _) = resolveFileMeta(it)
                        voicePipeline.importLiteRtLmUri(it, name)
                    }
                }

                val sttTreePickerLauncher = rememberLauncherForActivityResult(
                    ActivityResultContracts.OpenDocumentTree(),
                ) { uri: Uri? ->
                    uri?.let { voicePipeline.importModelDirectoryUri(it, "stt") }
                }

                val sttZipPickerLauncher = rememberLauncherForActivityResult(
                    ActivityResultContracts.OpenDocument(),
                ) { uri: Uri? ->
                    uri?.let { voicePipeline.importModelArchiveUri(it, "stt") }
                }

                val ttsTreePickerLauncher = rememberLauncherForActivityResult(
                    ActivityResultContracts.OpenDocumentTree(),
                ) { uri: Uri? ->
                    uri?.let { voicePipeline.importModelDirectoryUri(it, "tts") }
                }

                val ttsZipPickerLauncher = rememberLauncherForActivityResult(
                    ActivityResultContracts.OpenDocument(),
                ) { uri: Uri? ->
                    uri?.let { voicePipeline.importModelArchiveUri(it, "tts") }
                }

                val assessorFilePickerLauncher = rememberLauncherForActivityResult(
                    ActivityResultContracts.OpenDocument(),
                ) { uri: Uri? ->
                    uri?.let {
                        runCatching {
                            contentResolver.takePersistableUriPermission(
                                it,
                                Intent.FLAG_GRANT_READ_URI_PERMISSION,
                            )
                        }
                        core.gates.record("file.saf.read", "GRANTED", source = "saf-picker")
                        val (name, sizeBytes) = resolveFileMeta(it)
                        val result = core.assessFile(name, sizeBytes)
                        assessedSafFile = result
                        voicePipeline.speakTextAloud("${result.fileName}: ${result.relevance}, ${result.usefulness} percent useful.")

                        val lower = name.lowercase()
                        when {
                            lower.endsWith(".gguf") -> voicePipeline.importGgufUri(it)
                            lower.endsWith(".litertlm") -> voicePipeline.importLiteRtLmUri(it, name)
                            lower.endsWith(".zip") && (lower.contains("parakeet") || lower.contains("stt")) ->
                                voicePipeline.importModelArchiveUri(it, "stt")
                            lower.endsWith(".zip") && (lower.contains("supertonic") || lower.contains("tts")) ->
                                voicePipeline.importModelArchiveUri(it, "tts")
                        }
                    }
                }

                DisposableEffect(Unit) {
                    onDispose {
                        voicePipeline.shutdown()
                        voice.shutdown()
                        liteRtEngine.close()
                    }
                }

                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    HereticApp(
                        core = core,
                        voice = voice,
                        voicePipeline = voicePipeline,
                        liteRtEngine = liteRtEngine,
                        onPickGguf = { ggufPickerLauncher.launch(arrayOf("*/*")) },
                        onPickLiteRtLm = { liteRtPickerLauncher.launch(arrayOf("*/*")) },
                        onPickSttDir = { sttTreePickerLauncher.launch(null) },
                        onPickSttZip = {
                            sttZipPickerLauncher.launch(
                                arrayOf("application/zip", "application/x-zip-compressed", "*/*")
                            )
                        },
                        onPickTtsDir = { ttsTreePickerLauncher.launch(null) },
                        onPickTtsZip = {
                            ttsZipPickerLauncher.launch(
                                arrayOf("application/zip", "application/x-zip-compressed", "*/*")
                            )
                        },
                        onPickAnyFileForAssessor = {
                            assessorFilePickerLauncher.launch(arrayOf("*/*"))
                        },
                        externallyAssessedFile = assessedSafFile,
                    )
                }
            }
        }
    }

    private fun resolveFileMeta(uri: Uri): Pair<String, Long> {
        var name = uri.lastPathSegment?.substringAfterLast('/') ?: "selected-file"
        var size = 0L
        runCatching {
            contentResolver.query(
                uri,
                arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
                null,
                null,
                null,
            )?.use { c ->
                if (c.moveToFirst()) {
                    val nameIdx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nameIdx >= 0 && !c.isNull(nameIdx)) name = c.getString(nameIdx)
                    val sizeIdx = c.getColumnIndex(OpenableColumns.SIZE)
                    if (sizeIdx >= 0 && !c.isNull(sizeIdx)) size = c.getLong(sizeIdx)
                }
            }
        }
        return name to size
    }
}
