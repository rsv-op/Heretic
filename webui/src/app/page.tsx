"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, cn } from "@/lib/client";
import { Badge, Button, Panel } from "@/components/ui";
import { CountUp, KenBurns, Reveal, Scramble, TypeOut, Waveform } from "@/components/motion";
import {
  Arrow,
  Bolt,
  Branch,
  Bug,
  Check,
  Chevron,
  Copy,
  Droid,
  FolderScan,
  Gate,
  Gauge,
  Layers,
  Ledger,
  Lock,
  Mic,
  Play,
  Sigil,
  Spark,
  Terminal,
  Waveform as WaveIcon,
} from "@/components/Icons";

const BOOT_LINES = [
  "heretic.core      : 2.3.0-offline initialised (rule tables resident)",
  "android.permission: INTERNET ............... NOT DECLARED",
  "background.services: 0   boot.receivers: 0   workmanager.jobs: 0",
  "litert.runtime    : 2.3.0  ·  litert-gpu: 2.3.0  ·  delegate probe: cached",
  "voice.stt         : android-native → vosk-small fallback primed",
  "voice.tts         : android-native → piper en_GB-alba-medium loaded",
  "webview.asset     : file:///android_asset/index.html  ·  bridge: HereticNative",
  "authorization     : 5 gates armed · ledger head genesis",
  "status            : AWAITING OPERATOR",
];

const WORKFLOWS = [
  {
    key: "chat",
    title: "Chat & Voice Pipeline",
    files: "ChatInterface.tsx ↔ ChatScreen + VoiceManager.kt",
    body: "SpeechRecognizer, Vosk or Whisper-tiny int8 transcribe on-device; HereticCore answers; TextToSpeech or Piper speaks. Nothing is uploaded — the manifest declares no INTERNET permission at all.",
    sample: "STT 16 kHz mono → HereticCore → TTS · 38 ms wake, 340 ms/token dialogue",
    icon: <WaveIcon width={18} height={18} />,
    span: "lg:col-span-3",
  },
  {
    key: "error",
    title: "Error Identification Loop",
    files: "ErrorAnalyzer.tsx ↔ ErrorEngine.kt",
    body: "Paste a logcat and the engine returns WHAT broke, WHY it broke and a REQUEST SOLUTION block. Paste the result back and it answers CHECK PASSED, CHECK FAILED, or AWAITING USER PASTE-BACK.",
    sample: "WHAT → JNI .so missing for arm64-v8a\nWHY  → single ABI packaged\nCHECK PASSED · evidence: paste-back",
    icon: <Bug width={18} height={18} />,
    span: "lg:col-span-3",
  },
  {
    key: "file",
    title: "File Relevance Assessor",
    files: "FileAssessor.tsx ↔ FileAssessor.kt",
    body: "One SAF pick, one verdict: WORKS, PARTIALLY MATCHES or NOT RELEVANT — with a usefulness score, the reason it fails, and numbered integration steps down to the Gradle line.",
    sample: "heretic-wakeword-int8.tflite → WORKS 97%\n7b-f16.safetensors → NOT RELEVANT (heap ceiling)",
    icon: <FolderScan width={18} height={18} />,
    span: "lg:col-span-2",
  },
  {
    key: "repo",
    title: "Repository Progress Tracker",
    files: "GitHubProgress.tsx ↔ RepoAssessor.kt",
    body: "Every milestone is graded IMPLEMENT NOW, DEFER or CHANGES NEEDED. Progress is weighted 3/2/1 so deferring work can never inflate the number.",
    sample: "HeretIc-android · 71% weighted · AT_RISK\nblocker: Fix duplicate protobuf-lite classes",
    icon: <Branch width={18} height={18} />,
    span: "lg:col-span-2",
  },
  {
    key: "gates",
    title: "Authorization Gates",
    files: "AuthorizationGates.tsx ↔ AuthorizationGate.kt",
    body: "Per-instance consent for mic capture, file reads, model loads and the WebView bridge. Each decision is appended to a hash-chained ledger you can re-verify offline.",
    sample: "mic.capture GRANTED · prev 9f31c0a4… · hash 4b7de11f…",
    icon: <Gate width={18} height={18} />,
    span: "lg:col-span-2",
  },
  {
    key: "decisions",
    title: "Decision Transparency Log",
    files: "DecisionLog.tsx ↔ DecisionLogger.kt",
    body: "A decision is only stored with its mandatory reasoning sentence — it must contain “because” and at least twelve words. Stubs are rejected at 422.",
    sample: "ADR-002 · LiteRT + GPU delegate · 27 words · accepted",
    icon: <Ledger width={18} height={18} />,
    span: "lg:col-span-3",
  },
  {
    key: "android",
    title: "Embedded Android Project",
    files: "public/android/HeretIc/**",
    body: "The full compilable Kotlin + Compose source lives inside the repository and inside the dashboard: browsable, editable, testable and bundled into a downloadable artifact.",
    sample: "20 sources · Kotlin 2.1 · Compose BOM · Gradle 8.7 · JDK 17",
    icon: <Droid width={18} height={18} />,
    span: "lg:col-span-3",
  },
];

