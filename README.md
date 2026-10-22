# HeretIc

Personal, offline **Android 16** AI command center. One repository, two frontends, one
brain: a single-file React command center served inside a WebView, a Jetpack Compose
fallback, and a native Kotlin core. **No `INTERNET` permission is declared**, so the APK
physically cannot reach a network.

| Layer | Where | Notes |
| --- | --- | --- |
| Web command center | `webui/` → `dist/index.html` | React 19 + Vite 8 + Tailwind 4, single HTML file |
| Native UI fallback | `public/android/HeretIc/app/src/main/java/ai/heretic/app/ui/HereticApp.kt` | Jetpack Compose, same workflows |
| Brain | `core/HereticCore.kt` | Deterministic rule tables, mirrored in `webui/src/lib/engines.ts` |
| Voice | `voice/VoiceManager.kt` | SpeechRecognizer + TextToSpeech, main-looper bound, offline-only |
| Inference | `ml/LiteRtEngine.kt`, `ml/LiteRtLmEngine.kt` | LiteRT 2.3.0 for `.tflite`; LiteRT-LM 0.18.0 for `.litertlm` |
| APK pipeline | `.github/workflows/android.yml` | Builds the web UI, runs unit tests, assembles `HeretIc.apk` |

## Upgrades applied

### 1. LiteRT-LM 0.18.0 with Gemma 4 E2B → Gemma 3n E2B fallback

`com.google.ai.edge.litertlm:litertlm-android:0.18.0` is now a direct dependency and
`ml/LiteRtLmEngine.kt` owns the whole weight lifecycle:

* **Model catalog** (`LiteRtLmModels`): Gemma 4 E2B (`gemma-4-e2b-it-int4.litertlm`,
  ~2.58 GB) is the default on devices with **6 GB+ RAM**; Gemma 3n E2B
  (`gemma-3n-e2b-it-int4.litertlm`, ~1.48 GB) is the automatic fallback.
* **Upfront ABI gate**: `LiteRtLmEngine.isArm64Device()` runs before any native library
  is touched. `litertlm-android` 0.18.0 only ships `arm64-v8a`/`x86_64`, and
  `ndk { abiFilters }` matches that, so a 32-bit device gets a readable error instead of
  `UnsatisfiedLinkError`.
* **Sideload flow**: `ACTION_OPEN_DOCUMENT` → `copyUriToModelsDir()` streams the picked
  URI into `context.filesDir/models/` through a `.part` file with a 1 MiB buffer, a
  free-space budget (size + 5% + 64 MB) and a truncation check. Weights are **never**
  bundled in the APK.
* **Runtime**: `Engine(EngineConfig(modelPath, backend = Backend.CPU(), cacheDir))` is
  initialised on `Dispatchers.IO`, conversations are created per turn, and the engine is
  closed in `onDispose`.
* `INTERNET` is still deliberately absent from `AndroidManifest.xml`.

### 2. Dependencies

Android: `litertlm-android` **0.18.0**, `litert` **2.3.0**, `litert-gpu` **2.3.0**,
Kotlin **2.4.0**, AGP **8.6.1**, `compileSdk`/`targetSdk` **36**, `androidx.webkit` 1.12.1.

Web: Vite **8.3.5**, TypeScript **7.0.2**, PGlite **0.5.11** (plus the peer-compatible
`@vitejs/plugin-react` 6.1.2, `vite-plugin-singlefile` 2.3.4, `drizzle-orm` 0.45.4).

TypeScript 7 removed `baseUrl`, so `webui/tsconfig.json` now uses `paths` alone.

### 3. Voice threading and offline checks

`VoiceManager` creates and drives `SpeechRecognizer` and `TextToSpeech` exclusively on
`Handler(Looper.getMainLooper())`, so calls from the WebView's `JavascriptInterface`
thread no longer throw or get dropped. Recognition requests set
`RecognizerIntent.EXTRA_PREFER_OFFLINE = true`, and `voiceStatusJson()` reports:

`stt`, `tts`, `ttsReady`, `recognizerAvailable`, `onDeviceRecognizerAvailable`,
`preferOffline`, `offlineSpeechPacks`, `ttsEngineName`, `ttsLanguage`,
`ttsLanguageAvailable`, `ttsVoiceCount`, `ttsVoices`, `ttsError`, `lastError`,
`internetPermission: false`.

The bridge exposes it as `HereticNative.voiceStatus()`; native → web events
(`heretic-stt`, `heretic-stt-error`, `heretic-file-picked`, `heretic-model*`) are all
posted to the main looper before `evaluateJavascript`.

### 4. Web bundle: 53.1 MB → 1.08 MB

`npm run build` used to inline the PGlite/Postgres WebAssembly as base64 into
`dist/index.html` — a **53.1 MB** single file. Now:

* `webui/src/db/index.ts` imports PGlite **dynamically**, and `vite.config.ts` pins it to
  its own chunk (`pglite-*.js`, `pglite-*.wasm`, `pglite-*.data`).
* Only the entry script and the stylesheet are inlined, so `dist/index.html` is
  **1.08 MB**.
* Both landing images (`hero-device`, `pipeline-core`) are imported and inlined as base64
  data URIs — no `/images/*` request survives the build.
* The APK serves `index.html` and the split runtime from
  `https://appassets.androidplatform.net/assets/` via `WebViewAssetLoader`, which keeps
  `allowFileAccess = false` while still allowing ES-module imports and WASM streaming.
  The wasm/data ship as real files and are zip-compressed inside the APK instead of
  being base64-inflated by 33%.
* `FileAssessor` grades `.litertlm` as **WORKS (99%)** in both Kotlin and
  `webui/src/lib/engines.ts`, and the dashboard's Android build screen has a
  `.litertlm` loader panel wired to `HereticNative.triggerModelPicker()`.

## Build

```bash
cd webui
npm ci && npm run typecheck && npm run build

# stage the web bundle next to the Android assets
rm -f ../public/android/HeretIc/app/src/main/assets/*.{js,wasm,data}
cp dist/* ../public/android/HeretIc/app/src/main/assets/

cd ../public/android/HeretIc
gradle :app:testDebugUnitTest
gradle :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

CI does exactly this on every push to an `arena/**` branch or `main`, uploads the
`HeretIc-unified-apk` artifact, and publishes a GitHub Release when `main` builds.

## Sideloading a model

1. Copy `gemma-4-e2b-it-int4.litertlm` (or `gemma-3n-e2b-it-int4.litertlm`) to the device.
2. Open HeretIc → **Android** → **Import .litertlm**, pick the file.
3. Watch `heretic-model-progress`; the import ends with state `copied` and then `ready`.
4. No network is involved at any point.

## Safeguards

* No `INTERNET` permission, no `<service>`, no `<receiver>`, no WorkManager.
* `RECORD_AUDIO` is requested only when the mic is tapped; every grant is written to the
  hash-chained authorization ledger.
* Files arrive through `ACTION_OPEN_DOCUMENT` — one URI grant, never a directory.
* Unsupported ABIs are refused with a clear message before native code loads.
