import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  androidSources,
  buildRuns,
  conversations,
  decisions,
  errorCases,
  fileAssets,
  gates,
  inferenceProfiles,
  messages,
  milestones,
  repositories,
  sessions,
  users,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { ANDROID_SOURCES } from "@/lib/androidSources";
import { GATE_CATALOG, analyzeError, assessFile, confirmSolution, validateDecision } from "@/lib/engines";

export const DEMO_EMAIL = "operator@heretic.ai";
export const DEMO_PASSWORD = "heretic-offline";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

export function auditHash(prev: string, key: string, decision: string, scope: string, at: Date) {
  return createHash("sha256")
    .update(`${prev}|${key}|${decision}|${scope}|${at.getTime()}`)
    .digest("hex");
}

export async function hasAnyUsers() {
  const rows = await db.execute(sql`select count(*)::int as count from users`);
  const raw = rows as unknown as { rows?: { count?: number }[] } | { count?: number }[];
  const first = Array.isArray(raw) ? raw[0] : (raw as { rows?: { count?: number }[] }).rows?.[0];
  return Number((first as { count?: number } | undefined)?.count ?? 0) > 0;
}

/** Seeds the Android source tree + gate catalog for any workspace. */
export async function seedWorkspaceSkeleton(userId: string) {
  await db.insert(androidSources).values(
    ANDROID_SOURCES.map((source, position) => ({
      userId,
      path: source.path,
      language: source.language,
      summary: source.summary,
      content: source.content,
      sizeBytes: Buffer.byteLength(source.content, "utf8"),
      position,
    })),
  );

  let prev = "genesis";
  for (const [index, gate] of GATE_CATALOG.entries()) {
    const at = hoursAgo(30 - index);
    const hash = auditHash(prev, gate.key, "PENDING", gate.scope, at);
    await db.insert(gates).values({
      userId,
      gateKey: gate.key,
      action: gate.action,
      scope: gate.scope,
      risk: gate.risk,
      reason: gate.reason,
      decision: "PENDING",
      prevHash: prev,
      auditHash: hash,
      createdAt: at,
    });
    prev = hash;
  }
}

interface DemoConversation {
  title: string;
  mode: string;
  stt: string;
  tts: string;
  ageHours: number;
  pinned?: boolean;
  turns: { role: "user" | "heretic" | "system"; content: string; intent?: string; latency?: number; delay: number }[];
}

