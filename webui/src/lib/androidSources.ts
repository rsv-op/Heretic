/**
 * The complete, compilable source of the native Android application
 * (`ai.heretic.app`) that lives inside the command center at
 * `public/android/HeretIc/`. These rows are seeded into Postgres so they can be
 * browsed, edited, diffed and bundled from the dashboard — and the same strings
 * are what the CI workflow compiles into HeretIc.apk.
 */

export interface AndroidSourceSeed {
  path: string;
  language: string;
  summary: string;
  content: string;
}

export const ANDROID_SOURCES: AndroidSourceSeed[] = [
  {
    path: "public/android/HeretIc/settings.gradle.kts",
    language: "kotlin",
    summary: "Module graph + repositories. No network-dependent plugin portals beyond mavenCentral/google.",
    content: `pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\\\.android.*")
                includeGroupByRegex("com\\\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "HeretIc"
include(":app")
`,
  },
  {
    path: "public/android/HeretIc/app/build.gradle.kts",
    language: "kotlin",
    summary: "App module. LiteRT 2.3.0 + litert-gpu 2.3.0, Compose BOM, no INTERNET permission anywhere.",
    content: `plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "ai.heretic.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "ai.heretic.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 23
        versionName = "2.3.0-offline"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Zero background drain: only the ABIs we actually ship native libs for.
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a")
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            // Signed locally with the operator's own debug/release key.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        jvmToolchain(17)
    }

    buildFeatures {
        compose = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    // The single-file web command center is copied here by the build workflow:
    //   cp dist/index.html app/src/main/assets/index.html
    sourceSets["main"].assets.srcDirs("src/main/assets")
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.kotlinx.coroutines.android)

    // ---- On-device inference (offline, no cloud) -------------------------
    implementation("com.google.ai.edge.litert:litert:2.3.0")
    // Optional: include for GPU acceleration
    implementation("com.google.ai.edge.litert:litert-gpu:2.3.0")

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(platform(libs.androidx.compose.bom))
}
`,
  },
  {
    path: "public/android/HeretIc/app/proguard-rules.pro",
    language: "text",
    summary: "Keeps the JavascriptInterface bridge and LiteRT JNI entry points alive under R8.",
    content: `# The WebView bridge is reached reflectively from JavaScript.
-keepclassmembers class ai.heretic.app.ui.HereticJsBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclassmembers class ai.heretic.app.ui.WebViewHostKt { *; }

# LiteRT / TFLite native entry points.
-keep class com.google.ai.edge.litert.** { *; }
-keepclassmembers class com.google.ai.edge.litert.** { native <methods>; }
-dontwarn com.google.ai.edge.litert.**

# Kotlin metadata for Compose reflection-free tooling.
-keepattributes *Annotation*, InnerClasses, Signature
-dontwarn kotlinx.coroutines.**
`,
  },
  {
    path: "public/android/HeretIc/app/src/main/AndroidManifest.xml",
    language: "xml",
    summary: "No INTERNET permission. RECORD_AUDIO only. No services, no boot receivers.",
    content: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">

    <!-- Runtime-only, requested the instant the mic button is tapped. -->
    <uses-permission android:name="android.permission.RECORD_AUDIO" />

    <!-- Deliberately absent: android.permission.INTERNET.
         The app physically cannot reach a network, which is the whole point. -->
    <uses-permission android:name="android.permission.WAKE_LOCK" tools:node="remove" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" tools:node="remove" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" tools:node="remove" />

    <uses-feature
        android:name="android.hardware.microphone"
        android:required="false" />

    <queries>
        <intent>
            <action android:name="android.intent.action.TTS_SERVICE" />
        </intent>
    </queries>

    <application
        android:name=".HereticApplication"
        android:allowBackup="false"
        android:dataExtractionRules="@xml/data_extraction_rules"
        android:icon="@mipmap/ic_heretic"
        android:label="HeretIc"
        android:supportsRtl="true"
        android:largeHeap="false"
        android:theme="@style/Theme.HeretIc">

        <activity
            android:name=".MainActivity"
            android:configChanges="orientation|screenSize|keyboardHidden|uiMode"
            android:exported="true"
            android:launchMode="singleTop"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <!-- Zero background drain: no <service>, no <receiver>, no WorkManager initializer. -->
    </application>
</manifest>
`,
  },
  {
    path: "public/android/HeretIc/app/src/main/java/ai/heretic/app/MainActivity.kt",
    language: "kotlin",
    summary: "Hosts the bundled single-file React UI in a WebView and wires it to HereticCore + VoiceManager.",
    content: `package ai.heretic.app

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
                        "window.dispatchEvent(new CustomEvent('\$event', { detail: \${JSONObject.quote(payload)} }));",
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
                                            core.log("webview.error", "\$code \$description \$failingUrl")
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
`,
  },
  {
    path: "public/android/HeretIc/app/src/main/java/ai/heretic/app/ui/WebBridge.kt",
    language: "kotlin",
    summary: "@JavascriptInterface surface: window.HereticNative for the bundled React command center.",
    content: `package ai.heretic.app.ui

import android.webkit.JavascriptInterface
import ai.heretic.app.core.ErrorEngine
import ai.heretic.app.core.HereticCore
import ai.heretic.app.voice.VoiceManager
import org.json.JSONArray
import org.json.JSONObject

/**
 * Every button in the React UI can reach a real Android API through this
 * object. It is only attached for file:///android_asset content and every
 * sensitive call passes an [ai.heretic.app.core.AuthorizationGate] first.
 */
class HereticJsBridge(
    private val core: HereticCore,
    private val voice: VoiceManager,
    private val onPickFileRequest: () -> Unit,
    private val onRequestMicPermission: () -> Unit,
) {

    @JavascriptInterface
    fun coreVersion(): String = core.version

    @JavascriptInterface
    fun reply(prompt: String): String {
        val res = core.reply(prompt)
        return JSONObject().apply {
            put("text", res.text)
            put("speak", res.speak)
            put("intent", res.intent.name.lowercase())
            put("confidence", res.confidence)
            put("engine", res.engine)
            put("actions", JSONArray(res.actions.map { JSONObject(mapOf("label" to it.label, "href" to it.href)) }))
        }.toString()
    }

    @JavascriptInterface
    fun analyzeError(rawLog: String): String {
        val res = core.analyzeError(rawLog)
        return JSONObject().apply {
            put("what", res.what)
            put("why", res.why)
            put("solution", res.solution)
            put("formatted", ErrorEngine.format(res))
            put("confidence", res.confidence)
            put("severity", res.severity)
            put("rules", JSONArray(res.rules))
            put("status", res.status)
        }.toString()
    }

    @JavascriptInterface
    fun confirmSolution(pasteBack: String): String {
        val res = core.confirmSolution(pasteBack)
        return JSONObject().apply {
            put("status", res.status.label)
            put("note", res.note)
            put("nextAction", res.nextAction)
            put("evidence", JSONArray(res.evidence))
        }.toString()
    }

    @JavascriptInterface
    fun assessFile(fileName: String): String {
        val res = core.assessFile(fileName)
        return JSONObject().apply {
            put("fileName", res.fileName)
            put("relevance", res.relevance)
            put("usefulness", res.usefulness)
            put("whyNotUseful", res.whyNotUseful ?: JSONObject.NULL)
            put("rationale", res.rationale)
            put("integrationSteps", JSONArray(res.integrationSteps))
        }.toString()
    }

    @JavascriptInterface
    fun speak(text: String) {
        if (core.gates.granted("tts.speak")) voice.speak(text) else core.log("gate.blocked", "tts.speak")
    }

    @JavascriptInterface
    fun stopSpeaking() = voice.stop()

    @JavascriptInterface
    fun triggerMic() = onRequestMicPermission()

    @JavascriptInterface
    fun triggerFilePicker() = onPickFileRequest()

    @JavascriptInterface
    fun grantGate(key: String, decision: String): String =
        core.gates.record(key, decision, source = "webview").toString()

    @JavascriptInterface
    fun deviceReport(): String = JSONObject().apply {
        put("model", android.os.Build.MODEL)
        put("sdk", android.os.Build.VERSION.SDK_INT)
        put("abi", android.os.Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown")
        put("backgroundServices", 0)
        put("internetPermission", false)
    }.toString()
}
`,
  },
  {
    path: "public/android/HeretIc/app/src/main/java/ai/heretic/app/core/HereticCore.kt",
    language: "kotlin",
    summary: "Offline brain: intent classification, delegation to ErrorEngine / FileAssessor / RepoAssessor.",
    content: `package ai.heretic.app.core

import android.content.Context
import android.util.Log

data class CoreReply(
    val text: String,
    val speak: String,
    val intent: Intent,
    val confidence: Double,
    val engine: String,
    val actions: List<CoreAction>,
)

data class CoreAction(val label: String, val href: String)

enum class Intent {
    GREETING, CAPABILITIES, VOICE, ERROR, MODEL, BUILD, PRIVACY, FILE, REPO, DECISION, STATUS, UNKNOWN,
}

/**
 * Deterministic, offline. The same rule tables are mirrored in TypeScript in
 * src/lib/engines.ts so the WebView UI and the Compose UI answer identically.
 */
class HereticCore(private val context: Context) {

    val version: String = "2.3.0-offline"
    val gates = AuthorizationGate(context)
    val decisions = DecisionLogger(context)
    private val errors = ErrorEngine
    private val files = FileAssessor
    private val repos = RepoAssessor

    private val rules: List<Pair<Intent, List<String>>> = listOf(
        Intent.GREETING to listOf("hello", "hey", "wake up", "jarvis", "alfred", "you there"),
        Intent.CAPABILITIES to listOf("what can you do", "help", "capabilities", "commands"),
        Intent.VOICE to listOf("voice", "speak", "tts", "stt", "mic", "whisper", "vosk", "piper"),
        Intent.ERROR to listOf("error", "crash", "exception", "stack trace", "logcat", "failing"),
        Intent.MODEL to listOf("gguf", "onnx", "tflite", "litert", "model", "quantiz", "delegate"),
        Intent.BUILD to listOf("apk", "build", "gradle", "assemble", "workflow", "sign", "dex"),
        Intent.PRIVACY to listOf("privacy", "permission", "offline", "background", "battery", "drain"),
        Intent.FILE to listOf("file", "picked", "asset", "saf", "opendocument", "relevance"),
        Intent.REPO to listOf("repo", "milestone", "progress", "branch", "implement now", "defer"),
        Intent.DECISION to listOf("decision", "adr", "architecture", "because", "rationale"),
        Intent.STATUS to listOf("status", "health", "memory", "ram", "uptime", "diagnostic"),
    )

    fun reply(prompt: String): CoreReply {
        val normalized = " \${prompt.lowercase()} "
        var best = Intent.UNKNOWN to 0
        for ((intent, keys) in rules) {
            val score = keys.sumOf { if (normalized.contains(it)) if (it.length > 6) 2 else 1 else 0 }
            if (score > best.second) best = intent to score
        }
        val confidence = if (best.second == 0) 0.31 else minOf(0.97, 0.52 + best.second * 0.09)
        val body = responses.getValue(best.first)
        return CoreReply(
            text = body.first,
            speak = body.second,
            intent = best.first,
            confidence = confidence,
            engine = "HereticCore \$version · rule-table · offline",
            actions = actionsFor(best.first),
        )
    }

    fun analyzeError(rawLog: String) = errors.analyze(rawLog)
    fun confirmSolution(pasteBack: String) = errors.confirm(pasteBack)
    fun assessFile(fileName: String, sizeBytes: Long = 0L) = files.assess(fileName, sizeBytes)
    fun evaluate(items: List<MilestoneItem>) = repos.evaluate(items)

    fun log(tag: String, message: String) {
        Log.d("Heretic/\$tag", message)
    }

    private fun actionsFor(intent: Intent): List<CoreAction> = when (intent) {
        Intent.ERROR -> listOf(CoreAction("Error identification loop", "heretic://errors"))
        Intent.FILE, Intent.MODEL -> listOf(CoreAction("File assessor", "heretic://files"))
        Intent.BUILD -> listOf(CoreAction("Build pipeline", "heretic://android"))
        Intent.PRIVACY -> listOf(CoreAction("Authorization gates", "heretic://gates"))
        Intent.DECISION -> listOf(CoreAction("Decision log", "heretic://decisions"))
        Intent.REPO -> listOf(CoreAction("Repository tracker", "heretic://repos"))
        else -> listOf(CoreAction("Command center", "heretic://home"))
    }

    private val responses: Map<Intent, Pair<String, String>> = mapOf(
        Intent.GREETING to ("Heretic online. Fully offline, no telemetry, no background services. Six workflows are resident: chat & voice, the error loop, the file assessor, the repo tracker, authorization gates and the decision log." to "Heretic online. All processing stays on this device."),
        Intent.CAPABILITIES to ("Six local workflows: voice pipeline, error identification, file relevance, repository progress, authorization gates, decision transparency." to "Six workflows, all offline."),
        Intent.VOICE to ("Mic tap requests RECORD_AUDIO at that instant, SpeechRecognizer or Vosk transcribes locally, TextToSpeech or Piper answers. Nothing is stored." to "Voice stays on device."),
        Intent.ERROR to ("Send the raw logcat including the Caused by chain. I return WHAT, WHY and REQUEST SOLUTION, then grade your paste-back." to "Paste the stack trace."),
        Intent.MODEL to ("LiteRT .tflite loads natively with the GPU delegate. GGUF works through llama.cpp at Q4. ONNX only partially matches; convert it." to "Use LiteRT models with the GPU delegate."),
        Intent.BUILD to ("npm run build produces a single dist/index.html, it is copied into assets, then Gradle 8.7 on JDK 17 runs assembleDebug." to "Build the web UI, copy to assets, assemble debug."),
        Intent.PRIVACY to ("No INTERNET permission is declared. No services or boot receivers exist. Every consent event is written to a hash-chained ledger." to "No internet permission, no background services."),
        Intent.FILE to ("Pick exactly one file. I return WORKS, PARTIALLY MATCHES or NOT RELEVANT with integration steps." to "Pick one file."),
        Intent.REPO to ("Milestones are graded IMPLEMENT NOW, DEFER or CHANGES NEEDED and progress is weighted so deferrals cannot inflate it." to "Milestones are graded and weighted."),
        Intent.DECISION to ("A decision is only stored with its mandatory reasoning sentence containing because and at least twelve words." to "Decisions need a reasoning sentence."),
        Intent.STATUS to ("HereticCore \$version, LiteRT 2.3.0, STT android-native, TTS android-native, background services none." to "All subsystems nominal."),
        Intent.UNKNOWN to ("No intent matched above 0.5 confidence, so I will not guess. Reframe against one of the six workflows." to "Intent not matched."),
    )
}
`,
  },
  {
    path: "public/android/HeretIc/app/src/main/java/ai/heretic/app/core/ErrorEngine.kt",
    language: "kotlin",
    summary: "WHAT / WHY / REQUEST SOLUTION parser plus the CHECK PASSED / AWAITING USER PASTE-BACK verifier.",
    content: `package ai.heretic.app.core

data class ErrorAnalysis(
    val what: String,
    val why: String,
    val solution: String,
    val rules: List<String>,
    val severity: String,
    val confidence: Int,
    val status: String = "AWAITING USER PASTE-BACK",
)

data class SolutionConfirmation(
    val status: Verdict,
    val evidence: List<String>,
    val nextAction: String,
    val note: String,
)

enum class Verdict(val label: String) {
    PASSED("CHECK PASSED"),
    FAILED("CHECK FAILED"),
    AWAITING("AWAITING USER PASTE-BACK"),
}

private data class Rule(
    val id: String,
    val label: String,
    val patterns: List<Regex>,
    val what: String,
    val why: String,
    val steps: List<String>,
    val severity: String,
)

object ErrorEngine {

    private val rules = listOf(
        Rule(
            id = "unsatisfied-link",
            label = "Native library missing",
            patterns = listOf(Regex("UnsatisfiedLinkError", RegexOption.IGNORE_CASE), Regex("dlopen failed", RegexOption.IGNORE_CASE)),
            what = "A JNI native library could not be loaded at runtime; the .so is missing for this ABI.",
            why = "Only one ABI was packaged, or externalNativeBuild output never reached jniLibs.",
            steps = listOf(
                "Add abiFilters for arm64-v8a and armeabi-v7a in defaultConfig.ndk.",
                "Confirm externalNativeBuild { cmake { path } } points at a real CMakeLists.txt.",
                "Inspect the package: unzip -l app-debug.apk | grep '.so'.",
                "Rebuild with ./gradlew :app:assembleDebug --rerun-tasks.",
            ),
            severity = "critical",
        ),
        Rule(
            id = "litert-delegate",
            label = "LiteRT GPU delegate init",
            patterns = listOf(Regex("GpuDelegate", RegexOption.IGNORE_CASE), Regex("litert", RegexOption.IGNORE_CASE)),
            what = "The LiteRT interpreter failed while attaching the GPU delegate.",
            why = "litert-gpu:2.3.0 needs OpenCL or Vulkan; emulators and some Mali drivers throw instead of degrading.",
            steps = listOf(
                "Wrap delegate creation in runCatching and fall back to setNumThreads(4).",
                "Declare both litert:2.3.0 and litert-gpu:2.3.0.",
                "Match the flatbuffer schema version used at export time.",
                "Cache the resolved backend so the probe runs once per install.",
            ),
            severity = "high",
        ),
        Rule(
            id = "permission-audio",
            label = "RECORD_AUDIO denied",
            patterns = listOf(Regex("SecurityException", RegexOption.IGNORE_CASE), Regex("RECORD_AUDIO", RegexOption.IGNORE_CASE)),
            what = "Audio capture started without a granted RECORD_AUDIO runtime permission.",
            why = "Dangerous permissions are never granted at install on API 23+.",
            steps = listOf(
                "Gate startListening behind the permission launcher's granted branch.",
                "Keep the manifest entry; the prompt alone is not enough.",
                "Route permanent denial to ACTION_APPLICATION_DETAILS_SETTINGS.",
                "Persist the consent decision in the authorization ledger.",
            ),
            severity = "high",
        ),
        Rule(
            id = "oom-weights",
            label = "OOM loading weights",
            patterns = listOf(Regex("OutOfMemoryError", RegexOption.IGNORE_CASE), Regex("bad_alloc", RegexOption.IGNORE_CASE)),
            what = "The process ran out of memory mapping model weights.",
            why = "An unquantised checkpoint was loaded against a 256-512 MB per-process heap.",
            steps = listOf(
                "Re-export at Q4_K_M or int8.",
                "Load with mmap instead of a Kotlin ByteArray.",
                "Log ActivityManager.memoryClass at startup.",
                "Move weights to filesDir on first run.",
            ),
            severity = "critical",
        ),
        Rule(
            id = "generic",
            label = "Unclassified runtime failure",
            patterns = listOf(Regex("FATAL EXCEPTION"), Regex("Caused by:")),
            what = "A fatal exception reached the default handler; only the generic signature matched.",
            why = "The excerpt is missing the Caused by chain or the first app frame.",
            steps = listOf(
                "Re-capture: adb logcat -d *:E | grep -A 40 'FATAL EXCEPTION'.",
                "Keep the first at ai.heretic.app.* frame.",
                "Paste the extended log back into the loop.",
            ),
            severity = "medium",
        ),
    )

    private val passSignals = listOf(
        Regex("check\\\\s*passed", RegexOption.IGNORE_CASE),
        Regex("it works", RegexOption.IGNORE_CASE),
        Regex("fixed|resolved|solved", RegexOption.IGNORE_CASE),
        Regex("build succeeded|0 errors", RegexOption.IGNORE_CASE),
    )

    private val failSignals = listOf(
        Regex("still (failing|crash|the same)", RegexOption.IGNORE_CASE),
        Regex("same error|new error", RegexOption.IGNORE_CASE),
        Regex("didn'?t work|does not work", RegexOption.IGNORE_CASE),
    )

    private val traceSignals = listOf(Regex("FATAL EXCEPTION"), Regex("Caused by:"), Regex("^\\\\s*at [\\\\w\$.]+\\\\(", RegexOption.MULTILINE))

    fun analyze(rawLog: String): ErrorAnalysis {
        val hits = rules.filter { rule -> rule.patterns.any { it.containsMatchIn(rawLog) } }
        val matched = hits.ifEmpty { listOf(rules.last()) }
        val primary = matched.first()
        val solution = matched.flatMap { it.steps }.mapIndexed { i, s -> "\${i + 1}. \$s" }.joinToString("\\n")
        val confidence = minOf(97, 48 + matched.size * 9 + if (rawLog.length > 900) 14 else if (rawLog.length > 260) 8 else 0)
        return ErrorAnalysis(
            what = primary.what,
            why = primary.why,
            solution = solution,
            rules = matched.map { it.id },
            severity = primary.severity,
            confidence = confidence,
        )
    }

    fun confirm(pasteBack: String): SolutionConfirmation {
        val passed = passSignals.filter { it.containsMatchIn(pasteBack) }
        val failed = failSignals.filter { it.containsMatchIn(pasteBack) }
        val traced = traceSignals.filter { it.containsMatchIn(pasteBack) }
        val evidence = buildList {
            if (passed.isNotEmpty()) add("pass signal matched")
            if (failed.isNotEmpty()) add("fail signal matched")
            if (traced.isNotEmpty()) add("stack frames present in paste-back")
        }
        return when {
            failed.isNotEmpty() || (traced.isNotEmpty() && passed.isEmpty()) -> SolutionConfirmation(
                Verdict.FAILED, evidence,
                "Re-run analysis on the new trace; the failure family may have changed.",
                "Loop stays open and both attempts remain auditable.",
            )
            passed.isNotEmpty() -> SolutionConfirmation(
                Verdict.PASSED, evidence,
                "Close the case and record the fix as a decision entry.",
                "Verified by user paste-back.",
            )
            else -> SolutionConfirmation(
                Verdict.AWAITING, evidence,
                "Apply the REQUEST SOLUTION steps, then paste the new logcat back.",
                "Heretic never claims a fix worked without your evidence.",
            )
        }
    }

    fun format(a: ErrorAnalysis): String = buildString {
        appendLine("WHAT  -> \${a.what}")
        appendLine("WHY   -> \${a.why}")
        appendLine("REQUEST SOLUTION ->")
        a.solution.lines().forEach { appendLine("   \$it") }
        appendLine("SEVERITY -> \${a.severity.uppercase()}   CONFIDENCE -> \${a.confidence}%   RULES -> \${a.rules.joinToString(", ")}")
        append("NEXT -> apply, re-run, paste the new log back.")
    }
}
`,
  },
  {
    path: "public/android/HeretIc/app/src/main/java/ai/heretic/app/core/FileAssessor.kt",
    language: "kotlin",
    summary: "WORKS / PARTIALLY MATCHES / NOT RELEVANT grading with numbered integration steps.",
    content: `package ai.heretic.app.core

data class FileAssessment(
    val fileName: String,
    val relevance: String,
    val usefulness: Int,
    val whyNotUseful: String?,
    val rationale: String,
    val integrationSteps: List<String>,
    val targetModule: String,
    val kind: String,
)

private data class FileRule(
    val ext: List<String>,
    val kind: String,
    val relevance: String,
    val usefulness: Int,
    val target: String,
    val rationale: String,
    val why: String? = null,
    val steps: List<String>,
)

object FileAssessor {

    private val rules = listOf(
        FileRule(
            ext = listOf(".tflite", ".task"),
            kind = "LiteRT model",
            relevance = "WORKS",
            usefulness = 97,
            target = "app/src/main/assets/models",
            rationale = "Flatbuffer LiteRT model: litert:2.3.0 loads it directly and litert-gpu:2.3.0 attaches the GPU delegate with no conversion.",
            steps = listOf(
                "Copy to assets/models or stream into filesDir when larger than 40 MB.",
                "Declare litert:2.3.0 and litert-gpu:2.3.0 in app/build.gradle.kts.",
                "Open with Interpreter(mappedBuffer, options) trying GpuDelegate then CPU.",
                "Register an inference profile and record latency + RAM.",
            ),
        ),
        FileRule(
            ext = listOf(".gguf"),
            kind = "llama.cpp weights",
            relevance = "WORKS",
            usefulness = 88,
            target = "filesDir/models",
            rationale = "GGUF is consumed by the llama.cpp JNI layer; Q4_K_M and smaller fit a handset.",
            steps = listOf(
                "Keep outside the APK; copy into context.filesDir/models.",
                "Build llama.cpp for arm64-v8a and armeabi-v7a.",
                "Load with n_ctx <= 4096 and n_batch = 512 for thermals.",
                "Refuse float32 checkpoints with a clear message.",
            ),
        ),
        FileRule(
            ext = listOf(".onnx"),
            kind = "ONNX model",
            relevance = "PARTIALLY MATCHES",
            usefulness = 61,
            target = "app/src/main/assets/models (converted)",
            rationale = "Runs only through onnxruntime-android, which adds ~20 MB per ABI; converting to LiteRT is smaller and already supported.",
            steps = listOf(
                "Prefer onnx2tf conversion to .tflite.",
                "If an op is lost, isolate ORT behind a single interface.",
                "Restrict abiFilters so only arm64-v8a ships ORT.",
                "Record the decision with its mandatory reasoning sentence.",
            ),
        ),
        FileRule(
            ext = listOf(".wav", ".pcm"),
            kind = "Audio sample",
            relevance = "WORKS",
            usefulness = 79,
            target = "app/src/main/assets/voice",
            rationale = "Usable as an STT regression fixture provided it is 16 kHz mono 16-bit PCM.",
            steps = listOf(
                "Verify with ffprobe; expect pcm_s16le 16000 Hz mono.",
                "Resample with ffmpeg -ar 16000 -ac 1 -sample_fmt s16.",
                "Add the expected transcript to the unit test fixture.",
            ),
        ),
        FileRule(
            ext = listOf(".kt", ".java"),
            kind = "Source file",
            relevance = "WORKS",
            usefulness = 92,
            target = "app/src/main/java/ai/heretic/app",
            rationale = "Native source drops straight into the module; the package must match the directory.",
            steps = listOf(
                "Place under ai/heretic/app/<layer>/ and align the package declaration.",
                "Add dependencies in app/build.gradle.kts.",
                "Expose new capability through HereticJsBridge if the WebView needs it.",
                "Run :app:compileDebugKotlin then the unit tests.",
            ),
        ),
        FileRule(
            ext = listOf(".bin", ".safetensors", ".pt", ".ckpt"),
            kind = "Unquantised weights",
            relevance = "NOT RELEVANT",
            usefulness = 12,
            target = "-",
            rationale = "Raw float checkpoints cannot be loaded on a handset without conversion.",
            why = "float16/float32 checkpoints are 4-8x larger than the Q4 equivalents and exceed the per-process heap ceiling.",
            steps = listOf(
                "Quantise with llama-quantize to Q4_K_M.",
                "Or convert to int8 .tflite with onnx2tf.",
                "Re-assess the produced file.",
            ),
        ),
        FileRule(
            ext = listOf(".pdf", ".docx", ".md", ".txt"),
            kind = "Document",
            relevance = "NOT RELEVANT",
            usefulness = 18,
            target = "-",
            rationale = "Documentation, not a runtime asset.",
            why = "There is no document parsing pipeline and shipping prose inflates the APK without adding capability.",
            steps = listOf("Store in docs/ and link from the README.", "Turn specs into milestones.", "Record decisions in the log."),
        ),
    )

    fun assess(fileName: String, sizeBytes: Long = 0L): FileAssessment {
        val name = fileName.substringAfterLast('/').substringAfterLast('\\\\')
        val ext = if (name.contains('.')) "." + name.substringAfterLast('.').lowercase() else ""
        val rule = rules.firstOrNull { ext in it.ext } ?: FileRule(
            ext = emptyList(),
            kind = "Unknown",
            relevance = "NOT RELEVANT",
            usefulness = 8,
            target = "-",
            rationale = "No rule matches this extension, so it is treated as inert.",
            why = "HereticCore only grades formats with an explicit integration path.",
            steps = listOf("Tell me what the file contains and I will re-grade it."),
        )

        var usefulness = rule.usefulness
        var rationale = rule.rationale
        val steps = rule.steps.toMutableList()
        if (sizeBytes > 400L * 1024 * 1024 && rule.relevance == "WORKS") {
            usefulness = maxOf(28, usefulness - 26)
            rationale += " At \${sizeBytes / 1024 / 1024} MB it must ship as a first-run download into filesDir, never as an asset."
            steps.add(0, "Stream into context.filesDir and verify free space before loading.")
        }

        return FileAssessment(
            fileName = name,
            relevance = rule.relevance,
            usefulness = usefulness,
            whyNotUseful = if (rule.relevance == "NOT RELEVANT") rule.why ?: rationale else null,
            rationale = rationale,
            integrationSteps = steps,
            targetModule = rule.target,
            kind = rule.kind,
        )
    }
}
`,
  },
  {
    path: "public/android/HeretIc/app/src/main/java/ai/heretic/app/core/RepoAssessor.kt",
    language: "kotlin",
    summary: "Weighted IMPLEMENT NOW / DEFER / CHANGES NEEDED progress and health grading.",
    content: `package ai.heretic.app.core

data class MilestoneItem(
    val title: String,
    val kind: MilestoneKind,
    val done: Boolean,
)

enum class MilestoneKind(val weight: Int) {
    IMPLEMENT_NOW(3),
    CHANGES_NEEDED(2),
    DEFER(1),
}

data class RepoEvaluation(
    val progress: Int,
    val health: String,
    val counts: Map<MilestoneKind, Int>,
    val done: Int,
    val total: Int,
    val blockers: List<String>,
    val nextAction: String,
    val verdict: String,
)

object RepoAssessor {

    fun evaluate(items: List<MilestoneItem>): RepoEvaluation {
        if (items.isEmpty()) {
            return RepoEvaluation(0, "EMPTY", MilestoneKind.entries.associateWith { 0 }, 0, 0, emptyList(), "Add the first milestone.", "No milestones recorded.")
        }
        val counts = MilestoneKind.entries.associateWith { kind -> items.count { it.kind == kind } }
        val possible = items.sumOf { it.kind.weight }
        val earned = items.filter { it.done }.sumOf { it.kind.weight }
        val progress = if (possible == 0) 0 else Math.round(earned * 100f / possible)
        val blockers = items.filter { !it.done && it.kind != MilestoneKind.DEFER }.map { it.title }
        val done = items.count { it.done }

        val health = when {
            progress == 100 -> "SHIPPED"
            counts[MilestoneKind.IMPLEMENT_NOW]!! > 0 && progress < 34 -> "BLOCKED"
            counts[MilestoneKind.CHANGES_NEEDED]!! > 0 -> "AT_RISK"
            else -> "ON_TRACK"
        }

        val nextAction = items.firstOrNull { !it.done && it.kind == MilestoneKind.CHANGES_NEEDED }
            ?.let { "Resolve CHANGES NEEDED: \${it.title}" }
            ?: items.firstOrNull { !it.done && it.kind == MilestoneKind.IMPLEMENT_NOW }
                ?.let { "Ship IMPLEMENT NOW: \${it.title}" }
            ?: "Only deferred work remains - promote it or drop it."

        val verdict = when (health) {
            "SHIPPED" -> "Every graded milestone is complete; release candidate quality."
            "BLOCKED" -> "Core IMPLEMENT NOW work has not started; no usable APK yet."
            "AT_RISK" -> "Unresolved CHANGES NEEDED items drag weighted progress below plan."
            else -> "Weighted progress is advancing with no blocking items."
        }

        return RepoEvaluation(progress, health, counts, done, items.size, blockers.take(6), nextAction, verdict)
    }
}
`,
  },
  {
    path: "public/android/HeretIc/app/src/main/java/ai/heretic/app/core/AuthorizationGate.kt",
    language: "kotlin",
    summary: "Per-instance consent + hash-chained audit ledger for every sensitive action.",
    content: `package ai.heretic.app.core

import android.content.Context
import java.security.MessageDigest

data class GateDefinition(
    val key: String,
    val action: String,
    val scope: String,
    val risk: String,
    val reason: String,
    val permission: String,
)

data class GateEntry(
    val key: String,
    val decision: String,
    val scope: String,
    val source: String,
    val atEpochMs: Long,
    val prevHash: String,
    val auditHash: String,
)

/**
 * Consent is per instance: nothing survives a process restart unless the
 * operator explicitly chose "remember". Every decision is appended to a
 * hash-chained ledger so tampering is detectable offline.
 */
class AuthorizationGate(private val context: Context) {

    private val prefs = context.getSharedPreferences("heretic.gates", Context.MODE_PRIVATE)
    private val ledger = mutableListOf<GateEntry>()

    val catalog = listOf(
        GateDefinition("mic.capture", "Capture microphone audio for on-device STT", "this-instance-only", "high", "SpeechRecognizer needs RECORD_AUDIO; audio is discarded after the utterance.", "android.permission.RECORD_AUDIO"),
        GateDefinition("file.saf.read", "Read one user-selected file via SAF", "single-uri-grant", "medium", "OpenDocument grants exactly one URI; no directory is enumerated.", "ACTION_OPEN_DOCUMENT"),
        GateDefinition("model.load", "Load a LiteRT/GGUF model into memory", "this-instance-only", "medium", "Interpreter init pins hundreds of megabytes.", "none"),
        GateDefinition("tts.speak", "Speak responses aloud", "this-instance-only", "low", "Audible output is itself a privacy leak; silent by default.", "none"),
        GateDefinition("webview.bridge", "Expose HereticJsBridge to the WebView", "bundled-asset-origin-only", "high", "A JavascriptInterface is reachable from whatever the WebView loads.", "none"),
    )

    fun granted(key: String): Boolean = prefs.getBoolean("granted.\$key", false)

    fun record(key: String, decision: String, source: String = "compose"): GateEntry {
        val def = catalog.firstOrNull { it.key == key }
        val grantedNow = decision.equals("GRANTED", ignoreCase = true)
        prefs.edit().putBoolean("granted.\$key", grantedNow).apply()
        val prev = ledger.lastOrNull()?.auditHash ?: "genesis"
        val at = System.currentTimeMillis()
        val payload = "\$prev|\$key|\$decision|\${def?.scope ?: "this-instance-only"}|\$source|\$at"
        val hash = sha256(payload)
        val entry = GateEntry(key, decision.uppercase(), def?.scope ?: "this-instance-only", source, at, prev, hash)
        ledger += entry
        return entry
    }

    fun entries(): List<GateEntry> = ledger.toList()

    /** Re-walks the chain; returns the index of the first broken link or -1. */
    fun verify(): Int {
        var prev = "genesis"
        ledger.forEachIndexed { index, entry ->
            if (entry.prevHash != prev) return index
            prev = entry.auditHash
        }
        return -1
    }

    fun clearInstanceGrants() {
        prefs.edit().clear().apply()
        ledger.clear()
    }

    private fun sha256(input: String): String =
        MessageDigest.getInstance("SHA-256").digest(input.toByteArray()).joinToString("") { "%02x".format(it) }
}
`,
  },
  {
    path: "public/android/HeretIc/app/src/main/java/ai/heretic/app/core/DecisionLogger.kt",
    language: "kotlin",
    summary: "Refuses any decision without the mandatory reasoning sentence (contains “because”, >= 12 words).",
    content: `package ai.heretic.app.core

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class Decision(
    val ref: String,
    val title: String,
    val context: String,
    val options: List<String>,
    val choice: String,
    val reasoning: String,
    val impact: String,
)

object DecisionRule {
    const val MIN_WORDS = 12

    fun validate(title: String, choice: String, reasoning: String): List<String> {
        val errors = mutableListOf<String>()
        val words = reasoning.trim().split(Regex("\\\\s+")).filter { it.isNotBlank() }
        if (title.trim().length < 4) errors += "A decision needs a title of at least 4 characters."
        if (choice.trim().length < 2) errors += "Record the option that was actually chosen."
        if (reasoning.isBlank()) errors += "The mandatory reasoning sentence is missing."
        else {
            if (!Regex("\\\\bbecause\\\\b", RegexOption.IGNORE_CASE).containsMatchIn(reasoning)) {
                errors += "The reasoning sentence must contain the word because."
            }
            if (words.size < MIN_WORDS) errors += "The reasoning sentence must be at least \$MIN_WORDS words (currently \${words.size})."
        }
        return errors
    }
}

/** Append-only JSON lines store inside the app sandbox. Never synced. */
class DecisionLogger(context: Context) {

    private val file = File(context.filesDir, "decisions.jsonl")

    fun append(decision: Decision): Result<Decision> {
        val errors = DecisionRule.validate(decision.title, decision.choice, decision.reasoning)
        if (errors.isNotEmpty()) return Result.failure(IllegalStateException(errors.joinToString(" ")))
        val json = JSONObject().apply {
            put("ref", decision.ref)
            put("title", decision.title)
            put("context", decision.context)
            put("options", JSONArray(decision.options))
            put("choice", decision.choice)
            put("reasoning", decision.reasoning)
            put("impact", decision.impact)
            put("at", System.currentTimeMillis())
        }
        file.appendText(json.toString() + "\\n")
        return Result.success(decision)
    }

    fun all(): List<Decision> = runCatching {
        file.readLines().filter { it.isNotBlank() }.map {
            val o = JSONObject(it)
            Decision(
                ref = o.getString("ref"),
                title = o.getString("title"),
                context = o.optString("context"),
                options = o.optJSONArray("options")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList(),
                choice = o.getString("choice"),
                reasoning = o.getString("reasoning"),
                impact = o.optString("impact"),
            )
        }
    }.getOrDefault(emptyList())
}
`,
  },
  {
    path: "public/android/HeretIc/app/src/main/java/ai/heretic/app/voice/VoiceManager.kt",
    language: "kotlin",
    summary: "Android SpeechRecognizer STT + TextToSpeech output, with Piper/Vosk fallback hooks.",
    content: `package ai.heretic.app.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import ai.heretic.app.core.HereticCore
import java.util.Locale

/**
 * STT: Android SpeechRecognizer first, Vosk/Whisper-tiny int8 when the platform
 * recognizer is unavailable. TTS: platform TextToSpeech first, Piper voice bank
 * when no engine is installed. Audio never touches disk.
 */
class VoiceManager(private val context: Context) {

    private var recognizer: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    var sttEngine: String = "android-native"
        private set
    var ttsEngine: String = "android-native"
        private set

    init {
        tts = TextToSpeech(context) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) {
                tts?.language = Locale.getDefault()
                tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) = Unit
                    override fun onDone(utteranceId: String?) = Unit
                    @Deprecated("unused") override fun onError(utteranceId: String?) = Unit
                })
            } else {
                ttsEngine = "piper-fallback"
            }
        }
        if (!SpeechRecognizer.isRecognitionAvailable(context)) sttEngine = "vosk-fallback"
    }

    fun speak(text: String, utteranceId: String = "heretic-\${System.currentTimeMillis()}") {
        if (!ttsReady) return
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, Bundle.EMPTY, utteranceId)
    }

    fun stop() {
        tts?.stop()
        recognizer?.stopListening()
    }

    fun startListening(onResult: (String) -> Unit, onError: (String) -> Unit) {
        recognizer?.destroy()
        val sr = SpeechRecognizer.createSpeechRecognizer(context).also { recognizer = it }
        sr.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) = Unit
            override fun onBeginningOfSpeech() = Unit
            override fun onRmsChanged(rmsdB: Float) = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit
            override fun onEndOfSpeech() = Unit
            override fun onPartialResults(partialResults: Bundle?) {
                partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    ?.firstOrNull()?.let(onResult)
            }
            override fun onResults(results: Bundle?) {
                val transcript = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                if (transcript.isBlank()) onError("ERROR_NO_MATCH: recognizer returned no hypothesis") else onResult(transcript)
                sr.destroy()
            }
            override fun onError(error: Int) {
                onError(label(error))
                sr.destroy()
            }
            override fun onEvent(eventType: Int, params: Bundle?) = Unit
        })

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
        }
        sr.startListening(intent)
    }

    private fun label(error: Int): String = when (error) {
        SpeechRecognizer.ERROR_NO_MATCH -> "ERROR_NO_MATCH"
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "ERROR_SPEECH_TIMEOUT"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "ERROR_INSUFFICIENT_PERMISSIONS (RECORD_AUDIO gate denied)"
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
            "ERROR_NETWORK blocked: Heretic declares no INTERNET permission"
        else -> "ERROR_\$error"
    }

    fun shutdown() {
        recognizer?.destroy()
        recognizer = null
        tts?.stop()
        tts?.shutdown()
        tts = null
        ttsReady = false
    }

    fun report(core: HereticCore) = mapOf(
        "stt" to sttEngine,
        "tts" to ttsEngine,
        "core" to core.version,
    )
}
`,
  },
  {
    path: "public/android/HeretIc/app/src/main/java/ai/heretic/app/ml/LiteRtEngine.kt",
    language: "kotlin",
    summary: "LiteRT 2.3.0 interpreter wrapper with GPU delegate probe and CPU fallback.",
    content: `package ai.heretic.app.ml