const BRIDGE_SNIPPET = `// ui/WebBridge.kt — the WebView surface
class HereticJsBridge(
    private val core: HereticCore,
    private val voice: VoiceManager,
    private val onPickFileRequest: () -> Unit,
    private val onRequestMicPermission: () -> Unit,
) {
    @JavascriptInterface fun reply(prompt: String): String { /* … */ }
    @JavascriptInterface fun analyzeError(rawLog: String): String { /* … */ }
    @JavascriptInterface fun confirmSolution(pasteBack: String): String
    @JavascriptInterface fun assessFile(fileName: String): String { /* … */ }
    @JavascriptInterface fun speak(text: String) { voice.speak(text) }
    @JavascriptInterface fun triggerMic() = onRequestMicPermission()
    @JavascriptInterface fun triggerFilePicker() = onPickFileRequest()
}`;

const ACTIVITY_SNIPPET = `// MainActivity.kt — one WebView, real Android APIs
AndroidView(factory = { ctx ->
    WebView(ctx).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false          // assets only
        addJavascriptInterface(
            HereticJsBridge(core, voice,
                onPickFileRequest = { filePickerLauncher.launch(arrayOf("*/*")) },
                onRequestMicPermission = {
                    if (granted) voice.startListening(
                        onResult = { emit("heretic-stt", it) },
                        onError  = { emit("heretic-stt-error", it) })
                    else micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                }),
            "HereticNative")
        loadUrl("file:///android_asset/index.html")
    }
})`;

const FRONTEND_SNIPPET = `// src/types/index.ts — works in a browser AND inside the APK
declare global {
  interface Window {
    HereticNative?: {
      reply: (prompt: string) => string;
      analyzeError: (rawLog: string) => string;
      confirmSolution: (pasteBack: string) => string;
      assessFile: (fileName: string) => string;
      speak: (text: string) => void;
      triggerMic: () => void;
      triggerFilePicker: () => void;
    };
  }
}

// ChatInterface.tsx
useEffect(() => {
  const onStt = (e: Event) => {
    const transcript = (e as CustomEvent<string>).detail;
    setIsListening(false);
    if (transcript) setInput(transcript);
  };
  window.addEventListener("heretic-stt", onStt);
  return () => window.removeEventListener("heretic-stt", onStt);
}, []);

const toggleVoice = () => {
  if (window.HereticNative) { setIsListening(true); window.HereticNative.triggerMic(); }
  else setIsListening((v) => !v);   // browser: Web Speech API
};`;

const WORKFLOW_YML = `# .github/workflows/android.yml
- name: Build single-file Web UI and copy to Android assets
  run: |
    npm ci
    npm run build
    mkdir -p public/android/HeretIc/app/src/main/assets
    cp dist/index.html public/android/HeretIc/app/src/main/assets/index.html

- name: Set up JDK 17        # temurin
- name: Set up Gradle 8.7

- name: Run Unit Tests & Assemble APK
  working-directory: public/android/HeretIc
  run: |
    gradle :app:testDebugUnitTest --no-daemon
    gradle :app:assembleDebug --no-daemon
    cp app/build/outputs/apk/debug/app-debug.apk ../../HeretIc.apk

- name: Upload Downloadable HeretIc.apk Artifact
  uses: actions/upload-artifact@v4
  with: { name: HeretIc-unified-apk, retention-days: 30 }`;

const GRADLE_DEPS = `dependencies {
    implementation("com.google.ai.edge.litert:litert:2.3.0")
    // Optional: include for GPU acceleration
    implementation("com.google.ai.edge.litert:litert-gpu:2.3.0")
}`;