const DEMO_CONVERSATIONS: DemoConversation[] = [
  {
    title: "Cold boot · mic gate + first transcript",
    mode: "voice",
    stt: "android-native",
    tts: "piper",
    ageHours: 26,
    pinned: true,
    turns: [
      { role: "system", content: "Session opened. HereticCore 2.3.0-offline resident. No INTERNET permission declared — all inference local.", delay: 0 },
      { role: "user", content: "Wake up Heretic. What can you do?", intent: "capabilities", delay: 40 },
      { role: "heretic", content: "Six workflows, all local: chat & voice, the error identification loop, the file relevance assessor, the repository progress tracker, authorization gates and the decision transparency log. Nothing leaves this device and there are no background services to drain it.", intent: "capabilities", latency: 38, delay: 42 },
      { role: "user", content: "Enable the microphone so I can talk to you.", intent: "voice", delay: 190 },
      { role: "system", content: "GATE mic.capture → GRANTED (this-instance-only). RECORD_AUDIO requested at tap time, audio buffered in memory only.", delay: 191 },
      { role: "heretic", content: "Mic gate is open for this instance. Speak and I will transcribe with SpeechRecognizer at 16 kHz mono; if the platform recognizer is missing I fall back to Vosk. Say “status” any time for a diagnostic dump.", intent: "voice", latency: 44, delay: 194 },
    ],
  },
  {
    title: "UnsatisfiedLinkError on the arm64 device",
    mode: "text",
    stt: "vosk",
    tts: "android-native",
    ageHours: 9,
    turns: [
      { role: "user", content: "FATAL EXCEPTION: main\njava.lang.UnsatisfiedLinkError: dlopen failed: library \"libheretic_jni.so\" not found\n\tat ai.heretic.app.ml.LiteRtEngine.load(LiteRtEngine.kt:41)", intent: "error", delay: 10 },
      { role: "heretic", content: "WHAT → a JNI native library could not be loaded at runtime; the .so is absent for arm64-v8a.\nWHY → only one ABI was packaged, or externalNativeBuild output never reached jniLibs.\nREQUEST SOLUTION → add abiFilters for arm64-v8a + armeabi-v7a, verify the CMake target name matches loadLibrary, then inspect with `unzip -l app-debug.apk | grep '.so'`.", intent: "error", latency: 61, delay: 12 },
      { role: "user", content: "Added the abiFilters block and rebuilt — check passed, the .so is in lib/arm64-v8a now.", intent: "error", delay: 320 },
      { role: "heretic", content: "CHECK PASSED. Evidence: affirmative paste-back, no fresh stack frames. Closing the loop — record the abiFilters change as a decision entry so the next person knows why the ABI set is pinned.", intent: "error", latency: 29, delay: 322 },
    ],
  },
  {
    title: "Model drop: 13B GGUF on a Pixel 7",
    mode: "text",
    stt: "whisper-tiny-int8",
    tts: "piper",
    ageHours: 3,
    turns: [
      { role: "user", content: "I picked heretic-13b-q4_k_m.gguf from Downloads. Is it useful?", intent: "file", delay: 8 },
      { role: "heretic", content: "WORKS, usefulness 62%. GGUF is consumable by the llama.cpp JNI layer, but at 7.4 GB it must never ship inside assets — stream it into filesDir on first run and check free space. Expect roughly 3 tokens/sec on a Pixel 7, which is below the conversational threshold; a 7B Q4_K_M is the better fit.", intent: "file", latency: 52, delay: 10 },
      { role: "user", content: "Swap to the 7B then. Keep the GPU delegate for the wake-word model.", intent: "model", delay: 140 },
      { role: "heretic", content: "Understood: 7B Q4_K_M for dialogue, LiteRT wake-word with litert-gpu:2.3.0. The delegate is probed once per install and cached, so a Mali driver that throws on init costs a single failed attempt before falling back to four CPU threads.", intent: "model", latency: 47, delay: 143 },
    ],
  },
  {
    title: "CI run 41 · bundle web UI into assets",
    mode: "text",
    stt: "android-native",
    tts: "android-native",
    ageHours: 1.4,
    turns: [
      { role: "user", content: "Why did run 40 fail before compile?", intent: "build", delay: 6 },
      { role: "heretic", content: "SDK location not found. The runner had JDK 17 but no ANDROID_HOME written into local.properties before Gradle ran. Fix: create local.properties from $ANDROID_HOME in the workflow, keep gradle-version pinned at 8.7, and align AGP to 8.5+.", intent: "build", latency: 41, delay: 8 },
      { role: "system", content: "Run 41 queued → npm ci → npm run build → cp dist/index.html app/src/main/assets/index.html → :app:testDebugUnitTest → :app:assembleDebug.", delay: 60 },
      { role: "heretic", content: "Run 41 succeeded: 11 unit tests green, app-debug.apk assembled, single-file web UI inlined (no remote src references remain). Artifact HeretIc-unified-apk retained for 30 days.", intent: "build", latency: 33, delay: 62 },
    ],
  },
];