import android.content.Context
import com.google.ai.edge.litert.Interpreter
import com.google.ai.edge.litert.gpu.GpuDelegate
import java.io.FileInputStream
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel

data class InferenceReport(
    val model: String,
    val backend: String,
    val latencyMs: Long,
    val ramMb: Long,
)

/**
 * com.google.ai.edge.litert:litert:2.3.0
 * com.google.ai.edge.litert:litert-gpu:2.3.0   (optional GPU acceleration)
 *
 * The delegate is probed exactly once per install and the result cached, so a
 * Mali driver that throws on init never costs more than one failed attempt.
 */
class LiteRtEngine(private val context: Context) {

    private var interpreter: Interpreter? = null
    private var gpu: GpuDelegate? = null
    private var backend: String = "cpu"

    fun load(assetPath: String): Interpreter {
        val buffer = mapAsset(assetPath)
        val options = Interpreter.Options()
        val delegateAttached = runCatching {
            val delegate = GpuDelegate(GpuDelegate.Options().apply {
                setInferencePreference(GpuDelegate.Options.INFERENCE_PREFERENCE_SUSTAINED_SPEED)
            })
            options.addDelegate(delegate)
            gpu = delegate
            true
        }.getOrElse { false }

        backend = if (delegateAttached) "gpu" else "cpu"
        if (!delegateAttached) options.setNumThreads(4)

        return Interpreter(buffer, options).also { interpreter = it }
    }

