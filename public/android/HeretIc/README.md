# Heretic Android 16 Native Module (`public/android/HeretIc`)

Canonical pure-native Android 16 (`compileSdk = 36`, `targetSdk = 36`, `minSdk = 26`, `arm64-v8a`) Gradle project for **Heretic Voice Assistant**.

## Voice Activation & Interrupt Contract

- **Wake Word — `"HERETIC"`**: Spoken alone (`"Heretic"`, `"Hey Heretic"`) or prefixed to any command (`"Heretic, system status"`), `WakeWordDetector` + `WakeWordSessionGate` wake hands-free Parakeet TDT capture, open a `20s` active follow-up window, and strip the wake prefix before routing to `VoiceActionRouter`, `llama.cpp`, `LiteRT-LM`, or `HereticCore`.
- **Emergency Interrupt — `"SHAZ"`**: Saying `"shaz"` (or speaking over playback via embedded `Silero VAD v6`) bypasses standby and immediately pauses + flushes `PcmStreamingAudioPlayer` (`AudioTrack`), cancelling active LLM/TTS generation.

## Architecture & Build Guarantees

- **Zero Network & Zero Background Work**: `AndroidManifest.xml` declares only `android.permission.RECORD_AUDIO` — zero `INTERNET`, zero `<service>`, zero `<receiver>`, and Gradle excludes `androidx.work`.
- **Zero WebUI (`verifyVoiceAssets`)**: Gradle task `verifyVoiceAssets` verifies `src/main/assets/silero_vad.onnx` exists and fails the build if any `index.html`, `.js`, `.css`, or `.wasm` file is placed in `assets/`.
- **Native Runtimes**:
  - `CMakeLists.txt` (`3.22.1`, NDK `27.2.12479018`, 16 KB ELF page alignment) compiles `llama_jni.cpp` linked against `llama` + `ggml` (`GGML_OPENMP=OFF`, `GGML_LLAMAFILE=OFF`).
  - `com.microsoft.onnxruntime:onnxruntime-android:1.20.0` runs embedded `Silero VAD v6`, `Parakeet TDT INT8` STT (`org.schabi.parakeetype.*`), and `Supertonic` TTS (`com.brahmadeo.supertonic.tts.*`).
  - `com.google.ai.edge.litert:litert:2.3.0` + `litert-gpu:2.3.0` + `litertlm-android:0.18.0` validate `TFL3` v3 FlatBuffer headers and probe GPU with cached 4-thread CPU fallback.

## Build & Test

```bash
# Ensure llama.cpp sources are present at app/src/main/cpp/llama.cpp
git clone --depth 1 https://github.com/ggml-org/llama.cpp.git \
  app/src/main/cpp/llama.cpp

# Run unit tests and assemble the ARM64 APK
gradle :app:testDebugUnitTest :app:assembleDebug
```