const DEMO_ERRORS: { title: string; rawLog: string; pasteBack?: string; ageHours: number }[] = [
  {
    title: "libheretic_jni.so missing on arm64-v8a",
    rawLog: `FATAL EXCEPTION: main
Process: ai.heretic.app, PID: 14207
java.lang.UnsatisfiedLinkError: dlopen failed: library "libheretic_jni.so" not found
	at java.lang.Runtime.loadLibrary0(Runtime.java:1087)
	at ai.heretic.app.ml.LiteRtEngine.load(LiteRtEngine.kt:41)
	at ai.heretic.app.MainActivity.onCreate(MainActivity.kt:58)`,
    pasteBack: "Added abiFilters arm64-v8a + armeabi-v7a, reran assembleDebug --rerun-tasks. check passed, the .so is packaged now.",
    ageHours: 9,
  },
  {
    title: "GpuDelegate init throws on Mali-G710",
    rawLog: `E/Heretic: Interpreter init failed
java.lang.IllegalArgumentException: GpuDelegate could not be created: OpenCL not available on this device
	at com.google.ai.edge.litert.gpu.GpuDelegate.<init>(GpuDelegate.java:88)
	at ai.heretic.app.ml.LiteRtEngine.load(LiteRtEngine.kt:33)
Caused by: java.lang.UnsatisfiedLinkError: libOpenCL.so not found`,
    pasteBack: "Wrapped delegate creation in runCatching with setNumThreads(4) fallback. still failing on the emulator but works on hardware — new error there: java.lang.OutOfMemoryError when loading the 13B weights.",
    ageHours: 5.5,
  },
  {
    title: "RECORD_AUDIO denied → recognizer never starts",
    rawLog: `W/SpeechRecognizer: startListening called without permission
java.lang.SecurityException: Permission Denial: RECORD_AUDIO required
	at ai.heretic.app.voice.VoiceManager.startListening(VoiceManager.kt:74)
	at ai.heretic.app.ui.HereticJsBridge.triggerMic(WebBridge.kt:96)`,
    pasteBack: "Gated startListening behind the permission launcher and logged consent to the ledger. It works, transcript appears immediately now.",
    ageHours: 30,
  },
  {
    title: "WebView shows blank — assets/index.html not copied",
    rawLog: `E/chromium: [ERROR:aw_browser_context.cc] net::ERR_FILE_NOT_FOUND (file:///android_asset/index.html)
W/Heretic/webview.error: -14 net::ERR_FILE_NOT_FOUND file:///android_asset/index.html`,
    ageHours: 2.2,
  },
  {
    title: "Duplicate class com.google.protobuf.* after adding litert",
    rawLog: `FAILURE: Build failed with an exception.
* What went wrong:
Execution failed for task :app:checkDebugDuplicateClasses.
> Duplicate class com.google.protobuf.AbstractMessageLite found in modules protobuf-javalite-3.25.3.jar and protobuf-lite-3.0.0.jar
2 files found with path 'META-INF/AL2.0'`,
    ageHours: 48,
  },
  {
    title: "SAF grant expired after process death",
    rawLog: `W/System.err: java.lang.SecurityException: UID 10231 does not have permission to content://com.android.providers.downloads.documents/document/msf%3A42
	at ai.heretic.app.core.FileAssessor.openStream(FileAssessor.kt:112)
Caused by: java.lang.FileNotFoundException: open failed: EACCES (Permission denied)`,
    ageHours: 14,
  },
];

const DEMO_FILES: { fileName: string; sizeBytes: number; origin: string; notes?: string; ageHours: number }[] = [
  { fileName: "heretic-wakeword-int8.tflite", sizeBytes: 2_411_724, origin: "saf-open-document", notes: "OpenWakeWord export, 16 kHz mono frame input.", ageHours: 6 },
  { fileName: "heretic-7b-q4_k_m.gguf", sizeBytes: 4_380_860_416, origin: "first-run-download", notes: "Dialogue model; streamed into filesDir/models.", ageHours: 3 },
  { fileName: "heretic-13b-q4_k_m.gguf", sizeBytes: 7_942_000_000, origin: "saf-open-document", notes: "Too slow on Pixel 7 — kept as a benchmark only.", ageHours: 3.4 },
  { fileName: "emotion-classifier.onnx", sizeBytes: 18_874_368, origin: "saf-open-document", notes: "Convert with onnx2tf before shipping.", ageHours: 22 },
  { fileName: "piper-en_GB-alba-medium.onnx", sizeBytes: 63_123_456, origin: "bundled-asset", notes: "Neural TTS voice bank, 22 kHz output.", ageHours: 50 },
  { fileName: "stt-fixture-mic-gate-16k.wav", sizeBytes: 412_672, origin: "repo-fixture", notes: "Expected transcript stored in the unit test.", ageHours: 27 },
  { fileName: "VoiceManager.kt", sizeBytes: 6_912, origin: "repo-fixture", ageHours: 12 },
  { fileName: "heretic-7b-f16.safetensors", sizeBytes: 14_200_000_000, origin: "saf-open-document", notes: "Rejected: needs quantisation.", ageHours: 8 },
  { fileName: "architecture-overview.pdf", sizeBytes: 2_097_152, origin: "saf-open-document", ageHours: 4 },
  { fileName: "app-debug.apk", sizeBytes: 41_234_567, origin: "ci-artifact", notes: "Run 41 output.", ageHours: 1.2 },
];