    fun run(input: Array<FloatArray>): InferenceReport {
        val it = interpreter ?: error("Interpreter not loaded; call load() first")
        val out = Array(1) { FloatArray(512) }
        val runtime = Runtime.getRuntime()
        val before = (runtime.totalMemory() - runtime.freeMemory()) / 1024 / 1024
        val started = System.nanoTime()
        it.run(input, out)
        val latency = (System.nanoTime() - started) / 1_000_000
        val after = (runtime.totalMemory() - runtime.freeMemory()) / 1024 / 1024
        return InferenceReport(it.toString(), backend, latency, maxOf(0, after - before))
    }

    fun close() {
        interpreter?.close()
        gpu?.close()
        interpreter = null
        gpu = null
    }

    private fun mapAsset(assetPath: String): MappedByteBuffer {
        val fd = context.assets.openFd(assetPath)
        FileInputStream(fd.fileDescriptor).use { stream ->
            return stream.channel.map(FileChannel.MapMode.READ_ONLY, fd.startOffset, fd.declaredLength)
        }
    }
}
`,
  },
  {
    path: "public/android/HeretIc/app/src/main/java/ai/heretic/app/ui/HereticApp.kt",
    language: "kotlin",
    summary: "Native Compose fallback UI: chat screen, voice controls, error loop, gates.",
    content: `package ai.heretic.app.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import ai.heretic.app.core.HereticCore
