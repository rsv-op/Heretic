package ai.heretic.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import ai.heretic.app.core.HereticCore
import ai.heretic.app.ml.LiteRtLmEngine
import ai.heretic.app.ml.LiteRtLmModels
import ai.heretic.app.ui.HereticApp
import ai.heretic.app.ui.HereticJsBridge
import ai.heretic.app.ui.HereticTheme
import ai.heretic.app.voice.VoiceManager
import com.heretic.voice.VoicePipelineController
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * The web UI is served from the asset loader origin rather than file://.
 *
 * https://appassets.androidplatform.net/assets/index.html keeps allowFileAccess
 * false and still lets index.html import its ES modules and stream the PGlite
 * WebAssembly, both of which the file:// scheme blocks.
 */
private const val APP_ORIGIN = "https://appassets.androidplatform.net"
private const val APP_URL = "$APP_ORIGIN/assets/index.html"

class MainActivity : ComponentActivity() {

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            HereticTheme {
                val core = remember { HereticCore(applicationContext) }
                val voice = remember { VoiceManager(this) }
                val engine = remember { LiteRtLmEngine(applicationContext) }
                val scope = rememberCoroutineScope()
                val main = remember { Handler(Looper.getMainLooper()) }
                var useWebFrontend by remember { mutableStateOf(true) }
                var nativeInitialTab by remember { mutableIntStateOf(0) }
                var webViewRef by remember { mutableStateOf<WebView?>(null) }

                fun emit(event: String, payload: String) {
                    main.post {
                        webViewRef?.evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('$event', { detail: ${JSONObject.quote(payload)} }));",
                            null,
                        )
                    }
                }

                val micLauncherRef = remember { java.util.concurrent.atomic.AtomicReference<(() -> Unit)?>(null) }

                val voicePipeline = remember {
                    VoicePipelineController(
                        context = applicationContext,
                        onRequestRecordPermission = { micLauncherRef.get()?.invoke() },
                        onStateBroadcast = {
                            main.post {
                                webViewRef?.let { wv ->
                                    val jsonPayload = JSONObject().apply {
                                        put("llamaModelPath", it.paths.llamaModelPath)
                                        put("sttModelDir", it.paths.sttModelDir)
                                        put("ttsModelDir", it.paths.ttsModelDir)
                                        put("voiceStylePath", it.paths.voiceStylePath)
                                        put("llmReady", it.readiness.llmReady)
                                        put("sttReady", it.readiness.sttReady)
                                        put("ttsReady", it.readiness.ttsReady)
                                        put("styleReady", it.readiness.styleReady)
                                        put("allReady", it.readiness.allReady)
                                        put("llmMessage", it.readiness.llmMessage)
                                        put("sttMessage", it.readiness.sttMessage)
                                        put("ttsMessage", it.readiness.ttsMessage)
                                        put("isBusy", it.isBusy)
                                        put("isInitialized", it.isInitialized)
                                        put("isListening", it.isListening)
                                        put("isPlaying", it.isPlaying)
                                        put("statusMessage", it.statusMessage)
                                        put("lastUserTranscript", it.lastUserTranscript)
                                        put("lastAssistantSentence", it.lastAssistantSentence)
                                    }.toString()
                                    wv.evaluateJavascript(
                                        "window.dispatchEvent(new CustomEvent('heretic-voice-state', { detail: ${JSONObject.quote(jsonPayload)} }));",
                                        null,
                                    )
                                }
                            }
                        },
                    )
                }

                val voicePipelineMicLauncher = rememberLauncherForActivityResult(
                    ActivityResultContracts.RequestPermission(),
                ) { granted ->
                    voicePipeline.onRecordPermissionResult(granted)
                }

                SideEffect {
                    micLauncherRef.set {
                        voicePipelineMicLauncher.launch(Manifest.permission.RECORD_AUDIO)
                    }
                }

                val ggufPickerLauncher = rememberLauncherForActivityResult(
                    ActivityResultContracts.OpenDocument(),
                ) { uri: Uri? ->
                    uri?.let { voicePipeline.importGgufUri(it) }
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

                fun loadModelFrom(uri: Uri, displayName: String, scope: CoroutineScope) {
                    val spec = LiteRtLmModels.byFileName(displayName)
                    if (spec == null) {
                        emit(
                            "heretic-model-error",
                            "NOT A MODEL: $displayName is not a .litertlm bundle this build knows " +
                                "(expected ${LiteRtLmModels.GEMMA_4_E2B.fileName} or " +
                                "${LiteRtLmModels.GEMMA_3N_E2B.fileName})",
                        )
                        return
                    }
                    scope.launch {
                        emit("heretic-model", """{"state":"copying","file":"${spec.fileName}"}""")
                        val result = withContext(Dispatchers.IO) {
                            runCatching {
                                engine.copyUriToModelsDir(uri) { copied, total ->
                                    if (total > 0) {
                                        val pct = (copied * 100 / total).toInt()
                                        emit(
                                            "heretic-model-progress",
                                            """{"file":"${spec.fileName}","percent":$pct,"copiedMb":${copied / LiteRtLmModels.MIB},"totalMb":${total / LiteRtLmModels.MIB}}""",
                                        )
                                    }
                                }
                            }
                        }
                        result.onSuccess {
                            emit(
                                "heretic-model",
                                """{"state":"copied","file":"${spec.fileName}","path":"${it.absolutePath}","bytes":${it.length()}}""",
                            )
                            val boot = withContext(Dispatchers.IO) { runCatching { engine.load(spec) } }
                            boot.onSuccess {
                                emit(
                                    "heretic-model",
                                    """{"state":"ready","file":"${spec.fileName}","runtime":"litertlm-android:0.18.0","status":${engine.statusJson()}}""",
                                )
                            }.onFailure { error ->
                                emit("heretic-model-error", "LOAD FAILED: ${error.message}")
                            }
                        }.onFailure { error ->
                            emit("heretic-model-error", error.message ?: "copy failed")
                        }
                    }
                }

                DisposableEffect(Unit) {
                    onDispose {
                        voicePipeline.shutdown()
                        voice.shutdown()
                        engine.close()
                    }
                }

                val micPermissionLauncher = rememberLauncherForActivityResult(
                    ActivityResultContracts.RequestPermission(),
                ) { granted ->
                    if (granted) {
                        voice.startListening(
                            onResult = { transcript -> emit("heretic-stt", transcript) },
                            onError = { err -> emit("heretic-stt-error", err) },
                        )
                    } else {
                        emit("heretic-stt-error", "RECORD_AUDIO denied at the authorization gate")
                    }
                }

                val filePickerLauncher = rememberLauncherForActivityResult(
                    ActivityResultContracts.OpenDocument(),
                ) { uri: Uri? ->
                    uri?.let {
                        runCatching {
                            contentResolver.takePersistableUriPermission(
                                it,
                                Intent.FLAG_GRANT_READ_URI_PERMISSION,
                            )
                        }
                        val name = resolveFileName(it)
                        val lower = name.lowercase()
                        when {
                            lower.endsWith(".litertlm") -> loadModelFrom(it, name, scope)
                            lower.endsWith(".gguf") -> {
                                voicePipeline.importGgufUri(it)
                                emit("heretic-file-picked", name)
                            }
                            lower.endsWith(".zip") && (lower.contains("parakeet") || lower.contains("stt")) -> {
                                voicePipeline.importModelArchiveUri(it, "stt")
                                emit("heretic-file-picked", name)
                            }
                            lower.endsWith(".zip") && (lower.contains("supertonic") || lower.contains("tts")) -> {
                                voicePipeline.importModelArchiveUri(it, "tts")
                                emit("heretic-file-picked", name)
                            }
                            else -> emit("heretic-file-picked", name)
                        }
                    }
                }

                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    if (useWebFrontend) {
                        BackHandler(enabled = webViewRef?.canGoBack() == true) {
                            webViewRef?.goBack()
                        }
                        AndroidView(
                            modifier = Modifier.fillMaxSize(),
                            factory = { ctx ->
                                val assetLoader = WebViewAssetLoader.Builder()
                                    .addPathHandler(
                                        "/assets/",
                                        WebViewAssetLoader.AssetsPathHandler(ctx),
                                    )
                                    .build()

                                WebView(ctx).apply {
                                    settings.javaScriptEnabled = true
                                    settings.domStorageEnabled = true
                                    settings.databaseEnabled = true
                                    settings.allowFileAccess = false
                                    settings.allowContentAccess = false
                                    settings.mediaPlaybackRequiresUserGesture = false
                                    settings.cacheMode = WebSettings.LOAD_NO_CACHE

                                    webViewClient = object : WebViewClient() {
                                        override fun shouldInterceptRequest(
                                            view: WebView?,
                                            request: WebResourceRequest?,
                                        ): WebResourceResponse? =
                                            request?.url?.let { assetLoader.shouldInterceptRequest(it) }

                                        override fun onReceivedError(
                                            view: WebView?,
                                            code: Int,
                                            description: String?,
                                            failingUrl: String?,
                                        ) {
                                            core.log("webview.error", "$code $description $failingUrl")
                                        }
                                    }

                                    webChromeClient = object : WebChromeClient() {
                                        override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                                            core.log("webview.console", msg.message())
                                            return true
                                        }
                                    }

                                    addJavascriptInterface(
                                        HereticJsBridge(
                                            core = core,
                                            voice = voice,
                                            engine = engine,
                                            onPickFileRequest = {
                                                filePickerLauncher.launch(arrayOf("*/*"))
                                            },
                                            onRequestMicPermission = {
                                                val granted = ContextCompat.checkSelfPermission(
                                                    ctx,
                                                    Manifest.permission.RECORD_AUDIO,
                                                ) == PackageManager.PERMISSION_GRANTED
                                                if (granted) {
                                                    voice.startListening(
                                                        onResult = { emit("heretic-stt", it) },
                                                        onError = { emit("heretic-stt-error", it) },
                                                    )
                                                } else {
                                                    micPermissionLauncher.launch(
                                                        Manifest.permission.RECORD_AUDIO,
                                                    )
                                                }
                                            },
                                            onRequestModelLoad = {
                                                filePickerLauncher.launch(arrayOf("*/*"))
                                            },
                                            voicePipeline = voicePipeline,
                                            onPickGgufModel = {
                                                ggufPickerLauncher.launch(arrayOf("*/*"))
                                            },
                                            onPickSttDir = {
                                                sttTreePickerLauncher.launch(null)
                                            },
                                            onPickSttZip = {
                                                sttZipPickerLauncher.launch(arrayOf("application/zip", "application/x-zip-compressed", "*/*"))
                                            },
                                            onPickTtsDir = {
                                                ttsTreePickerLauncher.launch(null)
                                            },
                                            onPickTtsZip = {
                                                ttsZipPickerLauncher.launch(arrayOf("application/zip", "application/x-zip-compressed", "*/*"))
                                            },
                                            onOpenNativeVoiceUi = {
                                                nativeInitialTab = 0
                                                useWebFrontend = false
                                            },
                                        ),
                                        "HereticNative",
                                    )

                                    loadUrl(APP_URL)
                                    webViewRef = this
                                }
                            },
                        )
                    } else {
                        BackHandler {
                            useWebFrontend = true
                        }
                        HereticApp(
                            core = core,
                            voice = voice,
                            voicePipeline = voicePipeline,
                            onPickGguf = { ggufPickerLauncher.launch(arrayOf("*/*")) },
                            onPickSttDir = { sttTreePickerLauncher.launch(null) },
                            onPickSttZip = {
                                sttZipPickerLauncher.launch(arrayOf("application/zip", "application/x-zip-compressed", "*/*"))
                            },
                            onPickTtsDir = { ttsTreePickerLauncher.launch(null) },
                            onPickTtsZip = {
                                ttsZipPickerLauncher.launch(arrayOf("application/zip", "application/x-zip-compressed", "*/*"))
                            },
                            onSwitchToWebUi = { useWebFrontend = true },
                            initialTab = nativeInitialTab,
                        )
                    }
                }
            }
        }
    }

    private fun resolveFileName(uri: Uri): String {
        var name = uri.lastPathSegment ?: "selected-file"
        runCatching {
            contentResolver.query(
                uri,
                arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
                null,
                null,
                null,
            )?.use { c ->
                if (c.moveToFirst()) {
                    val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0) name = c.getString(idx)
                }
            }
        }
        return name
    }
}