const DEMO_REPOS: {
  name: string;
  remote: string;
  branch: string;
  summary: string;
  lastCommit: string;
  ageHours: number;
  milestones: { title: string; detail: string; kind: "IMPLEMENT_NOW" | "DEFER" | "CHANGES_NEEDED"; done: boolean }[];
}[] = [
  {
    name: "HeretIc-android",
    remote: "github.com/heretic-ai/HeretIc",
    branch: "main",
    summary: "Unified APK: bundled single-file web UI + native Kotlin core.",
    lastCommit: "9f31c0a · ci: create local.properties from ANDROID_HOME before gradle",
    ageHours: 1.1,
    milestones: [
      { title: "Attach HereticJsBridge to the WebView", detail: "addJavascriptInterface(\"HereticNative\") with allowFileAccess=false", kind: "IMPLEMENT_NOW", done: true },
      { title: "Copy dist/index.html into app assets", detail: "cp dist/index.html app/src/main/assets/index.html in the workflow", kind: "IMPLEMENT_NOW", done: true },
      { title: "R8 keep rules for @JavascriptInterface", detail: "proguard-rules.pro keepclassmembers for HereticJsBridge", kind: "IMPLEMENT_NOW", done: true },
      { title: "Runtime RECORD_AUDIO gate at mic tap", detail: "rememberLauncherForActivityResult + ledger write", kind: "IMPLEMENT_NOW", done: true },
      { title: "Vulkan delegate path", detail: "GpuDelegate INFERECE_PREFERENCE for Vulkan-capable devices", kind: "DEFER", done: false },
      { title: "Fix duplicate protobuf-lite classes", detail: "exclude protobuf-lite from litert transitive graph", kind: "CHANGES_NEEDED", done: false },
      { title: "Signed release variant", detail: "operator keystore + signingConfig for release", kind: "DEFER", done: false },
    ],
  },
  {
    name: "heretic-voice-pack",
    remote: "github.com/heretic-ai/voice-pack",
    branch: "piper-2026.1",
    summary: "Offline STT fixtures + Piper voice banks for on-device TTS.",
    lastCommit: "4b7de11 · voice: add 16k mono fixture for mic-gate prompt",
    ageHours: 12,
    milestones: [
      { title: "Resample all fixtures to 16 kHz mono", detail: "ffmpeg -ar 16000 -ac 1 -sample_fmt s16", kind: "IMPLEMENT_NOW", done: true },
      { title: "Ship Piper en_GB-alba-medium voice", detail: "assets/voice/piper + phonemize data", kind: "IMPLEMENT_NOW", done: true },
      { title: "Vosk small-en fallback model", detail: "42 MB, loaded only when SpeechRecognizer is absent", kind: "IMPLEMENT_NOW", done: false },
      { title: "Whisper-tiny int8 encoder", detail: "needs NNAPI validation on Tensor G2", kind: "CHANGES_NEEDED", done: false },
      { title: "Coqui TTS runtime", detail: "superseded by Piper; keep for research", kind: "DEFER", done: false },
    ],
  },
  {
    name: "heretic-command-center",
    remote: "github.com/heretic-ai/command-center",
    branch: "main",
    summary: "React 19 + Vite + Tailwind single-file UI embedded into the APK.",
    lastCommit: "c22d9f4 · ui: native bridge detection chip in the chat header",
    ageHours: 0.6,
    milestones: [
      { title: "vite-plugin-singlefile bundling", detail: "one dist/index.html with inlined CSS + icons", kind: "IMPLEMENT_NOW", done: true },
      { title: "window.HereticNative type declarations", detail: "src/types/index.ts optional bridge", kind: "IMPLEMENT_NOW", done: true },
      { title: "heretic-stt / heretic-file-picked listeners", detail: "CustomEvent wiring in ChatInterface.tsx", kind: "IMPLEMENT_NOW", done: true },
      { title: "Offline font subsetting", detail: "no CDN references may survive bundling", kind: "CHANGES_NEEDED", done: false },
      { title: "Compose ↔ WebView toggle in settings", detail: "useWebFrontend state persisted", kind: "IMPLEMENT_NOW", done: false },
      { title: "PWA install prompt", detail: "irrelevant inside the APK", kind: "DEFER", done: false },
    ],
  },
];

