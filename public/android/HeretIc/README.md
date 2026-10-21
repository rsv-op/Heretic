# HeretIc — unified offline Android build

One repository, two frontends, one brain.

| Layer | Where | Notes |
| --- | --- | --- |
| Web command center | `dist/index.html` | React 19 + Vite 8 + Tailwind 4, single file (~1.08 MB); PGlite ships as split `.wasm`/`.data` assets |
| Native UI fallback | `app/src/main/java/ai/heretic/app/ui/HereticApp.kt` | Jetpack Compose, same six workflows |
| Brain | `core/HereticCore.kt` | Rule tables mirrored in `src/lib/engines.ts` |
| Voice | `voice/VoiceManager.kt` | SpeechRecognizer + TextToSpeech, Vosk/Piper fallbacks |
| Inference (`.tflite`) | `ml/LiteRtEngine.kt` | LiteRT 2.3.0 + litert-gpu 2.3.0 |
| Inference (`.litertlm`) | `ml/LiteRtLmEngine.kt` | litertlm-android 0.18.0, Gemma 4 E2B default / Gemma 3n E2B fallback |

## Build locally

```bash
cd webui
npm ci && npm run typecheck && npm run build
# index.html plus the split PGlite runtime, served by WebViewAssetLoader
rm -f ../public/android/HeretIc/app/src/main/assets/*.{js,wasm,data}
cp dist/* ../public/android/HeretIc/app/src/main/assets/
cd ../public/android/HeretIc
./gradlew :app:testDebugUnitTest
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Bridge contract

The WebView exposes `window.HereticNative`:

```ts
reply(prompt: string): string            // JSON CoreReply
analyzeError(rawLog: string): string     // JSON WHAT/WHY/REQUEST SOLUTION
confirmSolution(pasteBack: string): string
assessFile(fileName: string): string
speak(text: string): void
triggerMic(): void
triggerFilePicker(): void
voiceStatus(): string                   // JSON: offline speech packs + TTS voice data
modelStatus(): string                   // JSON: ABI, RAM, .litertlm catalog
triggerModelPicker(): void              // ACTION_OPEN_DOCUMENT -> filesDir/models
isArm64Device(): boolean
deviceRamMb(): number
```

Native → web events: `heretic-stt`, `heretic-stt-error`, `heretic-file-picked`,
`heretic-model`, `heretic-model-progress`, `heretic-model-error`.

## Safeguards

* No `INTERNET` permission is declared — the APK cannot reach a network.
* No `<service>`, no `<receiver>`, no WorkManager: zero background drain.
* `RECORD_AUDIO` is requested only when the mic is tapped, and every decision is
  written to the hash-chained authorization ledger.
* Files arrive through `ACTION_OPEN_DOCUMENT`; exactly one URI grant, never a
  directory. `allowFileAccess = false` in the WebView, which is why the page is served
  from `https://appassets.androidplatform.net/assets/` through `WebViewAssetLoader`.
* `.litertlm` weights are streamed into `filesDir/models/` (`.part` file, free-space
  check, truncation check) and never packaged into the APK.
* `litertlm-android` 0.18.0 ships `arm64-v8a`/`x86_64` only; `isArm64Device()` refuses
  other ABIs before the native library loads.
