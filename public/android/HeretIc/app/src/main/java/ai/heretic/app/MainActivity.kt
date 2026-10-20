package ai.heretic.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import ai.heretic.app.core.HereticCore
import ai.heretic.app.ui.HereticApp
import ai.heretic.app.ui.HereticJsBridge
import ai.heretic.app.ui.HereticTheme
import ai.heretic.app.voice.VoiceManager
import org.json.JSONObject

class MainActivity : ComponentActivity() {

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            HereticTheme {
                val core = remember { HereticCore(applicationContext) }
                val voice = remember { VoiceManager(this) }
                var useWebFrontend by remember { mutableStateOf(true) }
                var webViewRef by remember { mutableStateOf<WebView?>(null) }

                DisposableEffect(Unit) {
                    onDispose { voice.shutdown() }
                }

                fun emit(event: String, payload: String) {
                    webViewRef?.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('$event', { detail: ${JSONObject.quote(payload)} }));",
                        null,
                    )
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
                        contentResolver.takePersistableUriPermission(
                            it,
                            android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION,
                        ).orThrowCatching()
                        emit("heretic-file-picked", resolveFileName(it))
                    }
                }

                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    if (useWebFrontend) {
                        AndroidView(
                            modifier = Modifier.fillMaxSize(),
                            factory = { ctx ->
                                WebView(ctx).apply {
                                    settings.javaScriptEnabled = true
                                    settings.domStorageEnabled = true
                                    settings.allowFileAccess = false
                                    settings.allowContentAccess = false
                                    settings.mediaPlaybackRequiresUserGesture = false

                                    webViewClient = object : WebViewClient() {
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
                                        ),
                                        "HereticNative",
                                    )

                                    loadUrl("file:///android_asset/index.html")
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

    private fun Result<Unit>.orThrowCatching() = onFailure { /* grant not persistable */ }
}