const DEMO_DECISIONS: {
  title: string;
  context: string;
  options: string[];
  choice: string;
  reasoning: string;
  impact: string;
  tags: string[];
  ageHours: number;
}[] = [
  {
    title: "Bundle the React UI into WebView assets instead of a rewrite",
    context: "The command center already exists as a single-file Vite build; a second Compose implementation would double maintenance.",
    options: ["WebView + dist/index.html in assets", "Full Compose rewrite", "React Native port", "Flutter port"],
    choice: "WebView + dist/index.html in assets",
    reasoning: "We bundle the compiled React single-file UI into app/src/main/assets because vite-plugin-singlefile already produces one self-contained index.html, so the exact same interface runs in a browser tab and inside the APK without maintaining two frontends.",
    impact: "One UI codebase, zero CDN references, bridge contract of seven methods. Compose remains available behind a toggle.",
    tags: ["frontend", "webview", "build"],
    ageHours: 60,
  },
  {
    title: "LiteRT 2.3.0 with optional GPU delegate for inference",
    context: "Wake-word and emotion classifiers need sub-100 ms inference on a mid-range handset.",
    options: ["LiteRT 2.3.0 + litert-gpu", "ONNX Runtime Android", "NNAPI directly", "PyTorch Mobile"],
    choice: "LiteRT 2.3.0 + litert-gpu",
    reasoning: "We adopted com.google.ai.edge.litert:litert:2.3.0 with the optional litert-gpu:2.3.0 delegate because it loads int8 flatbuffers with no second inference stack, and the GPU delegate can be probed once and cached instead of paying a fallback cost on every launch.",
    impact: "APK grows 6 MB, wake-word latency 38 ms on Tensor G2, CPU fallback at 4 threads when OpenCL is missing.",
    tags: ["inference", "litert", "performance"],
    ageHours: 52,
  },
  {
    title: "No INTERNET permission in the manifest",
    context: "Every assistant on the market declares network access; users cannot verify offline claims.",
    options: ["Omit INTERNET entirely", "Declare it but never use it", "Declare it for model downloads only"],
    choice: "Omit INTERNET entirely",
    reasoning: "We deliberately omit android.permission.INTERNET from the manifest because a missing permission is a compiler-enforced guarantee that no code path can exfiltrate audio, transcripts or files, which is a stronger claim than a policy promise.",
    impact: "Model updates must be sideloaded or fetched by a companion app; error rules are shipped in-APK.",
    tags: ["privacy", "security", "manifest"],
    ageHours: 51,
  },
  {
    title: "Runtime-only RECORD_AUDIO through an authorization gate",
    context: "Voice is the primary input, but a hot mic is the worst failure mode for an always-on assistant.",
    options: ["Request at first launch", "Request on mic tap", "Foreground service with persistent mic"],
    choice: "Request on mic tap",
    reasoning: "We request RECORD_AUDIO only inside the mic button's permission launcher because consent then maps to a single visible user action, and combined with no services or boot receivers the microphone can never be open while the app is backgrounded.",
    impact: "Every grant is written to a hash-chained ledger; revoking clears all instance grants immediately.",
    tags: ["privacy", "voice", "permissions"],
    ageHours: 50,
  },
  {
    title: "Storage Access Framework instead of READ_EXTERNAL_STORAGE",
    context: "The file assessor must inspect user files without touching the rest of the filesystem.",
    options: ["ACTION_OPEN_DOCUMENT", "MANAGE_EXTERNAL_STORAGE", "Scoped copy of Downloads"],
    choice: "ACTION_OPEN_DOCUMENT",
    reasoning: "We use ACTION_OPEN_DOCUMENT for every file pick because the returned grant covers exactly one URI, so the assessor can grade a file while the rest of the storage volume remains unreadable to the process.",
    impact: "Grants are taken persistable at pick time and re-prompted when they expire; no directory enumeration anywhere.",
    tags: ["storage", "privacy"],
    ageHours: 49,
  },
  {
    title: "Deterministic rule tables over a fine-tuned chat model",
    context: "A conversational model would need 4 GB of weights and would still hallucinate build fixes.",
    options: ["Rule tables in Kotlin + TS mirror", "7B GGUF dialogue model", "Cloud API", "Hybrid: rules first, model as fallback"],
    choice: "Rule tables in Kotlin + TS mirror",
    reasoning: "HereticCore answers from deterministic rule tables mirrored in Kotlin and TypeScript because a fixed set of fourteen Android failure families needs reproducible WHAT/WHY/SOLUTION output, and a rule table can be unit tested in CI while a generative model cannot.",
    impact: "Answers are instant and offline; unknown intents return low confidence instead of a guess.",
    tags: ["core", "architecture", "offline"],
    ageHours: 48,
  },
  {
    title: "Hash-chained authorization ledger",
    context: "Consent events must be auditable after the fact without a server.",
    options: ["Plain log file", "Hash chain in SharedPreferences", "Room database table", "Signed JWT per event"],
    choice: "Hash chain in SharedPreferences",
    reasoning: "Each consent event stores the previous event's SHA-256 alongside its own because a chain makes silent edits detectable offline, and verification is a single pass over the ledger with no keys to manage on a device that has no network.",
    impact: "The Gates page can prove the ledger is intact; clearing instance grants resets the chain to genesis.",
    tags: ["audit", "security"],
    ageHours: 47,
  },
  {
    title: "Gradle 8.7 on Temurin JDK 17 pinned in CI",
    context: "Local and CI builds diverged twice on JDK 21 class-file versions.",
    options: ["Gradle 8.7 + JDK 17", "Gradle wrapper latest + JDK 21", "Bazel"],
    choice: "Gradle 8.7 + JDK 17",
    reasoning: "The workflow pins gradle-version 8.7 with temurin 17 because that pairing matches AGP 8.5 and the Kotlin jvmToolchain(17) declaration, so the APK produced by CI is byte-for-byte comparable to a local assembleDebug.",
    impact: "Reproducible artifacts; unit tests run before assembly so a broken rule table never ships.",
    tags: ["ci", "build"],
    ageHours: 20,
  },
];

