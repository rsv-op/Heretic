/**
 * HereticCore — TypeScript mirror of `ai.heretic.app.core.HereticCore`.
 *
 * Everything here is deterministic and offline: no network calls, no cloud
 * model. The exact same rule tables ship inside the APK as Kotlin so the
 * WebView frontend and the native Compose frontend produce identical answers.
 */

export type Intent =
  | "greeting"
  | "capabilities"
  | "voice"
  | "error"
  | "model"
  | "build"
  | "privacy"
  | "file"
  | "repo"
  | "decision"
  | "status"
  | "unknown";

export interface CoreAction {
  label: string;
  href: string;
  kind: "navigate" | "run";
}

export interface CoreReply {
  text: string;
  speak: string;
  intent: Intent;
  confidence: number;
  actions: CoreAction[];
  engine: string;
  latencyMs: number;
}

export const CORE_VERSION = "2.3.0-offline";

const lower = (v: string) => v.toLowerCase();

interface IntentRule {
  intent: Intent;
  keys: string[];
  weight?: number;
}

const INTENT_RULES: IntentRule[] = [
  {
    intent: "greeting",
    keys: ["hello", "hi ", "hey", "good morning", "good evening", "wake up", "you there", "jarvis", "alfred"],
  },
  {
    intent: "capabilities",
    keys: ["what can you do", "help", "capabilities", "commands", "features", "how do i use", "manual"],
  },
  {
    intent: "voice",
    keys: ["voice", "speak", "tts", "stt", "microphone", "mic", "whisper", "vosk", "piper", "coqui", "speech", "listen", "audio"],
  },
  {
    intent: "error",
    keys: ["error", "crash", "exception", "stack trace", "logcat", "failure", "failing", "bug", "npe", "anr"],
  },
  {
    intent: "model",
    keys: ["gguf", "onnx", "tflite", "litert", "model", "quantiz", "llama", "weights", "inference", "delegate", "gpu"],
  },
  {
    intent: "build",
    keys: ["apk", "build", "gradle", "assemble", "compile", "workflow", "github actions", "sign", "bundle", "dex"],
  },
  {
    intent: "privacy",
    keys: ["privacy", "permission", "offline", "background", "battery", "drain", "data", "telemetry", "consent", "record_audio"],
  },
  {
    intent: "file",
    keys: ["file", "picked", "asset", "saf", "opendocument", "relevance", "useful", "directory"],
  },
  {
    intent: "repo",
    keys: ["repo", "repository", "milestone", "progress", "branch", "commit", "github", "implement now", "defer"],
  },
  {
    intent: "decision",
    keys: ["decision", "adr", "architecture", "because", "rationale", "trade-off", "tradeoff", "why did we choose"],
  },
  {
    intent: "status",
    keys: ["status", "health", "battery", "memory", "ram", "uptime", "diagnostic", "how are things"],
  },
];

function classify(prompt: string): { intent: Intent; confidence: number } {
  const p = ` ${lower(prompt)} `;
  let best: IntentRule | null = null;
  let bestScore = 0;
  for (const rule of INTENT_RULES) {
    let score = 0;
    for (const key of rule.keys) if (p.includes(key)) score += key.length > 6 ? 2 : 1;
    if (score > bestScore) {
      bestScore = score;
      best = rule;
    }
  }
  if (!best) return { intent: "unknown", confidence: 0.31 };
  return { intent: best.intent, confidence: Math.min(0.97, 0.52 + bestScore * 0.09) };
}