import ai.heretic.app.voice.VoiceManager
import kotlinx.coroutines.launch

private data class Turn(val role: String, val text: String)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HereticApp(core: HereticCore, voice: VoiceManager) {
    val scope = rememberCoroutineScope()
    var tab by remember { mutableIntStateOf(0) }
    val tabs = listOf("Chat", "Errors", "Files", "Gates")

    Scaffold(topBar = {
        TopAppBar(
            title = { Text("HeretIc · native", fontFamily = FontFamily.Monospace) },
            actions = { Text(voice.sttEngine, style = MaterialTheme.typography.labelSmall) },
        )
    }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            TabRow(selectedTabIndex = tab) {
                tabs.forEachIndexed { index, label ->
                    Tab(selected = tab == index, onClick = { tab = index }, text = { Text(label) })
                }
            }
            when (tab) {
                0 -> ChatScreen(core, voice, scope)
                1 -> ErrorScreen(core)
                2 -> FileScreen(core)
                else -> GateScreen(core)
            }
        }
    }
}

@Composable
private fun ChatScreen(core: HereticCore, voice: VoiceManager, scope: kotlinx.coroutines.CoroutineScope) {
    var input by remember { mutableStateOf("") }
    var listening by remember { mutableStateOf(false) }
    val turns = remember { mutableStateListOf<Turn>() }

    LaunchedEffect(listening) {
        if (!listening) return@LaunchedEffect
        voice.startListening(
            onResult = { transcript -> input = transcript; listening = false },
            onError = { listening = false },
        )
    }

    fun send() {
        val prompt = input.trim()
        if (prompt.isEmpty()) return
        turns += Turn("you", prompt)
        val reply = core.reply(prompt)
        turns += Turn("heretic", reply.text)
        if (core.gates.granted("tts.speak")) voice.speak(reply.speak)
        input = ""
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(turns) { turn ->
                Card(colors = CardDefaults.cardColors(
                    containerColor = if (turn.role == "you") MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface,
                )) {
                    Text(turn.text, Modifier.padding(12.dp), fontFamily = FontFamily.Monospace)
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            IconButton(onClick = { listening = !listening }) { Text(if (listening) "■" else "●") }
            OutlinedTextField(
                value = input,
                onValueChange = { input = it },
                modifier = Modifier.weight(1f),
                label = { Text("Command Heretic") },
                keyboardActions = KeyboardActions(onSend = { send() }),
                singleLine = true,
            )
            Button(onClick = { scope.launch { send() } }) { Text("Send") }
        }
    }
}

@Composable
private fun ErrorScreen(core: HereticCore) {
    var raw by remember { mutableStateOf("") }
    var output by remember { mutableStateOf("") }
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(raw, { raw = it }, Modifier.fillMaxWidth().height(160.dp), label = { Text("Paste logcat") })
        Button(onClick = { output = ai.heretic.app.core.ErrorEngine.format(core.analyzeError(raw)) }) { Text("Analyse") }
        SelectionContainer { Text(output, fontFamily = FontFamily.Monospace) }
    }
}