const DEMO_PROFILES = [
  { name: "Wake word · int8", runtime: "LiteRT 2.3.0", model: "heretic-wakeword-int8.tflite", delegate: "GPU", threads: 4, latencyMs: 38, ramMb: 74, active: true },
  { name: "Emotion classifier", runtime: "LiteRT 2.3.0", model: "emotion-classifier.tflite (converted from ONNX)", delegate: "CPU", threads: 4, latencyMs: 126, ramMb: 210, active: false },
  { name: "Dialogue · 7B Q4_K_M", runtime: "llama.cpp JNI", model: "heretic-7b-q4_k_m.gguf", delegate: "CPU/mmap", threads: 4, latencyMs: 340, ramMb: 4600, active: true },
  { name: "STT · Whisper tiny int8", runtime: "whisper.cpp", model: "ggml-tiny-int8.bin", delegate: "CPU", threads: 2, latencyMs: 910, ramMb: 390, active: false },
];

export async function ensureDemoSeed() {
  if (await hasAnyUsers()) return null;

  const [demo] = await db
    .insert(users)
    .values({
      email: DEMO_EMAIL,
      handle: "heretic",
      name: "Operator Vale",
      passwordHash: hashPassword(DEMO_PASSWORD),
      role: "operator",
      deviceModel: "Pixel 7 · Android 14 · arm64-v8a",
      bridgeMode: "native-webview",
    })
    .returning();

  await seedDemoWorkspace(demo.id);
  return demo;
}