const PIPELINE = [
  { step: "01", title: "npm run build", detail: "vite-plugin-singlefile inlines React 19, Tailwind and every icon into one dist/index.html." },
  { step: "02", title: "copy → assets", detail: "dist/index.html becomes app/src/main/assets/index.html inside the Android module." },
  { step: "03", title: "testDebugUnitTest", detail: "11 rule-table assertions must pass — the same ones HereticCoreTest.kt runs." },
  { step: "04", title: "assembleDebug", detail: "Gradle 8.7 on Temurin JDK 17 packages both ABIs and the bundled UI." },
  { step: "05", title: "artifact", detail: "HeretIc-unified-apk uploaded with 30-day retention, or downloaded from the dashboard." },
];

const SAFEGUARDS = [
  { label: "INTERNET permission", value: "not declared", tone: "mint" as const, note: "The compiler itself proves no code path can exfiltrate audio, transcripts or files." },
  { label: "Background services", value: "zero", tone: "mint" as const, note: "No <service>, no <receiver>, no WorkManager initializer — zero idle battery drain." },
  { label: "RECORD_AUDIO", value: "runtime, on tap", tone: "signal" as const, note: "Requested inside the mic button's permission launcher, never at install or boot." },
  { label: "File access", value: "SAF single URI", tone: "signal" as const, note: "ACTION_OPEN_DOCUMENT grants exactly one file; allowFileAccess stays false in the WebView." },
  { label: "Consent ledger", value: "hash-chained", tone: "ember" as const, note: "Every decision stores the previous SHA-256, so silent edits are detectable offline." },
];