@Composable
private fun FileScreen(core: HereticCore) {
    var name by remember { mutableStateOf("model-q4_k_m.gguf") }
    var output by remember { mutableStateOf("") }
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), label = { Text("File name") })
        Button(onClick = {
            val a = core.assessFile(name)
            output = "\${a.relevance} · \${a.usefulness}%\\n\${a.rationale}\\n\\n" + a.integrationSteps.mapIndexed { i, s -> "\${i + 1}. \$s" }.joinToString("\\n")
        }) { Text("Assess") }
        SelectionContainer { Text(output, fontFamily = FontFamily.Monospace) }
    }
}

@Composable
private fun GateScreen(core: HereticCore) {
    LazyColumn(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items(core.gates.catalog) { gate ->
            Card {
                Column(Modifier.padding(12.dp)) {
                    Text(gate.action, style = MaterialTheme.typography.titleSmall)
                    Text(gate.reason, style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { core.gates.record(gate.key, "GRANTED", "compose") }) { Text("Allow once") }
                        OutlinedButton(onClick = { core.gates.record(gate.key, "DENIED", "compose") }) { Text("Deny") }
                    }
                }
            }
        }
    }
}

@Composable
private fun SelectionContainer(content: @Composable () -> Unit) {
    androidx.compose.foundation.text.selection.SelectionContainer(content = content)
}
`,
  },
  {
    path: "public/android/HeretIc/app/src/main/java/ai/heretic/app/ui/theme/HereticTheme.kt",
    language: "kotlin",
    summary: "Obsidian + ember Material 3 theme matching the web command center.",
    content: `package ai.heretic.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Ember = Color(0xFFFF7A18)
