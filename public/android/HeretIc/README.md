# HeretIc — unified offline Android build

One repository, two frontends, one brain.

| Layer | Where | Notes |
| --- | --- | --- |
| Web command center | `dist/index.html` | React 19 + Vite + Tailwind, bundled to a single file by `vite-plugin-singlefile` |
| Native UI fallback | `app/src/main/java/ai/heretic/app/ui/HereticApp.kt` | Jetpack Compose, same six workflows |
| Brain | `core/HereticCore.kt` | Rule tables mirrored in `src/lib/engines.ts` |
| Voice | `voice/VoiceManager.kt` | SpeechRecognizer + TextToSpeech, Vosk/Piper fallbacks |
| Inference | `ml/LiteRtEngine.kt` | LiteRT 2.3.0 with optional GPU delegate |

## Build locally

```bash
npm ci && npm run build
cp dist/index.html public/android/HeretIc/app/src/main/assets/index.html
cd public/android/HeretIc
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
```

Native → web events: `heretic-stt`, `heretic-stt-error`, `heretic-file-picked`.

## Safeguards

* No `INTERNET` permission is declared — the APK cannot reach a network.
* No `<service>`, no `<receiver>`, no WorkManager: zero background drain.
* `RECORD_AUDIO` is requested only when the mic is tapped, and every decision is
  written to the hash-chained authorization ledger.
* Files arrive through `ACTION_OPEN_DOCUMENT`; exactly one URI grant, never a
  directory. `allowFileAccess = false` in the WebView.