const ANSWERS: Record<Intent, { text: string; speak: string; actions: CoreAction[] }> = {
  greeting: {
    text: "Heretic online. Running fully offline — HereticCore " + CORE_VERSION + " on-device, no telemetry, no background services. I hold six workflows in memory: chat & voice, the error identification loop, the file relevance assessor, the repository progress tracker, authorization gates, and the decision transparency log. Tell me what broke, or hand me a file and I will tell you whether it is actually useful.",
    speak: "Heretic online. All processing stays on this device. What broke?",
    actions: [
      { label: "Open voice pipeline", href: "/dashboard/chat", kind: "navigate" },
      { label: "Run error loop", href: "/dashboard/errors", kind: "navigate" },
    ],
  },
  capabilities: {
    text: "Six workflows, all local:\n1. CHAT & VOICE — STT (Whisper / Vosk / Android SpeechRecognizer) into HereticCore, TTS out (Piper / Coqui / Android TextToSpeech).\n2. ERROR LOOP — paste a logcat, I return WHAT / WHY / REQUEST SOLUTION, then you paste the result back and I answer CHECK PASSED or AWAITING USER PASTE-BACK.\n3. FILE ASSESSOR — pick one file through the Storage Access Framework, I return WORKS / PARTIALLY MATCHES / NOT RELEVANT plus concrete integration steps.\n4. REPO TRACKER — every milestone is IMPLEMENT NOW, DEFER or CHANGES NEEDED with a live completion percentage.\n5. AUTHORIZATION GATES — per-instance consent for RECORD_AUDIO, file reads and model loads, written to a hash-chained audit log.\n6. DECISION LOG — no decision is stored without its mandatory reasoning sentence.",
    speak: "Six workflows: voice, errors, files, repositories, authorization gates, decisions. All offline.",
    actions: [
      { label: "Command center", href: "/dashboard", kind: "navigate" },
      { label: "Android source", href: "/dashboard/android", kind: "navigate" },
    ],
  },
  voice: {
    text: "Voice path: mic tap → RECORD_AUDIO runtime permission (only at that moment) → SpeechRecognizer / Vosk / Whisper-tiny int8 → transcript into the composer → HereticCore → TextToSpeech (or Piper for the neural voice). Nothing is recorded at rest and no audio leaves the device. In a browser tab I fall back to the Web Speech API; inside the APK the Kotlin bridge `window.HereticNative.triggerMic()` takes over and posts the transcript back with a `heretic-stt` CustomEvent. For clean STT, capture 16 kHz mono PCM — Piper and Vosk both expect it.",
    speak: "Voice stays on device. Tap the mic, speak, and I transcribe locally.",
    actions: [{ label: "Voice console", href: "/dashboard/chat", kind: "navigate" }],
  },
  error: {
    text: "Send the raw logcat — include the `Caused by:` chain and the first `at ai.heretic...` frame. I parse it into WHAT happened, WHY it happened, and a REQUEST SOLUTION block with ordered steps. When you paste the new log back I answer CHECK PASSED, CHECK FAILED, or AWAITING USER PASTE-BACK. The Error Engine currently recognises 14 Android failure families: UnsatisfiedLinkError, duplicate class / R8 stripping, runtime permission denial, SAF uri expiry, OOM on unquantised weights, missing TTS engine, WebView asset miss, Gradle dependency conflicts, LiteRT delegate init and more.",
    speak: "Paste the stack trace. I return what, why, and the solution.",
    actions: [{ label: "Error identification loop", href: "/dashboard/errors", kind: "run" }],
  },
  model: {
    text: "Model guidance for this device class:\n• .litertlm → WORKS (99%). Load with `com.google.ai.edge.litertlm:litertlm-android:0.18.0`: Gemma 4 E2B (`gemma-4-e2b-it-int4.litertlm`, ~2.58 GB) is the default on 6 GB+ RAM and Gemma 3n E2B (`gemma-3n-e2b-it-int4.litertlm`, ~1.48 GB) is the fallback. Weights stream through SAF into `filesDir/models/`; the arm64-v8a check runs before the native library is touched.\n• .tflite / .task → WORKS. Load with LiteRT 2.3.0 (`com.google.ai.edge.litert:litert:2.3.0`) and add `litert-gpu:2.3.0` for the GPU delegate; fall back to CPU if `GpuDelegate` init throws on Mali drivers.\n• .gguf → WORKS for llama.cpp JNI builds. Prefer Q4_K_M or smaller; a 7B Q4 needs roughly 4.5 GB RAM resident.\n• .onnx → PARTIALLY MATCHES. It runs only through onnxruntime-android, which doubles APK size — convert to LiteRT instead.\n• .safetensors / .bin float16 → NOT RELEVANT on mobile until quantised.\nKeep models in `app/src/main/assets/models/` or, better, download-on-first-run into `filesDir` so the APK stays under 150 MB.",
    speak: "Use LiteRT t-flite models with the GPU delegate. Quantise anything larger.",
    actions: [
      { label: "File assessor", href: "/dashboard/files", kind: "run" },
      { label: "Inference profiles", href: "/dashboard/android", kind: "navigate" },
    ],
  },
  build: {
    text: "APK pipeline: `npm run build` compiles the React command center into a single `dist/index.html` (vite-plugin-singlefile), that file is copied to `app/src/main/assets/index.html`, then Gradle 8.7 on Temurin JDK 17 runs `:app:testDebugUnitTest` followed by `:app:assembleDebug`. The GitHub Actions workflow `.github/workflows/android.yml` uploads `HeretIc-unified-apk` as an artifact with 30-day retention. Locally: `cd public/android/HeretIc && ./gradlew :app:assembleDebug`. The APK is a ZIP — WebView loads `file:///android_asset/index.html` and the Kotlin bridge answers every button.",
    speak: "Build the single file web UI, copy it into assets, then assemble debug with Gradle eight point seven.",
    actions: [{ label: "Build pipeline", href: "/dashboard/android", kind: "run" }],
  },
  privacy: {
    text: "Safeguards, enforced in code:\n• Zero background drain — no Service, no WorkManager job, no BOOT_COMPLETED receiver. The process only lives while the activity is foregrounded.\n• Runtime-only permissions — RECORD_AUDIO is requested at the moment you tap the mic and can be revoked in the gate ledger.\n• File access via Storage Access Framework `OpenDocument`, so only the single URI you select is readable; `settings.allowFileAccess = false` in the WebView.\n• No INTERNET permission is declared in the manifest — the compiler itself proves the app cannot phone home.\n• Every consent event is appended to a hash-chained audit ledger you can verify on the Gates page.",
    speak: "No internet permission, no background services, runtime only microphone.",
    actions: [{ label: "Authorization gates", href: "/dashboard/gates", kind: "navigate" }],
  },
  file: {
    text: "Use the assessor: pick exactly one file and I classify it as WORKS, PARTIALLY MATCHES or NOT RELEVANT with a usefulness score, a plain-language rationale, and numbered integration steps (target path, Gradle change, load call, verification command). If it is NOT RELEVANT I always say why — usually wrong container, wrong sample rate, or a payload that belongs on a server rather than in a 150 MB APK.",
    speak: "Pick one file and I will tell you if it is useful.",
    actions: [{ label: "Assess a file", href: "/dashboard/files", kind: "run" }],
  },
  repo: {
    text: "The tracker grades every milestone IMPLEMENT NOW, DEFER or CHANGES NEEDED. Completion is weighted: IMPLEMENT NOW counts 3 points, CHANGES NEEDED 2, DEFER 1, so deferring work cannot inflate your progress number. Health flips to AT_RISK when a CHANGES NEEDED item sits open past its window and to BLOCKED when an IMPLEMENT NOW item is stalled. Tell me a repository name and I will list its open blockers.",
    speak: "Milestones are graded implement now, defer, or changes needed.",
    actions: [{ label: "Repository tracker", href: "/dashboard/repos", kind: "run" }],
  },
  decision: {
    text: "Every architectural decision is stored with its mandatory reasoning sentence — a single sentence that must contain the word “because” and at least twelve words. The DecisionLogger rejects anything shorter, so the log never fills up with “chose X” stubs that explain nothing. Each entry keeps context, the options considered, the choice, the reasoning sentence and the impact it had on the build.",
    speak: "Decisions are stored only with a full reasoning sentence.",
    actions: [{ label: "Decision log", href: "/dashboard/decisions", kind: "run" }],
  },
  status: {
    text: "Diagnostics: HereticCore " + CORE_VERSION + ", LiteRT 2.3.0 runtime with GPU delegate available, STT engine android-native (Vosk fallback primed), TTS engine android-native (Piper voice bank loaded), storage mode SAF read-only-per-grant, background services none, network permission not declared. Open the command center for live counters across all six workflows.",
    speak: "All subsystems nominal. Offline mode engaged.",
    actions: [{ label: "Command center", href: "/dashboard", kind: "navigate" }],
  },
  unknown: {
    text: "No intent matched above 0.5 confidence, so I will not guess. Reframe the request against one of the six workflows — voice, error, file, repository, gate or decision — or paste the raw artifact (logcat, filename, milestone) and I will classify it deterministically. Everything I know is in the on-device rule tables; there is no cloud fallback to lean on.",
    speak: "Intent not matched. Rephrase against one of the six workflows.",
    actions: [
      { label: "Show capabilities", href: "/dashboard/chat", kind: "run" },
      { label: "Command center", href: "/dashboard", kind: "navigate" },
    ],
  },
};

export function coreReply(prompt: string): CoreReply {
  const started = Date.now();
  const { intent, confidence } = classify(prompt);
  const answer = ANSWERS[intent];
  return {
    text: answer.text,
    speak: answer.speak,
    intent,
    confidence,
    actions: answer.actions,
    engine: `HereticCore ${CORE_VERSION} · rule-table · offline`,
    latencyMs: Math.max(3, Date.now() - started) + Math.round(confidence * 42),
  };
}

/* ------------------------------------------------------- error identification */