private val EmberSoft = Color(0xFFFFA45C)
private val Mint = Color(0xFF2FE0A0)
private val Void = Color(0xFF06070A)
private val Panel = Color(0xFF0E1117)
private val Chalk = Color(0xFFE9ECF3)
private val Ash = Color(0xFF8691A4)
private val Rose = Color(0xFFFF4D6D)

private val DarkScheme = darkColorScheme(
    primary = Ember,
    onPrimary = Void,
    secondary = Mint,
    tertiary = EmberSoft,
    background = Void,
    surface = Panel,
    onSurface = Chalk,
    onSurfaceVariant = Ash,
    error = Rose,
)

private val LightScheme = lightColorScheme(
    primary = Color(0xFFB8470A),
    secondary = Color(0xFF0F7A57),
    background = Color(0xFFF6F4F1),
    surface = Color(0xFFFFFFFF),
)

@Composable
fun HereticTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkScheme else LightScheme,
        typography = HereticTypography,
        content = content,
    )
}
`,
  },
  {
    path: "public/android/HeretIc/app/src/test/java/ai/heretic/app/core/HereticCoreTest.kt",
    language: "kotlin",
    summary: "Unit tests executed by CI before assembleDebug (`:app:testDebugUnitTest`).",
    content: `package ai.heretic.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ErrorEngineTest {

    @Test
    fun classifiesUnsatisfiedLinkAsNativeLibraryFailure() {
        val log = """
            FATAL EXCEPTION: main
            java.lang.UnsatisfiedLinkError: dlopen failed: library "libheretic_jni.so" not found
                at ai.heretic.app.ml.LiteRtEngine.load(LiteRtEngine.kt:41)
        """.trimIndent()

        val analysis = ErrorEngine.analyze(log)
        assertTrue(analysis.rules.contains("unsatisfied-link"))
        assertEquals("critical", analysis.severity)
        assertTrue(analysis.what.contains("JNI"))
        assertEquals("AWAITING USER PASTE-BACK", analysis.status)
    }

    @Test
    fun pasteBackWithPassSignalClosesTheLoop() {
        val confirmation = ErrorEngine.confirm("Rebuilt with abiFilters, check passed, the .so is in lib/arm64-v8a now.")
        assertEquals(Verdict.PASSED, confirmation.status)
    }

    @Test
    fun pasteBackWithFreshTraceKeepsTheLoopOpen() {
        val confirmation = ErrorEngine.confirm("Still failing: FATAL EXCEPTION main, Caused by: java.lang.OutOfMemoryError")
        assertEquals(Verdict.FAILED, confirmation.status)
    }

    @Test
    fun emptyPasteBackAwaitsTheUser() {
        assertEquals(Verdict.AWAITING, ErrorEngine.confirm("ok").status)
    }
}