export default function LandingPage() {
  const router = useRouter();
  const [bootIndex, setBootIndex] = useState(0);
  const [entering, setEntering] = useState(false);
  const [tab, setTab] = useState<"bridge" | "activity" | "frontend" | "ci">("bridge");
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (bootIndex >= BOOT_LINES.length) return;
    const timer = window.setTimeout(() => setBootIndex((i) => i + 1), bootIndex === 0 ? 420 : 260);
    return () => window.clearTimeout(timer);
  }, [bootIndex]);

  useEffect(() => {
    const interval = window.setInterval(() => setListening((l) => !l), 4200);
    return () => window.clearInterval(interval);
  }, []);

  const snippet = useMemo(
    () =>
      ({
        bridge: BRIDGE_SNIPPET,
        activity: ACTIVITY_SNIPPET,
        frontend: FRONTEND_SNIPPET,
        ci: WORKFLOW_YML,
      })[tab],
    [tab],
  );

  const enterDemo = async () => {
    setEntering(true);
    try {
      await api("/api/auth/demo", { method: "POST" });
      router.push("/dashboard");
      router.refresh();
    } catch {
      router.push("/login");
    } finally {
      setEntering(false);
    }
  };

  return (
    <div className="relative">
      {/* nav ------------------------------------------------------------- */}
      <header className="sticky top-0 z-40 border-b border-line/80 bg-void/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[86rem] items-center gap-4 px-5 py-3.5">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-ember/40 bg-ember/10 text-ember">
              <Sigil width={18} height={18} />
            </span>
            <span className="font-display text-[15px] font-bold tracking-tight text-chalk">
              HERETIC<span className="text-ember">.ai</span>
            </span>
          </Link>

          <nav className="ml-6 hidden items-center gap-5 lg:flex">
            {[
              ["Workflows", "#workflows"],
              ["Two files", "#compare"],
              ["Integration", "#integration"],
              ["Build", "#build"],
              ["Safeguards", "#safeguards"],
            ].map(([label, href]) => (
              <a
                key={href}
                href={href}
                className="font-mono text-[11px] uppercase tracking-[0.18em] text-ash transition hover:text-embersoft"
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Link href="/login">
              <Button variant="ghost" size="sm">
                Sign in
              </Button>
            </Link>
            <Button variant="primary" size="sm" loading={entering} onClick={enterDemo} icon={<Play width={13} height={13} />}>
              Enter demo workspace
            </Button>
          </div>
        </div>
      </header>

      {/* hero ------------------------------------------------------------ */}
      <section className="relative mx-auto max-w-[86rem] px-5 pb-16 pt-14 lg:pt-20">
        <div className="grid items-start gap-12 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div className="mb-6 flex flex-wrap items-center gap-2">
              <Badge tone="ember" dot>
                offline · on-device
              </Badge>
              <Badge tone="mint">no INTERNET permission</Badge>
              <Badge tone="neutral">ai.heretic.app · v2.3.0</Badge>
            </div>

            <Scramble
              as="h1"
              text="YOUR PHONE ALREADY"
              className="font-display text-[clamp(2.2rem,6.2vw,4.4rem)] font-bold uppercase leading-[0.94] tracking-[-0.03em] text-chalk"
              speed={26}
            />
            <h1 className="font-display text-[clamp(2.2rem,6.2vw,4.4rem)] font-bold uppercase leading-[0.94] tracking-[-0.03em]">
              <span className="text-ember">HAS EVERYTHING</span>{" "}
              <span className="text-chalk/45">A JARVIS NEEDS.</span>
            </h1>

            <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-ash">
              Heretic.ai is a full-stack, offline Alfred for Android: one React command center compiled to a single
              HTML file, wrapped around a native Kotlin core with real speech recognition, real text-to-speech, real
              Storage Access Framework picks and a LiteRT inference stack — assembled into one installable APK.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button variant="primary" size="lg" loading={entering} onClick={enterDemo} icon={<Bolt width={15} height={15} />}>
                Boot the command center
              </Button>
              <Link href="#integration">
                <Button size="lg" variant="outline" icon={<Terminal width={15} height={15} />}>
                  Read the integration
                </Button>
              </Link>
              <Link href="/register">
                <Button size="lg" variant="ghost">
                  Create an operator account <Arrow width={14} height={14} />
                </Button>
              </Link>
            </div>

            <dl className="mt-10 grid max-w-2xl grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
              {[
                { k: "network calls", v: 0 },
                { k: "background services", v: 0 },
                { k: "core workflows", v: 6 },
                { k: "embedded sources", v: 20 },
              ].map((stat) => (
                <div key={stat.k} className="bg-panel/80 px-4 py-3.5">
                  <dt className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-ash2">{stat.k}</dt>
                  <dd className="mt-1 font-display text-2xl font-semibold text-ember">
                    <CountUp value={stat.v} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* device ------------------------------------------------------ */}
          <div className="lg:col-span-5">
            <Reveal>
              <Panel className="relative overflow-hidden p-0" glow>
                <div className="relative aspect-[4/5] w-full overflow-hidden sm:aspect-[5/5]">
                  <KenBurns src="/images/hero-device.jpg" alt="HeretIc running on an Android device" />
                  <div className="absolute inset-0 bg-gradient-to-t from-void via-void/25 to-transparent" />
                  <div className="absolute inset-x-0 top-0 h-24 animate-scan bg-gradient-to-b from-transparent via-ember/10 to-transparent" />

                  <div className="absolute left-4 top-4 flex flex-col gap-2">
                    <Badge tone="mint" dot>
                      stt live
                    </Badge>
                    <Badge tone="ember">tts · piper
                    </Badge>
                  </div>

                  <div className="absolute inset-x-4 bottom-4 rounded-lg border border-line2 bg-abyss/85 p-3 backdrop-blur-md">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ash2">voice pipeline</span>
                      <button
                        type="button"
                        onClick={() => setListening((l) => !l)}
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-full border transition",
                          listening ? "border-ember bg-ember/20 text-ember" : "border-line2 text-ash hover:text-chalk",
                        )}
                        aria-label={listening ? "Stop listening demo" : "Start listening demo"}
                      >
                        <Mic width={14} height={14} />
                      </button>
                    </div>
                    <Waveform active={listening} level={listening ? 0.4 : 0} />
                    <p className="mt-1 font-mono text-[11px] text-ash">
                      {listening ? "“why does the gpu delegate fail on mali?”" : "tap the mic — transcript stays on device"}
                    </p>
                  </div>
                </div>
              </Panel>
            </Reveal>
          </div>
        </div>

        {/* boot terminal ------------------------------------------------- */}
        <Reveal delay={80}>
          <Panel className="mt-12 overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line bg-panel2/60 px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-signal/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-mint/70" />
              <span className="ml-3 font-mono text-[10.5px] uppercase tracking-[0.2em] text-ash2">
                adb logcat -s Heretic · cold boot
              </span>
              <span className="ml-auto font-mono text-[10.5px] text-ash2">pid 14207</span>
            </div>
            <div className="space-y-1 px-4 py-4 font-mono text-[12px] leading-relaxed sm:text-[12.5px]">
              {BOOT_LINES.slice(0, bootIndex).map((line, index) => (
                <p key={line} className="flex gap-3">
                  <span className="select-none text-ash2/60">{String(index + 1).padStart(2, "0")}</span>
                  <span className={cn(index === BOOT_LINES.length - 1 ? "text-mint" : "text-ash")}>
                    {index === bootIndex - 1 ? <TypeOut text={line} cps={190} /> : line}
                  </span>
                </p>
              ))}
              {bootIndex >= BOOT_LINES.length ? (
                <p className="flex gap-3 text-embersoft">
                  <span className="select-none text-ash2/60">›</span>
                  <span className="caret">_</span>
                </p>
              ) : null}
            </div>
          </Panel>
        </Reveal>
      </section>

      {/* marquee --------------------------------------------------------- */}
      <div className="relative overflow-hidden border-y border-line bg-abyss/60 py-3">
        <div className="marquee-track flex w-max gap-10 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.26em] text-ash2">
          {Array.from({ length: 2 }).map((_, dup) => (
            <span key={dup} className="flex gap-10">
              {[
                "SpeechRecognizer",
                "Vosk fallback",
                "Whisper-tiny int8",
                "Piper TTS",
                "LiteRT 2.3.0",
                "litert-gpu 2.3.0",
                "Jetpack Compose",
                "WebView bridge",
                "SAF OpenDocument",
                "R8 keep rules",
                "Gradle 8.7",
                "Temurin JDK 17",
                "hash-chained audit",
                "zero background drain",
              ].map((word) => (
                <span key={word} className="flex items-center gap-10">
                  <Spark width={12} height={12} className="text-ember/60" />
                  {word}
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>

      {/* workflows ------------------------------------------------------- */}
      <section id="workflows" className="mx-auto max-w-[86rem] scroll-mt-20 px-5 py-20">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.28em] text-ember/85">shared functional modules</p>
              <h2 className="max-w-2xl font-display text-[clamp(1.8rem,3.6vw,2.9rem)] font-semibold leading-[1.05] tracking-tight text-balance">
                Six workflows, implemented twice — once in React, once in Kotlin.
              </h2>
            </div>
            <p className="max-w-sm text-sm leading-relaxed text-ash">
              Both frontends call the same deterministic rule tables, so the browser build and the APK answer
              identically. The web UI is the daily driver; Compose stays available behind a toggle.
            </p>
          </div>
        </Reveal>

        <div className="mt-10 grid gap-4 lg:grid-cols-6">
          {WORKFLOWS.map((workflow, index) => (
            <Reveal key={workflow.key} delay={index * 60} className={cn(workflow.span, "min-w-0")}>
              <Panel className="group h-full overflow-hidden p-5 transition-colors duration-300 hover:border-ember/35">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-md border border-line2 bg-panel2 text-ember transition-colors group-hover:border-ember/45 group-hover:bg-ember/10">
                    {workflow.icon}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ash2">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="mt-4 font-display text-[17px] font-semibold tracking-tight text-chalk">{workflow.title}</h3>
                <p className="mt-1 font-mono text-[10.5px] text-ash2">{workflow.files}</p>
                <p className="mt-3 text-[13.5px] leading-relaxed text-ash">{workflow.body}</p>
                <pre className="mt-4 overflow-x-auto rounded-md border border-line bg-abyss/80 p-3 font-mono text-[11.5px] leading-relaxed text-mint/85">
                  {workflow.sample}
                </pre>
              </Panel>
            </Reveal>
          ))}
        </div>
      </section>

      {/* two files ------------------------------------------------------- */}
      <section id="compare" className="mx-auto max-w-[86rem] scroll-mt-20 px-5 py-16">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <div className="lg:sticky lg:top-24">
              <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.28em] text-ember/85">comparison</p>
              <h2 className="font-display text-[clamp(1.7rem,3vw,2.5rem)] font-semibold leading-[1.06] tracking-tight">
                Two files.
                <br />
                <span className="text-ash2">One APK.</span>
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-ash">
                File 1 is the human-readable source — the React command center plus the complete Kotlin project
                embedded beneath <span className="font-mono text-embersoft">public/android/HeretIc/</span>. File 2 is
                what that source becomes: a compiled package of Dalvik bytecode.
              </p>
              <div className="mt-6 space-y-2">
                {[
                  ["File 1", "source of truth", "text"],
                  ["File 2", "compiled output", "binary"],
                ].map(([label, value, kind]) => (
                  <div key={label} className="flex items-center gap-3 rounded-md border border-line bg-panel/60 px-3 py-2.5">
                    <span className={cn("h-8 w-8 rounded border", kind === "text" ? "border-ember/40 bg-ember/10" : "border-line2 bg-panel2")} />
                    <div>
                      <p className="font-display text-[13px] font-semibold text-chalk">{label}</p>
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ash2">{value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4 lg:col-span-8">
            <Reveal>
              <Panel className="p-6">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge tone="ember">file 1 · source</Badge>
                  <h3 className="font-display text-lg font-semibold tracking-tight">
                    HERETIC.ai Web Command Center + Embedded Android Source
                  </h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-ash">
                  A React 19 + Vite + Tailwind application configured with <span className="font-mono text-embersoft">vite-plugin-singlefile</span>.
                  Inside its <span className="font-mono text-embersoft">public/android/HeretIc/</span> directory — and bundled into{" "}
                  <span className="font-mono text-embersoft">src/androidSources.ts</span> — sits the complete, compilable source of the
                  native app <span className="font-mono text-chalk">ai.heretic.app</span> in Kotlin and Jetpack Compose.
                </p>
                <ul className="mt-5 grid gap-2 sm:grid-cols-2">
                  {[
                    "ChatInterface.tsx ↔ ChatScreen + VoiceManager.kt",
                    "ErrorAnalyzer.tsx ↔ ErrorEngine.kt",
                    "FileAssessor.tsx ↔ FileAssessor.kt",
                    "GitHubProgress.tsx ↔ RepoAssessor.kt",
                    "AuthorizationGates.tsx ↔ AuthorizationGate.kt",
                    "DecisionLog.tsx ↔ DecisionLogger.kt",
                  ].map((pair) => (
                    <li key={pair} className="flex items-start gap-2 rounded-md border border-line bg-abyss/50 px-3 py-2 font-mono text-[11.5px] text-ash">
                      <Check width={13} height={13} className="mt-0.5 shrink-0 text-mint" />
                      {pair}
                    </li>
                  ))}
                </ul>
              </Panel>
            </Reveal>

            <Reveal delay={60}>
              <Panel className="p-6">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge tone="ice">file 2 · binary</Badge>
                  <h3 className="font-display text-lg font-semibold tracking-tight">Compiled Android APK (classes.dex → classes13.dex)</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-ash">
                  An application package containing Dalvik Executable bytecode across thirteen dex files plus{" "}
                  <span className="font-mono text-embersoft">META-INF/com/android/build/gradle/app-metadata.properties</span>. It is the
                  artifact the source produces — not something you edit by hand.
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {[
                    { k: "readable", v: "no", note: "dex bytecode" },
                    { k: "installable", v: "yes", note: "adb install -r" },
                    { k: "derivable", v: "yes", note: "from file 1 via CI" },
                  ].map((cell) => (
                    <div key={cell.k} className="rounded-md border border-line bg-abyss/50 px-3 py-3">
                      <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-ash2">{cell.k}</p>
                      <p className="mt-1 font-display text-base font-semibold text-chalk">{cell.v}</p>
                      <p className="font-mono text-[10px] text-ash2">{cell.note}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 border-l-2 border-ember/50 pl-3 text-[13px] leading-relaxed text-ash">
                  Because the React UI compiles to a single self-contained <span className="font-mono text-embersoft">dist/index.html</span>,
                  that exact frontend can be embedded inside the APK and bridged to the native Kotlin backend — keeping the command
                  center you already use while gaining real Android speech, storage and inference APIs.
                </p>
              </Panel>
            </Reveal>
          </div>
        </div>
      </section>

      {/* integration ----------------------------------------------------- */}
      <section id="integration" className="mx-auto max-w-[86rem] scroll-mt-20 px-5 py-16">
        <Reveal>
          <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.28em] text-ember/85">step by step</p>
          <h2 className="max-w-3xl font-display text-[clamp(1.8rem,3.4vw,2.7rem)] font-semibold leading-[1.06] tracking-tight text-balance">
            Integrate both into a single Android application without harming the device.
          </h2>
        </Reveal>

        <div className="relative mt-10 grid gap-5 md:grid-cols-3 md:gap-6">
          <span className="pointer-events-none absolute left-6 right-6 top-[3.1rem] hidden h-px bg-gradient-to-r from-ember/50 via-ember/20 to-transparent md:block" />
          {[
            {
              n: "1",
              t: "Bundle the web frontend into assets",
              d: "npm run build compiles React, Tailwind and every icon into one dist/index.html, which is copied to app/src/main/assets/index.html.",
              code: "cp dist/index.html app/src/main/assets/",
              offset: "md:mt-0",
            },
            {
              n: "2",
              t: "Create the @JavascriptInterface bridge",
              d: "HereticCore and VoiceManager are exposed as window.HereticNative, so every button in the React UI drives a real Android API.",
              code: "addJavascriptInterface(bridge, \"HereticNative\")",
              offset: "md:mt-8",
            },
            {
              n: "3",
              t: "Preserve hardware & privacy safeguards",
              d: "No background services, no boot receivers, RECORD_AUDIO requested only at tap time, and file reads through a single SAF URI grant.",
              code: "<uses-permission android:name=\"android.permission.INTERNET\" />  // absent",
              offset: "md:mt-16",
            },
          ].map((step, index) => (
            <Reveal key={step.n} delay={index * 90} className={step.offset}>
              <Panel className="group h-full p-5 transition-colors hover:border-ember/35">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-md border border-ember/40 bg-void font-display text-[15px] font-bold text-ember transition-colors group-hover:bg-ember/15">
                    {step.n}
                  </span>
                  <span className="h-px flex-1 bg-line" />
                </div>
                <h3 className="mt-4 font-display text-[15px] font-semibold leading-snug tracking-tight text-chalk">{step.t}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-ash">{step.d}</p>
                <p className="mt-3 overflow-x-auto rounded border border-line bg-abyss/70 px-2.5 py-2 font-mono text-[11px] text-mint/85">
                  {step.code}
                </p>
              </Panel>
            </Reveal>
          ))}
        </div>

        <Reveal delay={80}>
          <Panel className="mt-6 overflow-hidden">
            <div className="flex flex-wrap items-center gap-1 border-b border-line bg-panel2/50 px-3 py-2">
              {[
                ["bridge", "WebBridge.kt"],
                ["activity", "MainActivity.kt"],
                ["frontend", "types + ChatInterface.tsx"],
                ["ci", "android.yml"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key as typeof tab)}
                  className={cn(
                    "rounded px-3 py-1.5 font-mono text-[11px] transition",
                    tab === key ? "bg-ember/15 text-embersoft" : "text-ash2 hover:text-chalk",
                  )}
                >
                  {label}
                </button>
              ))}
              <span className="ml-auto flex items-center gap-2 pr-1">
                <Copy width={12} height={12} className="text-ash2" />
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ash2">editable in the dashboard</span>
              </span>
            </div>
            <pre className="max-h-[26rem] overflow-auto px-4 py-4 font-mono text-[12px] leading-[1.65] text-ash">
              <code>{snippet}</code>
            </pre>
          </Panel>
        </Reveal>
      </section>

      {/* build ----------------------------------------------------------- */}
      <section id="build" className="mx-auto max-w-[86rem] scroll-mt-20 px-5 py-16">
        <div className="grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Reveal>
              <div className="relative overflow-hidden rounded-xl border border-line">
                <div className="aspect-[16/10] w-full">
                  <KenBurns src="/images/pipeline-core.jpg" alt="Silicon core representing the on-device inference stack" duration={28} />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-void via-void/40 to-transparent" />
                <div className="absolute inset-x-5 bottom-5">
                  <Badge tone="mint" dot>
                    inference runtime
                  </Badge>
                  <p className="mt-3 font-display text-lg font-semibold tracking-tight text-chalk">LiteRT 2.3.0 + GPU delegate</p>
                </div>
              </div>
            </Reveal>

            <Reveal delay={60}>
              <Panel className="mt-4 p-5">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-ash2">app/build.gradle.kts</p>
                <pre className="mt-3 overflow-x-auto rounded-md border border-line bg-abyss/80 p-3 font-mono text-[12px] leading-relaxed text-mint/90">
                  {GRADLE_DEPS}
                </pre>
                <p className="mt-3 text-[13px] leading-relaxed text-ash">
                  The delegate is probed once per install and cached. When OpenCL is unavailable — emulators, some Mali
                  drivers — the interpreter falls back to four CPU threads instead of crashing.
                </p>
              </Panel>
            </Reveal>
          </div>

          <div className="lg:col-span-7">
            <Reveal>
              <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.28em] text-ember/85">automated build workflow</p>
              <h2 className="font-display text-[clamp(1.6rem,3vw,2.3rem)] font-semibold leading-tight tracking-tight">
                From <span className="font-mono text-embersoft">npm run build</span> to a downloadable{" "}
                <span className="font-mono text-embersoft">HeretIc.apk</span>.
              </h2>
            </Reveal>

            <ol className="mt-7 space-y-0">
              {PIPELINE.map((step, index) => (
                <Reveal key={step.step} delay={index * 60}>
                  <li className="group relative flex gap-4 pb-6">
                    {index < PIPELINE.length - 1 ? (
                      <span className="absolute left-[15px] top-8 h-full w-px bg-gradient-to-b from-ember/45 to-line" />
                    ) : null}
                    <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line2 bg-panel font-mono text-[11px] text-ember transition-colors group-hover:border-ember/50">
                      {step.step}
                    </span>
                    <div className="min-w-0 flex-1 rounded-lg border border-line bg-panel/50 px-4 py-3 transition-colors group-hover:border-line2">
                      <p className="font-display text-[14px] font-semibold tracking-tight text-chalk">{step.title}</p>
                      <p className="mt-1 text-[13px] leading-relaxed text-ash">{step.detail}</p>
                    </div>
                  </li>
                </Reveal>
              ))}
            </ol>

            <Reveal>
              <Panel className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div>
                  <p className="font-display text-[15px] font-semibold text-chalk">Run it yourself</p>
                  <p className="mt-1 font-mono text-[12px] text-ash">
                    cd public/android/HeretIc && ./gradlew :app:assembleDebug
                  </p>
                </div>
                <Link href="/dashboard/android">
                  <Button variant="primary" icon={<Droid width={15} height={15} />}>
                    Open the build pipeline <Chevron width={14} height={14} />
                  </Button>
                </Link>
              </Panel>
            </Reveal>
          </div>
        </div>
      </section>

      {/* safeguards ------------------------------------------------------ */}
      <section id="safeguards" className="mx-auto max-w-[86rem] scroll-mt-20 px-5 py-16">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.28em] text-ember/85">strict safeguards</p>
              <h2 className="font-display text-[clamp(1.7rem,3.2vw,2.5rem)] font-semibold leading-tight tracking-tight">
                Privacy enforced by the build, not by a policy page.
              </h2>
            </div>
            <Badge tone="mint" dot>
              ledger verified
            </Badge>
          </div>
        </Reveal>

        <div className="mt-8 overflow-hidden rounded-xl border border-line">
          {SAFEGUARDS.map((item, index) => (
            <Reveal key={item.label} delay={index * 50}>
              <div
                className={cn(
                  "grid gap-3 border-line bg-panel/50 px-5 py-4 transition-colors hover:bg-panel sm:grid-cols-[16rem_12rem_1fr] sm:items-center",
                  index > 0 && "border-t",
                )}
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ash">{item.label}</p>
                <Badge tone={item.tone}>{item.value}</Badge>
                <p className="text-[13px] leading-relaxed text-ash2">{item.note}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* cta ------------------------------------------------------------- */}
      <section className="mx-auto max-w-[86rem] px-5 pb-20 pt-6">
        <Reveal>
          <Panel className="relative overflow-hidden p-8 sm:p-12" glow>
            <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-ember/20 blur-[100px]" />
            <div className="relative flex flex-wrap items-end justify-between gap-8">
              <div className="max-w-xl">
                <h2 className="font-display text-[clamp(1.7rem,3.4vw,2.6rem)] font-semibold leading-[1.05] tracking-tight">
                  The workspace is already seeded. Walk in.
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-ash">
                  Four conversations, six error cases with paste-back verdicts, ten assessed files, three tracked
                  repositories with graded milestones, a five-entry authorization ledger and eight decisions with their
                  reasoning sentences — plus the whole embedded Android project.
                </p>
                <p className="mt-4 font-mono text-[12px] text-ash2">
                  demo · operator@heretic.ai / heretic-offline
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button variant="primary" size="lg" loading={entering} onClick={enterDemo} icon={<Gauge width={15} height={15} />}>
                  Enter demo workspace
                </Button>
                <Link href="/register">
                  <Button size="lg" variant="outline" icon={<Lock width={15} height={15} />}>
                    Create account
                  </Button>
                </Link>
              </div>
            </div>
            <div className="relative mt-10 flex flex-wrap items-center gap-6 border-t border-line pt-6 font-mono text-[10.5px] uppercase tracking-[0.18em] text-ash2">
              <span className="flex items-center gap-2">
                <Layers width={13} height={13} /> six workflows
              </span>
              <span className="flex items-center gap-2">
                <Terminal width={13} height={13} /> kotlin + react
              </span>
              <span className="flex items-center gap-2">
                <Droid width={13} height={13} /> one apk
              </span>
              <span className="ml-auto">© {new Date().getFullYear()} heretic.ai</span>
            </div>
          </Panel>
        </Reveal>
      </section>
    </div>
  );
}
