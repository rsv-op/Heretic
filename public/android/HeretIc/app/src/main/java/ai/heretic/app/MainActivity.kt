package ai.heretic.app

import android.Manifest
import android.annotation.SuppressLint
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
import androidx.compose.runtime.getValue
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
                var webViewRef by remember { mutableStateOf<WebView?>(null) }

                // WebView JavaScript must be evaluated on the main thread, exactly
                // like SpeechRecognizer and TextToSpeech.
                fun emit(event: String, payload: String) {
                    main.post {
                        webViewRef?.evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('$event', { detail: ${JSONObject.quote(payload)} }));",
                            null,
                        )
                    }
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
                        // Storage Access Framework: exactly one grant, one file.
                        runCatching {
                            contentResolver.takePersistableUriPermission(
                                it,
                                android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION,
                            )
                        } // not every provider grants persistable access; picking still works
                        val name = resolveFileName(it)
                        if (name.endsWith(".litertlm", ignoreCase = true)) {
                            loadModelFrom(it, name, scope)
                        } else {
                            emit("heretic-file-picked", name)
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
                                    // PGlite persists its database in IndexedDB.
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
                                        ),
                                        "HereticNative",
                                    )

                                    loadUrl(APP_URL)
                                    webViewRef = this
                                }
                            },
                        )
                    } else {
                        HereticApp(core = core, voice = voice)
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