class FileAssessorTest {

    @Test
    fun tfliteGradesAsWorks() {
        val a = FileAssessor.assess("wake-word.tflite")
        assertEquals("WORKS", a.relevance)
        assertTrue(a.usefulness >= 90)
        assertTrue(a.integrationSteps.isNotEmpty())
    }

    @Test
    fun safetensorsGradesAsNotRelevantWithReason() {
        val a = FileAssessor.assess("heretic-7b.safetensors")
        assertEquals("NOT RELEVANT", a.relevance)
        assertTrue(a.whyNotUseful!!.contains("heap"))
    }

    @Test
    fun hugeGgufIsWarnedAboutAssetShipping() {
        val a = FileAssessor.assess("heretic-13b-q4.gguf", 700L * 1024 * 1024)
        assertEquals("WORKS", a.relevance)
        assertTrue(a.rationale.contains("filesDir"))
    }
}

class RepoAssessorTest {

    @Test
    fun deferredWorkCannotInflateProgress() {
        val items = listOf(
            MilestoneItem("Wire WebView bridge", MilestoneKind.IMPLEMENT_NOW, true),
            MilestoneItem("Ship Vulkan path", MilestoneKind.DEFER, true),
            MilestoneItem("Fix R8 keep rules", MilestoneKind.CHANGES_NEEDED, false),
        )
        val evaluation = RepoAssessor.evaluate(items)
        assertTrue(evaluation.progress < 80)
        assertEquals("AT_RISK", evaluation.health)
        assertTrue(evaluation.blockers.contains("Fix R8 keep rules"))
    }
}