/** Rich, realistic demo workspace used by the seeded operator and by “Load demo data”. */
export async function seedDemoWorkspace(userId: string) {
  await seedWorkspaceSkeleton(userId);

  /* conversations + messages */
  for (const convo of DEMO_CONVERSATIONS) {
    const [created] = await db
      .insert(conversations)
      .values({
        userId,
        title: convo.title,
        mode: convo.mode,
        sttEngine: convo.stt,
        voiceEngine: convo.tts,
        pinned: convo.pinned ?? false,
        createdAt: hoursAgo(convo.ageHours),
        updatedAt: hoursAgo(convo.ageHours),
      })
      .returning();
    await db.insert(messages).values(
      convo.turns.map((turn) => ({
        conversationId: created.id,
        userId,
        role: turn.role,
        content: turn.content,
        intent: turn.intent ?? null,
        latencyMs: turn.latency ?? null,
        spoken: turn.role === "heretic" && convo.mode === "voice",
        createdAt: new Date(created.createdAt.getTime() + turn.delay * 1000),
      })),
    );
  }

  /* error cases */
  let counter = 1;
  for (const item of DEMO_ERRORS) {
    const analysis = analyzeError(item.rawLog);
    const confirmation = item.pasteBack ? confirmSolution(item.pasteBack) : null;
    const status = confirmation
      ? confirmation.status === "CHECK PASSED"
        ? "CHECK_PASSED"
        : confirmation.status === "CHECK FAILED"
          ? "CHECK_FAILED"
          : "AWAITING_PASTE_BACK"
      : "AWAITING_PASTE_BACK";
    const at = hoursAgo(item.ageHours);
    await db.insert(errorCases).values({
      userId,
      ref: `ERR-${String(counter++).padStart(3, "0")}`,
      title: item.title,
      rawLog: item.rawLog,
      what: analysis.what,
      why: analysis.why,
      solution: analysis.solution,
      formatted: analysis.formatted,
      rules: analysis.rules,
      severity: analysis.severity,
      confidence: analysis.confidence,
      status: status as "CHECK_PASSED",
      pasteBack: item.pasteBack ?? null,
      verdictNote: confirmation ? `${confirmation.status} — ${confirmation.note}` : null,
      createdAt: at,
      updatedAt: at,
    });
  }

  /* file assets */
  for (const item of DEMO_FILES) {
    const assessment = assessFile(item.fileName, item.sizeBytes);
    const at = hoursAgo(item.ageHours);
    await db.insert(fileAssets).values({
      userId,
      fileName: assessment.fileName,
      origin: item.origin,
      sizeBytes: item.sizeBytes,
      relevance: assessment.relevance.replace(/ /g, "_") as "WORKS",
      usefulness: assessment.usefulness,
      whyNotUseful: assessment.whyNotUseful,
      rationale: assessment.rationale,
      integrationSteps: assessment.integrationSteps,
      targetModule: assessment.targetModule,
      notes: item.notes ?? null,
      createdAt: at,
      updatedAt: at,
    });
  }

  /* repositories + milestones */
  for (const repo of DEMO_REPOS) {
    const at = hoursAgo(repo.ageHours);
    const [created] = await db
      .insert(repositories)
      .values({
        userId,
        name: repo.name,
        remote: repo.remote,
        branch: repo.branch,
        summary: repo.summary,
        lastCommit: repo.lastCommit,
        createdAt: at,
        updatedAt: at,
      })
      .returning();
    await db.insert(milestones).values(
      repo.milestones.map((m, position) => ({
        repoId: created.id,
        userId,
        title: m.title,
        detail: m.detail,
        kind: m.kind,
        done: m.done,
        position,
      })),
    );
  }

  /* decisions (validated by the same rule the API enforces) */
  let decisionCounter = 1;
  for (const d of DEMO_DECISIONS) {
    const validation = validateDecision({ title: d.title, choice: d.choice, reasoning: d.reasoning });
    if (!validation.valid) continue;
    const at = hoursAgo(d.ageHours);
    await db.insert(decisions).values({
      userId,
      ref: `ADR-${String(decisionCounter++).padStart(3, "0")}`,
      title: d.title,
      context: d.context,
      options: d.options,
      choice: d.choice,
      reasoning: d.reasoning,
      impact: d.impact,
      tags: d.tags,
      createdAt: at,
      updatedAt: at,
    });
  }

  /* inference profiles */
  await db.insert(inferenceProfiles).values(
    DEMO_PROFILES.map((p) => ({ userId, ...p })),
  );

  /* gate decisions on top of the skeleton ledger */
  const existing = await db.select().from(gates).where(sql`${gates.userId} = ${userId}`).orderBy(gates.createdAt);
  const granted: Record<string, "GRANTED" | "DENIED"> = {
    "mic.capture": "GRANTED",
    "file.saf.read": "GRANTED",
    "tts.speak": "GRANTED",
    "model.load": "GRANTED",
    "webview.bridge": "DENIED",
  };
  for (const [index, gate] of existing.entries()) {
    const decision = granted[gate.gateKey];
    if (!decision) continue;
    await db
      .update(gates)
      .set({
        decision,
        decidedBy: "operator@heretic.ai",
        decidedAt: new Date(gate.createdAt.getTime() + (index + 1) * 900_000),
      })
      .where(sql`${gates.id} = ${gate.id}`);
  }

  // Re-link the ledger so every prevHash points at the previous auditHash.
  let prev = "genesis";
  for (const gate of await db
    .select()
    .from(gates)
    .where(sql`${gates.userId} = ${userId}`)
    .orderBy(gates.createdAt)) {
    const hash = auditHash(prev, gate.gateKey, gate.decision, gate.scope, gate.createdAt);
    await db
      .update(gates)
      .set({ prevHash: prev, auditHash: hash })
      .where(sql`${gates.id} = ${gate.id}`);
    prev = hash;
  }

  /* build runs */
  const runLogs = (n: number, ok: boolean) => [
    { t: 0, step: "actions/checkout@v4", line: `Checked out heretic-ai/HeretIc@${ok ? "9f31c0a" : "7be02d4"}` },
    { t: 2, step: "actions/setup-node@v4", line: "Node 22.14.0 ready · npm 10.9.2" },
    { t: 9, step: "npm ci", line: "added 412 packages in 7s" },
    { t: 21, step: "npm run build", line: "vite v6 · vite-plugin-singlefile · dist/index.html 1.42 MB (inlined 9 chunks)" },
    { t: 22, step: "copy asset", line: "cp dist/index.html public/android/HeretIc/app/src/main/assets/index.html" },
    { t: 27, step: "actions/setup-java@v4", line: "temurin 17.0.13+11 · JAVA_HOME set" },
    { t: 34, step: "gradle/actions/setup-gradle@v3", line: "Gradle 8.7 provisioned" },
    { t: 61, step: ":app:testDebugUnitTest", line: ok ? "11 tests completed, 0 failed · ErrorEngineTest, FileAssessorTest, RepoAssessorTest, DecisionRuleTest" : "9 tests completed, 2 failed · RepoAssessorTest.deferredWorkCannotInflateProgress" },
    { t: 96, step: ":app:mergeDebugAssets", line: "assets/index.html packaged (1.42 MB)" },
    { t: 148, step: ":app:assembleDebug", line: ok ? "BUILD SUCCESSFUL in 1m 52s · app-debug.apk 41.2 MB" : "BUILD FAILED in 1m 12s · see test report" },
    { t: 151, step: "upload-artifact@v4", line: ok ? "HeretIc-unified-apk uploaded · retention 30 days" : "skipped (job failed)" },
  ].slice(0, n);

  await db.insert(buildRuns).values([
    {
      userId,
      runNumber: 39,
      ref: "main",
      trigger: "push",
      status: "FAILED",
      logs: runLogs(8, false),
      testsPassed: 9,
      durationMs: 132_000,
      createdAt: hoursAgo(70),
    },
    {
      userId,
      runNumber: 40,
      ref: "main",
      trigger: "push",
      status: "FAILED",
      logs: [
        { t: 0, step: "actions/checkout@v4", line: "Checked out heretic-ai/HeretIc@1cd9e77" },
        { t: 27, step: "actions/setup-java@v4", line: "temurin 17.0.13+11" },
        { t: 34, step: "gradle/actions/setup-gradle@v3", line: "Gradle 8.7 provisioned" },
        { t: 41, step: ":app:assembleDebug", line: "FAILURE: SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable or local.properties." },
      ],
      testsPassed: 0,
      durationMs: 47_000,
      createdAt: hoursAgo(24),
    },
    {
      userId,
      runNumber: 41,
      ref: "main",
      trigger: "workflow_dispatch",
      status: "SUCCEEDED",
      logs: runLogs(11, true),
      artifactName: "HeretIc-unified-apk",
      artifactBytes: 41_234_567,
      testsPassed: 11,
      durationMs: 154_000,
      createdAt: hoursAgo(1.1),
    },
  ]);
}

/** Removes every workspace row except the account itself and its sessions. */
export async function clearWorkspaceData(userId: string) {
  await db.delete(messages).where(sql`${messages.userId} = ${userId}`);
  await db.delete(conversations).where(sql`${conversations.userId} = ${userId}`);
  await db.delete(errorCases).where(sql`${errorCases.userId} = ${userId}`);
  await db.delete(fileAssets).where(sql`${fileAssets.userId} = ${userId}`);
  await db.delete(milestones).where(sql`${milestones.userId} = ${userId}`);
  await db.delete(repositories).where(sql`${repositories.userId} = ${userId}`);
  await db.delete(gates).where(sql`${gates.userId} = ${userId}`);
  await db.delete(decisions).where(sql`${decisions.userId} = ${userId}`);
  await db.delete(androidSources).where(sql`${androidSources.userId} = ${userId}`);
  await db.delete(buildRuns).where(sql`${buildRuns.userId} = ${userId}`);
  await db.delete(inferenceProfiles).where(sql`${inferenceProfiles.userId} = ${userId}`);
}

export async function wipeWorkspace(userId: string) {
  await clearWorkspaceData(userId);
  await db.delete(sessions).where(sql`${sessions.userId} = ${userId}`);
}