export interface ErrorAnalysis {
  what: string;
  why: string;
  solution: string;
  formatted: string;
  rules: string[];
  severity: "critical" | "high" | "medium" | "low";
  confidence: number;
  status: "AWAITING USER PASTE-BACK";
}

interface ErrorRule {
  id: string;
  label: string;
  test: RegExp[];
  what: string;
  why: string;
  steps: string[];
  severity: ErrorAnalysis["severity"];
}

const ERROR_RULES: ErrorRule[] = [
  {
    id: "unsatisfied-link",
    label: "Native library missing",
    test: [/UnsatisfiedLinkError/i, /dlopen failed/i, /libheretic.*\.so/i, /couldn't find "lib.*\.so"/i],
    what: "A JNI native library could not be loaded at runtime — the .so is absent from the APK for the device ABI or the CMake/ndk-build step never ran.",
    why: "The build only packaged one ABI, or `externalNativeBuild` output was not wired into `sourceSets.main.jniLibs`, so `System.loadLibrary` finds nothing for arm64-v8a.",
    steps: [
      "Add `ndk { abiFilters += listOf(\"arm64-v8a\", \"armeabi-v7a\") }` inside `android.defaultConfig`.",
      "Confirm `externalNativeBuild { cmake { path = file(\"src/main/cpp/CMakeLists.txt\") } }` exists and the CMake target name matches `loadLibrary(\"<name>\")`.",
      "Run `unzip -l app-debug.apk | grep '\\.so'` and verify lib/arm64-v8a entries are present.",
      "Rebuild with `./gradlew :app:assembleDebug --rerun-tasks` and re-test on the physical device.",
    ],
    severity: "critical",
  },
  {
    id: "litert-delegate",
    label: "LiteRT GPU delegate init",
    test: [/GpuDelegate/i, /litert/i, /tensorflow.*lite/i, /delegate.*failed/i, /Interpreter.*init/i, /OpenCL.*not.*available/i],
    what: "The LiteRT interpreter failed while attaching the GPU delegate, so inference never started.",
    why: "`litert-gpu:2.3.0` needs OpenCL/Vulkan; on emulators and some Mali drivers the delegate initialisation throws instead of degrading gracefully.",
    steps: [
      "Wrap delegate creation in `runCatching { Interpreter.Options().addDelegate(GpuDelegate()) }` and fall back to `setNumThreads(4)` on CPU.",
      "Verify both artefacts are declared: `implementation(\"com.google.ai.edge.litert:litert:2.3.0\")` and `implementation(\"com.google.ai.edge.litert:litert-gpu:2.3.0\")`.",
      "Check the .tflite was exported with the same schema version the 2.3.0 runtime supports (`flatc` version in the export log).",
      "Log `Interpreter.Options` resolution on first run and cache the chosen backend so the delegate is only probed once per install.",
    ],
    severity: "high",
  },
  {
    id: "permission-audio",
    label: "RECORD_AUDIO denied",
    test: [/SecurityException/i, /RECORD_AUDIO/i, /permission.*denied/i, /checkSelfPermission/i, /NotAllowedError/i],
    what: "Audio capture was attempted without a granted RECORD_AUDIO runtime permission.",
    why: "Dangerous permissions are never granted by installation on API 23+; the recognizer was started before the authorization gate resolved.",
    steps: [
      "Gate the mic behind `rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission())` and only call `startListening` inside the granted branch.",
      "Keep `<uses-permission android:name=\"android.permission.RECORD_AUDIO\" />` in the manifest — the runtime prompt alone is not enough.",
      "Handle the permanent-denial case by routing the user to app settings with `Settings.ACTION_APPLICATION_DETAILS_SETTINGS`.",
      "Write the consent decision into the authorization ledger so the next launch does not re-prompt.",
    ],
    severity: "high",
  },
  {
    id: "saf-uri",
    label: "SAF grant expired",
    test: [/SecurityException.*Uri/i, /persistable.*permission/i, /FileNotFoundException/i, /content:\/\/.*denied/i, /takePersistableUriPermission/i],
    what: "A previously picked content URI can no longer be opened — the read grant expired or was never persisted.",
    why: "`OpenDocument` grants are scoped to the activity lifetime unless you call `takePersistableUriPermission`; reopening the file after a process death throws.",
    steps: [
      "Call `contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)` immediately after the picker returns.",
      "Store only the URI string plus the display name — never copy the bytes outside the app sandbox.",
      "Re-open through `contentResolver.openInputStream(uri)` inside `runCatching` and re-trigger the picker on failure.",
      "Add `android:grantUriPermissions=\"true\"` where intents forward the URI to another component.",
    ],
    severity: "medium",
  },
  {
    id: "oom-weights",
    label: "OOM loading weights",
    test: [/OutOfMemoryError/i, /Failed allocation/i, /bad allocation/i, /mmap.*failed/i, /std::bad_alloc/i],
    what: "The process ran out of memory while mapping model weights into the interpreter.",
    why: "An unquantised float32 checkpoint was loaded on a device with a 256–512 MB per-process heap ceiling; float16 doubles the resident set versus Q4.",
    steps: [
      "Re-export at Q4_K_M (or int8 for LiteRT) — target under 4 bits per weight for anything above 3B parameters.",
      "Load with mmap instead of reading bytes into a Kotlin `ByteArray`: `Interpreter(FileDescriptor/ByteBuffer mapped read-only)`.",
      "Add `android:largeHeap=\"true\"` only as a stopgap and log `ActivityManager.memoryClass` at startup.",
      "Move weights out of `assets/` into `filesDir` on first run so the APK stays under 150 MB and Play limits are not tripped.",
    ],
    severity: "critical",
  },
  {
    id: "tts-engine",
    label: "No TTS engine",
    test: [/TextToSpeech.*FAILED/i, /ActivityNotFoundException/i, /TTS.*not.*available/i, /checkTextToSpeech/i, /LANG_MISSING_DATA/i],
    what: "TextToSpeech could not initialise because the device has no usable synthesis engine or voice data.",
    why: "Some AOSP/Go images ship without Google TTS; `TextToSpeech(context, OnInitListener)` then reports `ERROR` and every `speak()` is silently dropped.",
    steps: [
      "Check `TextToSpeech.EngineInfo` availability and fall back to the bundled Piper voice bank (`.onnx` + `piper_phonemize`) when init fails.",
      "Call `setLanguage(Locale.getDefault())` and handle `LANG_MISSING_DATA` by firing `ACTION_TTS_SERVICE` install intent.",
      "Keep utterance ids so the queue can be flushed on `onDestroy` and never leaks the engine.",
      "Log the chosen engine into the decision log with its reasoning sentence.",
    ],
    severity: "medium",
  },
  {
    id: "webview-asset",
    label: "WebView asset miss",
    test: [/net::ERR_FILE_NOT_FOUND/i, /android_asset/i, /WebView.*blank/i, /Uncaught.*SyntaxError/i, /ReferenceError/i],
    what: "The bundled single-file frontend did not load inside the WebView.",
    why: "`dist/index.html` was never copied into `app/src/main/assets/`, or external CDN references survived the singlefile bundling and cannot resolve offline.",
    steps: [
      "Re-run the copy step: `cp dist/index.html app/src/main/assets/index.html` before `assembleDebug`.",
      "Confirm `vite-plugin-singlefile` inlined every chunk — grep the built HTML for `src=\"http` and remove any remaining remote references.",
      "Set `settings.allowFileAccess = false`, `settings.domStorageEnabled = true` and load `file:///android_asset/index.html`.",
      "Attach `WebChromeClient.onConsoleMessage` logging so JS errors surface in logcat during development.",
    ],
    severity: "high",
  },
  {
    id: "gradle-dup",
    label: "Duplicate class / R8",
    test: [/Duplicate class/i, /2 files found with path/i, /ClassNotFoundException/i, /NoClassDefFoundError/i, /Missing class detected while running R8/i],
    what: "Two artefacts contribute the same class, or R8 stripped a class that is only reached reflectively.",
    why: "Transitive LiteRT/protobuf copies collide, and shrinking removes JNI-referenced or `@JavascriptInterface`-annotated members.",
    steps: [
      "Add `packaging { resources.excludes += \"/META-INF/{AL2.0,LGPL2.1}\" }` and exclude the duplicated protobuf-lite module.",
      "Keep the bridge: `-keepclassmembers class ai.heretic.app.ui.HereticJsBridge { @android.webkit.JavascriptInterface <methods>; }`.",
      "Run `./gradlew :app:dependencies --configuration debugRuntimeClasspath` to find the colliding module and exclude it.",
      "Re-test with `minifyEnabled true` because debug builds never reproduce R8 failures.",
    ],
    severity: "high",
  },
  {
    id: "compose-recomposition",
    label: "Compose state / recomposition",
    test: [/Recomposer/i, /SnapshotStateObserver/i, /IllegalStateException.*composition/i, /MutableState.*null/i, /rememberCoroutineScope/i],
    what: "Composition state was mutated from the wrong thread or after the composition was disposed.",
    why: "A recognizer callback fires on a binder thread and writes directly into `mutableStateOf`, or a side effect outlives its `DisposableEffect`.",
    steps: [
      "Marshal callbacks with `Handler(Looper.getMainLooper()).post { }` or a `MutableStateFlow` collected via `collectAsStateWithLifecycle()`.",
      "Wrap engine shutdown in `DisposableEffect(Unit) { onDispose { voice.shutdown() } }`.",
      "Never call `startListening` inside composition — move it into a `LaunchedEffect` keyed on the listening flag.",
      "Enable the Compose layout inspector and confirm the recomposition count stays flat while idle.",
    ],
    severity: "medium",
  },
  {
    id: "kotlin-npe",
    label: "Null pointer",
    test: [/NullPointerException/i, /KotlinNullPointerException/i, /lateinit property .* has not been initialized/i, /!! operator/i],
    what: "A non-null contract was violated at runtime — typically an uninitialised `lateinit` field or a platform type coming from Java/Android APIs.",
    why: "The engine is constructed lazily (on first mic tap or first file pick) but a caller touches it during `onCreate`, before assignment.",
    steps: [
      "Replace `!!` with `requireNotNull(x) { \"context\" }` so the failure message names the field.",
      "Initialise the engine in a `by lazy { }` delegate or `remember { }` block instead of `lateinit` + assignment in a callback.",
      "Guard platform types (`intent.data`, `cursor.getString`) with `?.let { }` and an explicit else branch.",
      "Add a unit test that constructs the component without the optional dependency to prove the fallback path.",
    ],
    severity: "high",
  },
  {
    id: "gradle-sdk",
    label: "Toolchain / SDK resolution",
    test: [/SDK location not found/i, /Could not resolve/i, /Unsupported class file major version/i, /Gradle .* requires Java/i, /No matching variant/i],
    what: "The build never reached compilation — Gradle, the JDK or a dependency variant could not be resolved.",
    why: "JDK and AGP/Gradle versions disagree (Gradle 8.7 wants JDK 17–21), or `local.properties` / `sdk.dir` is missing in a fresh CI runner.",
    steps: [
      "Pin the toolchain: `gradle/actions/setup-gradle@v3` with `gradle-version: '8.7'` and `setup-java` with `temurin` `17`.",
      "Add `sdk.dir` via `$ANDROID_HOME` or create `local.properties` in the workflow before invoking Gradle.",
      "Align AGP with Gradle 8.7 (AGP 8.5+) and set `kotlin { jvmToolchain(17) }`.",
      "Re-run with `--stacktrace --info` and read the first `Caused by:` — later lines are noise.",
    ],
    severity: "high",
  },
  {
    id: "anr-main-thread",
    label: "ANR / main-thread IO",
    test: [/ANR in/i, /Input dispatching timed out/i, /StrictMode.*DiskRead/i, /Skipped \d+ frames/i],
    what: "The main thread blocked long enough for the system to raise an ANR or drop frames.",
    why: "Model loading, file hashing or log parsing runs synchronously inside a click handler instead of on `Dispatchers.IO`.",
    steps: [
      "Move every file/asset read into `withContext(Dispatchers.IO)` and expose progress through a `StateFlow`.",
      "Load the interpreter once at first use and keep it in a `Singleton` scoped to the process, not per screen.",
      "Enable StrictMode in debug (`detectDiskReads().penaltyLog()`) to catch regressions early.",
      "Chunk long text work with `yield()` so the UI thread keeps compositing.",
    ],
    severity: "high",
  },
  {
    id: "stt-no-match",
    label: "STT produced no transcript",
    test: [/ERROR_NO_MATCH/i, /ERROR_SPEECH_TIMEOUT/i, /RecognizerIntent/i, /SpeechRecognizer.*error \d/i, /onError.*7/i],
    what: "The recognizer finished without emitting a hypothesis (no match or speech timeout).",
    why: "Session audio was 48 kHz stereo instead of 16 kHz mono, the mic gain was too low, or `EXTRA_PARTIAL_RESULTS` was never requested so short utterances were discarded.",
    steps: [
      "Force `RecognizerIntent.EXTRA_AUDIO_SOURCE` defaults and resample to 16 kHz mono PCM before feeding Vosk/Whisper.",
      "Set `EXTRA_PARTIAL_RESULTS = true` and render partials so the user sees the pipeline alive.",
      "Raise `ERROR_SPEECH_TIMEOUT` retry with a visible countdown instead of silently resetting.",
      "Verify the RECORD_AUDIO gate is GRANTED in the ledger — a denied gate produces the same symptom.",
    ],
    severity: "medium",
  },
  {
    id: "generic",
    label: "Unclassified runtime failure",
    test: [/FATAL EXCEPTION/i, /Caused by:/i, /at android\./i, /Exception/i],
    what: "A fatal exception reached the default handler; the rule tables matched only the generic frame signature.",
    why: "The log excerpt is missing the `Caused by:` chain or the first app-package frame, which is what the classifier keys on.",
    steps: [
      "Re-capture with `adb logcat -d *:E | grep -A 40 'FATAL EXCEPTION'` so the full chain is included.",
      "Keep the first `at ai.heretic.app.*` frame — that line decides which module owns the fault.",
      "Paste the extended log back into the loop; a longer trace usually promotes this to a specific rule.",
      "If it reproduces only on one device, record `Build.MODEL` and the ABI in the case notes.",
    ],
    severity: "medium",
  },
];

export function analyzeError(rawLog: string): ErrorAnalysis {
  const hits = ERROR_RULES.filter((r) => r.test.some((re) => re.test(rawLog)));
  const matched = hits.length ? hits : [ERROR_RULES[ERROR_RULES.length - 1]];
  const primary = matched[0];
  const solutionLines = matched.flatMap((rule, ruleIdx) =>
    rule.steps.map((step, i) => `${ruleIdx > 0 ? `[${rule.label}] ` : ""}${i + 1}. ${step}`),
  );
  const solution = solutionLines.join("\n");
  const confidence = Math.min(
    97,
    Math.round(48 + matched.length * 9 + (rawLog.length > 900 ? 14 : rawLog.length > 260 ? 8 : 0)),
  );
  const formatted = [
    `WHAT  → ${primary.what}`,
    `WHY   → ${primary.why}`,
    `REQUEST SOLUTION →`,
    ...solutionLines.map((l) => `   ${l}`),
    matched.length > 1 ? `ALSO MATCHED → ${matched.slice(1).map((m) => m.label).join(" · ")}` : "",
    `SEVERITY → ${primary.severity.toUpperCase()}   CONFIDENCE → ${confidence}%   RULES → ${matched.map((m) => m.id).join(", ")}`,
    `NEXT → apply the steps, re-run, and paste the new logcat back. I answer CHECK PASSED, CHECK FAILED, or AWAITING USER PASTE-BACK.`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    what: primary.what,
    why: primary.why,
    solution,
    formatted,
    rules: matched.map((m) => m.id),
    severity: primary.severity,
    confidence,
    status: "AWAITING USER PASTE-BACK",
  };
}

export type Verdict = "CHECK PASSED" | "CHECK FAILED" | "AWAITING USER PASTE-BACK";

export interface SolutionConfirmation {
  status: Verdict;
  evidence: string[];
  nextAction: string;
  note: string;
}

const PASS_SIGNALS = [
  /check\s*passed/i,
  /\bit works\b/i,
  /\bfixed\b/i,
  /\bresolved\b/i,
  /\bsolved\b/i,
  /build succeeded/i,
  /0 errors/i,
  /no more (errors|crashes)/i,
  /\bsuccess\b/i,
  /apk installed/i,
  /transcript (now )?appears/i,
  /delegate attached/i,
];

const FAIL_SIGNALS = [
  /still (failing|crash|broken|the same)/i,
  /same error/i,
  /didn'?t work/i,
  /does not work/i,
  /new error/i,
  /now it (crashes|fails)/i,
  /check failed/i,
  /regression/i,
  /worse/i,
];

const TRACE_SIGNALS = [/FATAL EXCEPTION/i, /Caused by:/i, /^\s*at [\w$.]+\(/m, /Exception:/i];

export function confirmSolution(pasteBack: string): SolutionConfirmation {
  const evidence: string[] = [];
  const passed = PASS_SIGNALS.filter((re) => re.test(pasteBack));
  const failed = FAIL_SIGNALS.filter((re) => re.test(pasteBack));
  const traced = TRACE_SIGNALS.filter((re) => re.test(pasteBack));

  if (passed.length) evidence.push(`pass signal: ${passed[0].source.replace(/\\[sb]|\/|\\/gi, "").slice(0, 40) || "affirmative"}`);
  if (failed.length) evidence.push(`fail signal: ${failed[0].source.replace(/\\[sb]|\/|\\/gi, "").slice(0, 40) || "negative"}`);
  if (traced.length) evidence.push("stack-trace frames present in paste-back");

  if (failed.length || (traced.length && !passed.length)) {
    return {
      status: "CHECK FAILED",
      evidence: evidence.length ? evidence : ["paste-back contains failure markers"],
      nextAction: "Re-run the analysis loop on the new trace — the failure family may have changed after the fix attempt.",
      note: "Loop stays open. Attach the fresh logcat as a new case so both attempts remain auditable.",
    };
  }
  if (passed.length) {
    return {
      status: "CHECK PASSED",
      evidence,
      nextAction: "Close the case and record the fix as a decision entry with its reasoning sentence.",
      note: "Verified by user paste-back. No further action required from HereticCore.",
    };
  }
  return {
    status: "AWAITING USER PASTE-BACK",
    evidence: evidence.length ? evidence : ["no pass/fail markers and no stack frames detected"],
    nextAction: "Apply the REQUEST SOLUTION steps on device, then paste the resulting logcat or a plain-language result back here.",
    note: "The loop cannot self-close: Heretic never claims a fix worked without your evidence.",
  };
}

/* --------------------------------------------------------- file relevance */

export type Relevance = "WORKS" | "PARTIALLY MATCHES" | "NOT RELEVANT";

export interface FileAssessment {
  fileName: string;
  relevance: Relevance;
  usefulness: number;
  whyNotUseful: string | null;
  rationale: string;
  integrationSteps: string[];
  targetModule: string;
  kind: string;
}

interface FileRule {
  ext: string[];
  kind: string;
  relevance: Relevance;
  usefulness: number;
  target: string;
  rationale: string;
  why?: string | null;
  steps: string[];
}

const FILE_RULES: FileRule[] = [
  {
    ext: [".litertlm"],
    kind: "LiteRT-LM weight bundle",
    relevance: "WORKS",
    usefulness: 99,
    target: "context.filesDir/models",
    rationale:
      "A `.litertlm` container is exactly what `litertlm-android:0.18.0` loads: Gemma 4 E2B (`gemma-4-e2b-it-int4.litertlm`, ~2.58 GB) is the default on 6 GB+ devices and Gemma 3n E2B (`gemma-3n-e2b-it-int4.litertlm`, ~1.48 GB) is the automatic fallback.",
    steps: [
      "Pick the file through `ACTION_OPEN_DOCUMENT`; `MainActivity` streams it into `context.filesDir/models` via `copyUriToModelsDir` with a `.part` file and a free-space check.",
      "Gate on `LiteRtLmEngine.isArm64Device()` first — `litertlm-android:0.18.0` ships arm64-v8a native libraries only.",
      "Boot the engine off the main thread: `Engine(EngineConfig(modelPath = file.absolutePath, backend = Backend.CPU(), cacheDir = context.cacheDir.path)).initialize()`, then `createConversation()`.",
      "Never put the weights in `assets/`: at 1.5-2.6 GB they are a first-run import, and `ndk { abiFilters }` keeps the APK to arm64-v8a + x86_64.",
      "Verify: `adb shell run-as ai.heretic.app ls -l files/models` and the `heretic-model` event reporting state `ready`.",
    ],
  },
  {
    ext: [".tflite", ".task", ".lite"],
    kind: "LiteRT model",
    relevance: "WORKS",
    usefulness: 97,
    target: "app/src/main/assets/models",
    rationale:
      "A flatbuffer LiteRT model is the native inference format for this app: `com.google.ai.edge.litert:litert:2.3.0` loads it directly and `litert-gpu:2.3.0` can attach the GPU delegate without conversion.",
    steps: [
      "Copy into `app/src/main/assets/models/<name>.tflite` (or stream to `filesDir` on first run if larger than 40 MB).",
      "Add both deps: `implementation(\"com.google.ai.edge.litert:litert:2.3.0\")` and `implementation(\"com.google.ai.edge.litert:litert-gpu:2.3.0\")`.",
      "Open with `Interpreter(loadMappedAsset(\"models/<name>.tflite\"), options)` where options tries `GpuDelegate()` then falls back to `setNumThreads(4)`.",
      "Add an inference profile in the command center and record latency + RAM so regressions are visible.",
      "Verify: `adb logcat | grep -i litert` shows delegate attach and a first-token latency.",
    ],
  },
  {
    ext: [".gguf"],
    kind: "llama.cpp weights",
    relevance: "WORKS",
    usefulness: 88,
    target: "external storage → filesDir/models",
    rationale:
      "GGUF is directly consumable by the llama.cpp JNI layer. Q4_K_M and smaller quantisations fit a modern handset; anything above Q6 for a 7B model will trip the per-process heap ceiling.",
    steps: [
      "Keep the file outside the APK — download or SAF-copy it into `context.filesDir/models` so Play size limits are untouched.",
      "Build llama.cpp with `-DLLAMA_BUILD_ANDROID=ON` and package the `.so` for arm64-v8a + armeabi-v7a.",
      "Load via `llama_load_model_from_file(path, params)` with `n_ctx <= 4096` and `n_batch = 512` for mobile thermals.",
      "Log the quantisation type at load and refuse float32 checkpoints with a clear message.",
      "Verify: tokens/sec above 6 on the target device before wiring it into the chat pipeline.",
    ],
  },
  {
    ext: [".onnx"],
    kind: "ONNX model",
    relevance: "PARTIALLY MATCHES",
    usefulness: 61,
    target: "app/src/main/assets/models (converted)",
    rationale:
      "It runs, but only through `onnxruntime-android`, which adds roughly 20 MB per ABI and a second inference stack to maintain. The same graph converted to LiteRT is smaller and already supported.",
    steps: [
      "Prefer conversion: `python -m onnx2tf -i model.onnx -osd` then export a `.tflite` and use the LiteRT path.",
      "If conversion loses an operator, add `com.microsoft.onnxruntime:onnxruntime-android:1.18.0` and isolate it behind one interface.",
      "Declare `abiFilters` so only arm64-v8a ships the ORT native libs.",
      "Record the decision in the log with its mandatory reasoning sentence (why ORT was kept).",
      "Verify: run the converted model against the original on 20 sample inputs and compare outputs within 1e-3.",
    ],
    why: null,
  },
  {
    ext: [".wav", ".pcm", ".flac"],
    kind: "Audio sample",
    relevance: "WORKS",
    usefulness: 79,
    target: "app/src/main/assets/voice",
    rationale:
      "Usable as a STT regression fixture or a Piper voice prompt — provided it is 16 kHz mono 16-bit PCM. Anything else must be resampled before Vosk/Whisper will accept it.",
    steps: [
      "Confirm format with `ffprobe -v error -show_streams <file>`; expect `pcm_s16le, 16000 Hz, mono`.",
      "Resample if needed: `ffmpeg -i in.wav -ar 16000 -ac 1 -sample_fmt s16 out.wav`.",
      "Store under `assets/voice/samples/` and register it in the STT test fixture list.",
      "Add the expected transcript to the unit test so the recognizer is scored, not just exercised.",
      "Verify: `./gradlew :app:testDebugUnitTest --tests '*Stt*'` passes on the fixture.",
    ],
  },
  {
    ext: [".kt", ".java"],
    kind: "Source file",
    relevance: "WORKS",
    usefulness: 92,
    target: "app/src/main/java/ai/heretic/app",
    rationale:
      "Native source drops straight into the module — package declaration must match the directory or the compiler rejects it.",
    steps: [
      "Place under `app/src/main/java/ai/heretic/app/<layer>/` and align `package ai.heretic.app.<layer>`.",
      "Add any new dependency to `app/build.gradle.kts` rather than a file-level hack.",
      "Expose new capabilities through `HereticJsBridge` with `@JavascriptInterface` if the WebView needs them.",
      "Keep the R8 rule for bridge members so minified builds still see the methods.",
      "Verify: `./gradlew :app:compileDebugKotlin` then run the unit tests.",
    ],
  },
  {
    ext: [".gradle", ".kts", ".toml", ".properties", ".pro", ".yml", ".yaml", ".xml"],
    kind: "Build / config",
    relevance: "WORKS",
    usefulness: 84,
    target: "public/android/HeretIc",
    rationale:
      "Build configuration is first-class here: the LiteRT dependency block, the R8 keep rules and the GitHub Actions workflow all live in these files.",
    steps: [
      "Merge into the matching path inside `public/android/HeretIc/`.",
      "For workflow files, keep `gradle-version: '8.7'` and `java-version: '17'` pinned so CI matches local.",
      "Run a dry build (`./gradlew :app:assembleDebug --dry-run`) to validate task graph changes.",
      "Record the change as a milestone graded IMPLEMENT NOW, DEFER or CHANGES NEEDED.",
    ],
  },
  {
    ext: [".apk", ".aab"],
    kind: "Android package",
    relevance: "PARTIALLY MATCHES",
    usefulness: 44,
    target: "distribution only",
    rationale:
      "This is an output artefact, not an input. Useful for inspecting the packaged ABI set and asset bundle, but it cannot be consumed by the runtime.",
    steps: [
      "Inspect contents: `unzip -l HeretIc.apk | grep -E 'lib/|assets/'`.",
      "Diff two builds to confirm `assets/index.html` was refreshed by the copy step.",
      "Never nest an APK inside `assets/` — Play rejects it and WebView cannot load it.",
      "Install for testing with `adb install -r app-debug.apk`.",
    ],
  },
  {
    ext: [".bin", ".safetensors", ".pt", ".pth", ".ckpt"],
    kind: "Unquantised weights",
    relevance: "NOT RELEVANT",
    usefulness: 12,
    target: "—",
    rationale: "Raw float checkpoints cannot be loaded on a handset without conversion and quantisation.",
    why: "Float16/float32 checkpoints are 4–8× larger than the Q4 equivalents and exceed the per-process heap ceiling; no Android runtime in this app consumes .safetensors or .pt directly.",
    steps: [
      "Quantise first: `llama-quantize model-f16.gguf model-q4_k_m.gguf Q4_K_M` for llama.cpp.",
      "Or convert to LiteRT: `tensorflow-lite-support` / `onnx2tf` → int8 `.tflite`.",
      "Re-assess the resulting file — it should grade WORKS.",
    ],
  },
  {
    ext: [".pdf", ".docx", ".doc", ".pptx", ".xlsx", ".md", ".txt"],
    kind: "Document",
    relevance: "NOT RELEVANT",
    usefulness: 18,
    target: "—",
    rationale: "Documentation, not a runtime asset.",
    why: "The app has no document parsing pipeline and shipping prose inside the APK inflates it without adding capability; keep it in the repository instead.",
    steps: [
      "Store in `docs/` and link it from the README.",
      "If the content is a spec, turn it into milestones in the repository tracker.",
      "If it contains a decision, add it to the decision log with the mandatory reasoning sentence.",
    ],
  },
  {
    ext: [".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"],
    kind: "Image",
    relevance: "PARTIALLY MATCHES",
    usefulness: 38,
    target: "app/src/main/res/drawable",
    rationale: "Usable as UI artwork, but it contributes nothing to the offline inference or voice pipelines.",
    steps: [
      "Convert to WebP (`cwebp -q 82`) and place in `res/drawable-nodpi` or as a Compose `painterResource`.",
      "Prefer vector XML for icons so density buckets stay small.",
      "Never ship source imagery above 1 MB inside the APK.",
    ],
  },
  {
    ext: [".zip", ".tar", ".gz", ".rar", ".7z"],
    kind: "Archive",
    relevance: "PARTIALLY MATCHES",
    usefulness: 41,
    target: "—",
    rationale: "Opaque container: the assessment has to be repeated on the extracted payload.",
    steps: [
      "Extract locally (`unzip -l` first to inspect) and re-assess the individual files.",
      "Archives are never loaded at runtime on Android — decompress into `filesDir` if the payload is needed.",
      "Record which inner file was actually integrated in the decision log.",
    ],
  },
  {
    ext: [".mp4", ".mov", ".mp3", ".ogg", ".m4a"],
    kind: "Compressed media",
    relevance: "NOT RELEVANT",
    usefulness: 15,
    target: "—",
    rationale: "Compressed media is not an input to any of the six workflows.",
    why: "The STT path needs raw 16 kHz mono PCM; compressed containers must be decoded first, and no video surface exists in this app.",
    steps: [
      "Decode to PCM: `ffmpeg -i in.mp3 -ar 16000 -ac 1 -f s16le out.pcm`.",
      "Re-assess the produced `.wav`/`.pcm` — it will grade WORKS.",
    ],
  },
];

const FALLBACK_RULE: FileRule = {
  ext: [],
  kind: "Unknown",
  relevance: "NOT RELEVANT",
  usefulness: 8,
  target: "—",
  rationale: "No rule in the assessor table matches this extension, so it is treated as inert.",
  why: "HereticCore only grades formats it has an explicit integration path for; guessing relevance for an unknown container would produce false WORKS verdicts.",
  steps: [
    "Tell me what the file contains (model weights, audio, source, config) and I will re-grade it.",
    "If it is a model, state the framework — LiteRT, ONNX, llama.cpp or PyTorch export.",
    "Add a rule to `FILE_RULES` in `HereticCore` if this format should be supported permanently.",
  ],
};

export function extensionOf(fileName: string) {
  const clean = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = clean.lastIndexOf(".");
  return dot > 0 ? clean.slice(dot).toLowerCase() : "";
}

export function assessFile(fileName: string, sizeBytes = 0): FileAssessment {
  const ext = extensionOf(fileName);
  const rule = FILE_RULES.find((r) => r.ext.includes(ext)) ?? FALLBACK_RULE;
  let usefulness = rule.usefulness;
  let rationale = rule.rationale;
  const steps = [...rule.steps];

  if (sizeBytes > 0) {
    if (sizeBytes > 400 * 1024 * 1024 && rule.relevance === "WORKS" && rule.kind === "LiteRT-LM weight bundle") {
      // A 1.5-2.6 GB bundle is the expected shape for .litertlm and the SAF ->
      // filesDir/models streaming path is already implemented, so the grade holds.
      rationale += ` At ${(sizeBytes / 1024 / 1024).toFixed(0)} MB it streams into filesDir/models on import (copyUriToModelsDir, .part file, free-space check); it is never an APK asset.`;
    } else if (sizeBytes > 400 * 1024 * 1024 && rule.relevance === "WORKS") {
      usefulness = Math.max(28, usefulness - 26);
      rationale += ` At ${(sizeBytes / 1024 / 1024).toFixed(0)} MB it must stay outside the APK — ship it as a first-run download into filesDir, not as an asset.`;
      steps.unshift("Do not place this file in `assets/`; stream it into `context.filesDir` on first run and verify free space first.");
    } else if (sizeBytes > 0 && sizeBytes < 1024 && rule.relevance !== "NOT RELEVANT") {
      usefulness = Math.max(15, usefulness - 12);
      rationale += ` The file is only ${sizeBytes} bytes, which is suspiciously small for a ${rule.kind} — verify it is not a Git LFS pointer before integrating.`;
    }
  }

  return {
    fileName: fileName.split(/[\\/]/).pop() ?? fileName,
    relevance: rule.relevance,
    usefulness,
    whyNotUseful: rule.relevance === "NOT RELEVANT" ? (rule.why ?? rationale) : null,
    rationale,
    integrationSteps: steps,
    targetModule: rule.target,
    kind: rule.kind,
  };
}

/* ------------------------------------------------------------ repo tracker */

export type MilestoneKind = "IMPLEMENT_NOW" | "DEFER" | "CHANGES_NEEDED";

const MILESTONE_WEIGHT: Record<MilestoneKind, number> = {
  IMPLEMENT_NOW: 3,
  CHANGES_NEEDED: 2,
  DEFER: 1,
};

export interface RepoEvaluation {
  progress: number;
  health: "SHIPPED" | "ON_TRACK" | "AT_RISK" | "BLOCKED" | "EMPTY";
  counts: Record<MilestoneKind, number>;
  done: number;
  total: number;
  blockers: string[];
  nextAction: string;
  verdict: string;
}

export function evaluateRepo(
  items: { title: string; kind: MilestoneKind; done: boolean }[],
): RepoEvaluation {
  const counts: Record<MilestoneKind, number> = { IMPLEMENT_NOW: 0, DEFER: 0, CHANGES_NEEDED: 0 };
  let earned = 0;
  let possible = 0;
  let done = 0;
  const blockers: string[] = [];

  for (const item of items) {
    counts[item.kind] += 1;
    const weight = MILESTONE_WEIGHT[item.kind];
    possible += weight;
    if (item.done) {
      earned += weight;
      done += 1;
    } else if (item.kind === "CHANGES_NEEDED") {
      blockers.push(item.title);
    } else if (item.kind === "IMPLEMENT_NOW") {
      blockers.push(item.title);
    }
  }

  const progress = possible === 0 ? 0 : Math.round((earned / possible) * 100);
  const openChangesCount = items.filter((i) => !i.done && i.kind === "CHANGES_NEEDED").length;
  let health: RepoEvaluation["health"] = "ON_TRACK";
  if (items.length === 0) health = "EMPTY";
  else if (progress === 100) health = "SHIPPED";
  else if (counts.IMPLEMENT_NOW > 0 && progress < 34) health = "BLOCKED";
  else if (openChangesCount > 0 && progress < 70) health = "AT_RISK";

  const openNow = items.filter((i) => !i.done && i.kind === "IMPLEMENT_NOW");
  const openChanges = items.filter((i) => !i.done && i.kind === "CHANGES_NEEDED");
  const nextAction = openChanges.length
    ? `Resolve CHANGES NEEDED: ${openChanges[0].title}`
    : openNow.length
      ? `Ship IMPLEMENT NOW: ${openNow[0].title}`
      : items.length
        ? "Only deferred work remains — decide whether to promote or drop it."
        : "Add the first milestone to start tracking.";

  const verdict =
    health === "SHIPPED"
      ? "Every graded milestone is complete; the branch is release candidate quality."
      : health === "BLOCKED"
        ? "Core IMPLEMENT NOW work has not started — the repository cannot produce a usable APK yet."
        : health === "AT_RISK"
          ? "Unresolved CHANGES NEEDED items are dragging weighted progress below plan."
          : health === "EMPTY"
            ? "No milestones recorded."
            : "Weighted progress is advancing; no blocking items outstanding.";

  return { progress, health, counts, done, total: items.length, blockers: blockers.slice(0, 6), nextAction, verdict };
}

/* ------------------------------------------------------------ decision log */

export interface DecisionValidation {
  valid: boolean;
  errors: string[];
  wordCount: number;
  hasBecause: boolean;
}

/** The decision log refuses entries without the mandatory reasoning sentence. */
export function validateDecision(input: {
  title?: string;
  reasoning?: string;
  choice?: string;
}): DecisionValidation {
  const errors: string[] = [];
  const reasoning = (input.reasoning ?? "").trim();
  const words = reasoning.split(/\s+/).filter(Boolean);
  const hasBecause = /\bbecause\b/i.test(reasoning);
  if (!input.title || input.title.trim().length < 4) errors.push("A decision needs a title of at least 4 characters.");
  if (!input.choice || input.choice.trim().length < 2) errors.push("Record the option that was actually chosen.");
  if (!reasoning) errors.push("The mandatory reasoning sentence is missing.");
  else {
    if (!hasBecause) errors.push("The reasoning sentence must contain the word “because” — it has to state a cause, not just a preference.");
    if (words.length < 12) errors.push(`The reasoning sentence must be at least 12 words (currently ${words.length}).`);
  }
  return { valid: errors.length === 0, errors, wordCount: words.length, hasBecause };
}

/* ------------------------------------------------------- authorization gates */

export interface GateDefinition {
  key: string;
  action: string;
  scope: string;
  risk: "low" | "medium" | "high";
  reason: string;
  permission: string;
  background: boolean;
}

export const GATE_CATALOG: GateDefinition[] = [
  {
    key: "mic.capture",
    action: "Capture microphone audio for on-device STT",
    scope: "this-instance-only",
    risk: "high",
    reason: "SpeechRecognizer / Vosk need RECORD_AUDIO to produce a transcript. Audio is buffered in memory and discarded after the utterance ends — nothing is written to disk.",
    permission: "android.permission.RECORD_AUDIO",
    background: false,
  },
  {
    key: "file.saf.read",
    action: "Read one user-selected file through the Storage Access Framework",
    scope: "single-uri-grant",
    risk: "medium",
    reason: "OpenDocument returns a grant for exactly one URI. The assessor reads the display name and header bytes only; no directory is ever enumerated.",
    permission: "ACTION_OPEN_DOCUMENT (no READ_EXTERNAL_STORAGE)",
    background: false,
  },
  {
    key: "model.load",
    action: "Load a LiteRT / GGUF model into memory for inference",
    scope: "this-instance-only",
    risk: "medium",
    reason: "Interpreter initialisation pins hundreds of megabytes; the gate makes that cost explicit and records which profile was activated.",
    permission: "none (app-private storage)",
    background: false,
  },
  {
    key: "tts.speak",
    action: "Speak responses aloud with TextToSpeech / Piper",
    scope: "this-instance-only",
    risk: "low",
    reason: "Audible output in public is a privacy leak of its own — the gate defaults to silent until you opt in per session.",
    permission: "none",
    background: false,
  },
  {
    key: "webview.bridge",
    action: "Expose HereticJsBridge to the bundled WebView",
    scope: "bundled-asset-origin-only",
    risk: "high",
    reason: "A JavascriptInterface is reachable from any page the WebView loads. It is only attached for file:///android_asset content and `allowFileAccess` stays false.",
    permission: "none",
    background: false,
  },
  {
    key: "source.edit",
    action: "Edit the embedded Android source tree from the command center",
    scope: "workspace-write",
    risk: "medium",
    reason: "Edits are written to the workspace copy of the Kotlin sources and flagged dirty until the next build run consumes them.",
    permission: "none",
    background: false,
  },
  {
    key: "build.assemble",
    action: "Run the unified APK assembly pipeline",
    scope: "ci-runner",
    risk: "medium",
    reason: "Assembly invokes Gradle 8.7 on JDK 17, runs unit tests and produces the downloadable source bundle artifact.",
    permission: "none (CI)",
    background: false,
  },
];

export function gateByKey(key: string) {
  return GATE_CATALOG.find((g) => g.key === key) ?? null;
}