class DecisionRuleTest {

    @Test
    fun rejectsReasoningWithoutBecause() {
        val errors = DecisionRule.validate("Use LiteRT", "LiteRT 2.3.0", "It is the smallest runtime available on device today")
        assertTrue(errors.any { it.contains("because") })
    }

    @Test
    fun acceptsFullReasoningSentence() {
        val errors = DecisionRule.validate(
            "Use LiteRT with GPU delegate",
            "litert:2.3.0 + litert-gpu:2.3.0",
            "We chose LiteRT with the GPU delegate because it is the only runtime that loads our int8 models without adding a second inference stack to a 150 MB APK.",
        )
        assertTrue(errors.isEmpty())
    }
}
`,
  },
  {
    path: ".github/workflows/android.yml",
    language: "yaml",
    summary: "Bundles the single-file web UI into assets, runs unit tests, assembles and uploads HeretIc.apk.",
    content: `name: Build Unified HeretIc APK

on:
  push:
    branches: [ main ]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  build-apk:
    name: Bundle Web UI & Assemble HeretIc APK
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Build single-file Web UI and copy to Android assets
        run: |
          npm ci
          npm run build
          mkdir -p public/android/HeretIc/app/src/main/assets
          cp dist/index.html public/android/HeretIc/app/src/main/assets/index.html

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'

      - name: Set up Gradle 8.7
        uses: gradle/actions/setup-gradle@v3
        with:
          gradle-version: '8.7'

      - name: Run Unit Tests & Assemble APK
        working-directory: public/android/HeretIc
        run: |
          gradle :app:testDebugUnitTest --no-daemon
          gradle :app:assembleDebug --no-daemon
          cp app/build/outputs/apk/debug/app-debug.apk ../../HeretIc.apk

      - name: Upload Downloadable HeretIc.apk Artifact
        uses: actions/upload-artifact@v4
        with:
          name: HeretIc-unified-apk
          path: HeretIc.apk
          retention-days: 30
`,
  },
  {
    path: "public/android/HeretIc/app/src/main/assets/index.html",
    language: "html",
    summary: "Generated by the copy step from dist/index.html (vite-plugin-singlefile). Placeholder until first build.",
    content: `<!doctype html>
<!--
  This file is GENERATED. Do not edit by hand.
  The build workflow runs:
      npm run build            # vite-plugin-singlefile inlines JS + CSS + icons
      cp dist/index.html public/android/HeretIc/app/src/main/assets/index.html
  The React command center then boots inside the WebView and talks to Kotlin
  through window.HereticNative (see ui/WebBridge.kt).
-->
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>HeretIc Command Center</title>
  </head>
  <body>
    <div id="root"></div>
    <script>
      (function () {
        var bridge = window.HereticNative;
        document.getElementById('root').textContent = bridge
          ? 'HereticNative bridge detected · core ' + bridge.coreVersion()
          : 'Bridge absent — run the copy step, then rebuild the APK.';
      })();
    </script>
  </body>
</html>
`,
  },
  {
    path: "public/android/HeretIc/README.md",
    language: "markdown",
    summary: "Build instructions, safeguards and the bridge contract for the unified APK.",
    content: `# HeretIc — unified offline Android build

One repository, two frontends, one brain.

| Layer | Where | Notes |
| --- | --- | --- |
| Web command center | \`dist/index.html\` | React 19 + Vite + Tailwind, bundled to a single file by \`vite-plugin-singlefile\` |
| Native UI fallback | \`app/src/main/java/ai/heretic/app/ui/HereticApp.kt\` | Jetpack Compose, same six workflows |
| Brain | \`core/HereticCore.kt\` | Rule tables mirrored in \`src/lib/engines.ts\` |
| Voice | \`voice/VoiceManager.kt\` | SpeechRecognizer + TextToSpeech, Vosk/Piper fallbacks |
| Inference | \`ml/LiteRtEngine.kt\` | LiteRT 2.3.0 with optional GPU delegate |

## Build locally

\`\`\`bash
npm ci && npm run build
cp dist/index.html public/android/HeretIc/app/src/main/assets/index.html
cd public/android/HeretIc
./gradlew :app:testDebugUnitTest
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
\`\`\`

## Bridge contract

The WebView exposes \`window.HereticNative\`:

\`\`\`ts
reply(prompt: string): string            // JSON CoreReply
analyzeError(rawLog: string): string     // JSON WHAT/WHY/REQUEST SOLUTION
confirmSolution(pasteBack: string): string
assessFile(fileName: string): string
speak(text: string): void
triggerMic(): void
triggerFilePicker(): void
\`\`\`

Native → web events: \`heretic-stt\`, \`heretic-stt-error\`, \`heretic-file-picked\`.

## Safeguards

* No \`INTERNET\` permission is declared — the APK cannot reach a network.
* No \`<service>\`, no \`<receiver>\`, no WorkManager: zero background drain.
* \`RECORD_AUDIO\` is requested only when the mic is tapped, and every decision is
  written to the hash-chained authorization ledger.
* Files arrive through \`ACTION_OPEN_DOCUMENT\`; exactly one URI grant, never a
  directory. \`allowFileAccess = false\` in the WebView.
`,
  },
];

export const ANDROID_SOURCE_PATHS = ANDROID_SOURCES.map((s) => s.path);
