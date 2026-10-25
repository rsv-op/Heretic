# Heretic — Sovereign Native Voice Assistant for Android 16

`Heretic` began with a strict premise: a voice assistant on your own device should not own a socket, a browser wrapper, or an unaudited action path.

Most mobile assistants stream raw microphone audio to remote servers or wrap a Chromium `WebView` around cloud endpoints. `Heretic` takes the opposite route. `AndroidManifest.xml` declares **zero `INTERNET` permission**, **zero `<service>` entries**, **zero `<receiver>` entries**, and **zero `WebView` components**. The Android kernel physically forbids the process from opening a network connection, while every microphone capture, file read, and spoken response passes through a local SHA-256 hash-chained authorization ledger.

---

## Goal vs. Achieved

| Engineering Goal | Shipped Implementation | Verified Outcome |
| --- | --- | --- |
| **Air-gapped by OS enforcement, not policy** | `AndroidManifest.xml` omits `INTERNET` & `ACCESS_NETWORK_STATE`; Gradle excludes `androidx.work` | Outbound sockets are rejected by the Linux/Android kernel (`EACCES`) |
| **Zero WebUI / zero browser chrome** | Deleted `WebView`, `WebBridge`, `index.html`, and PGlite web runtime; enforced by Gradle `verifyVoiceAssets` + CI APK inspection | Pure Jetpack Compose Material 3 Dark UI (`MainActivity` → `HereticApp`), `83.07 MiB` `arm64-v8a` APK |
| **Instant cold-boot voice & modular neural upgrades** | Built-in `Silero VAD v6` (`assets/silero_vad.onnx`) + `HereticCore` + offline Android speech fallback on first boot; hot-upgrades per slot when neural packs are imported | Works immediately upon install; upgrades STT, Brain, and TTS independently without rebuilding |
| **True in-process neural voice pipeline** | `Parakeet TDT INT8` ONNX STT + `llama.cpp` JNI (`libllama_jni.so` + `ggml`) + `LiteRT-LM 0.18.0` / `LiteRT 2.3.0` + `Supertonic ONNX TTS` | Sentence-streamed token → PCM synthesis into a low-latency `USAGE_ASSISTANT` `AudioTrack` |
| **Sub-millisecond `"shaz"` & VAD barge-in** | Continuous Silero VAD speech monitor + keyword interceptor wired directly to `PcmStreamingAudioPlayer`, `LlamaCppEngine`, and `SupertonicTTS` | Saying `"shaz"` or speaking over playback immediately calls `pause()` + `flush()` and cancels active inference |
| **Hardware-resilient LiteRT 2.3.0 inference** | `LiteRtEngine` + `LiteRtLmEngine` verify `TFL3` v3 FlatBuffer headers upfront, wrap GPU delegate init in `runCatching`, fall back to `4` CPU threads (`setNumThreads(4)`), and cache the resolved backend per install | Emulators and Mali drivers without OpenCL/Vulkan degrade cleanly on the first probe and skip broken GPU probes thereafter |
| **Auditable engineering workflows by voice or touch** | `VoiceActionRouter` + `ErrorEngine` + `FileAssessor` + `RepoAssessor` + `AuthorizationGate` + `DecisionLogger` (`ADR-009`..`ADR-013`) | 35/35 JVM unit tests passing on every push; tamper-evident SHA-256 gate chain and `decisions.jsonl` ADR log |

---

## End-to-End On-Device Signal Path

```text
 16 kHz Mono Mic (AudioRecord)
       │
       ├──► MicScorer (SNR dB + >3 kHz fricative clarity calibration)
       │
       ▼
 Silero VAD v6 (bundled in APK: assets/silero_vad.onnx)
       │  ├─ Speech detected during playback ──► Instant AudioTrack pause() + flush()
       ▼
 Speech-to-Text Tier
   ├─ [Slot 2 Imported] Parakeet TDT Ultra INT8 (encoder / decoder / joiner / nemo128 ONNX)
   └─ [Default Fallback] Android On-Device SpeechRecognizer (EXTRA_PREFER_OFFLINE = true)
       │
       ├──► Keyword == "shaz" ──► Emergency Halt (LLM + ONNX TTS + AudioTrack flush)
       ▼
 VoiceActionRouter & Multi-Tier Brain
   ├─ Deterministic Commands ──► Error Loop · File Assessor · Repo Milestones · SHA-256 Gates · ADRs · .wav Export
   ├─ [Slot 1 GGUF]          ──► llama.cpp JNI (ARM64 NEON) ──► SentenceStreamingBuffer
   ├─ [Slot 1 LiteRT-LM]     ──► Gemma 4 E2B (≥6 GB RAM) / Gemma 3n E2B (<6 GB RAM)
   └─ [Built-in Core]        ──► HereticCore deterministic offline engine
       │
       ▼
 LexiconManager (custom word -> phonetic overrides)
       │
       ▼
 Text-to-Speech Tier
   ├─ [Slot 3 Imported] Supertonic ONNX TTS (duration / text / vector / vocoder + M1..M5, F1..F5 styles)
   └─ [Default Fallback] Android Offline TextToSpeech
       │
       ▼
 PcmStreamingAudioPlayer (AudioTrack · USAGE_ASSISTANT · ENCODING_PCM_16BIT) + WavUtils (.wav RIFF export)
```

---

## Native Interface (`HereticApp.kt`)

`Heretic` boots directly into a six-tab native Jetpack Compose Material 3 Dark interface (`ai.heretic.app.ui.HereticApp`):

1. **Assistant** — Live conversation stream, active tier chips (`STT`, `Brain`, `TTS`), **Hands-Free / Push-to-Talk Mic**, **`SHAZ · Flush`** emergency interrupt button, quick-execution chips, and per-turn `▶ Speak` replay.
2. **Models** — Independent Android 16 Scoped Storage (SAF) importers for:
   - **Slot 1 (Brain):** `.gguf` (`llama.cpp` JNI), `.litertlm` (`LiteRT-LM 0.18.0`), and `.tflite` / `.task` (`LiteRT 2.3.0` + `litert-gpu 2.3.0`, with a one-tap **Reset Cached LiteRT GPU/CPU Backend Probe** control).
   - **Slot 2 (STT):** `parakeet-tdt-stt-models.zip` or folder picker + live **16 kHz Microphone SNR & Fricative Calibration**.
   - **Slot 3 (TTS):** `supertonic-tts-models.zip` or folder picker + `M1`–`M5` / `F1`–`F5` speaker presets, speed (`0.80x`–`1.40x`) and diffusion step (`2`–`8`) sliders, custom **Pronunciation Lexicon**, and **`.wav` audio export & playback**.
3. **Errors** — Offline stack-trace and logcat root-cause analyzer (`WHAT / WHY / REQUEST SOLUTION`) with spoken diagnosis and an evidence-gated paste-back confirmation loop (`CHECK PASSED` / `CHECK FAILED` / `AWAITING USER PASTE-BACK`).
4. **Files** — Pre-load file relevance and memory safety inspector (`WORKS`, `PARTIALLY MATCHES`, `NOT RELEVANT`) for `.gguf`, `.litertlm`, `.tflite`, `.onnx`, `.zip`, and `.safetensors` with SAF auto-routing.
5. **Repo** — Weighted engineering milestone evaluator (`IMPLEMENT NOW`, `CHANGES NEEDED`, `DEFER`) that prevents deferred items from inflating release readiness.
6. **Gates & ADR** — Interactive SHA-256 hash-chained capability ledger (`mic.capture`, `tts.speak`, `file.saf.read`) paired with an append-only Architecture Decision Record store (`decisions.jsonl`, enforcing `because` + `≥ 12` words).

---

## Download & Provisioning

### 1. Native Android 16 ARM64 APK
- **Latest Release:** [Releases (`Heretic-Voice-Assistant.apk`)](https://github.com/rsv-op/Heretic/releases/latest)
- **Target Architecture:** `arm64-v8a` (`minSdk = 26`, `targetSdk = 36`, 16 KB ELF page-aligned native libraries)

### 2. Optional Offline Neural Model Pack (`voice-models-v1`)
`Heretic` runs out of the box immediately after installing the APK. To upgrade each tier to full in-process neural inference, download any combination of these verified bundles onto your phone and import them from the **Models** tab:

| Slot | Bundle | Size | SHA-256 |
| --- | --- | --- | --- |
| **1 · Brain (`llama.cpp`)** | [`qwen2.5-0.5b-instruct-q4_k_m.gguf`](https://github.com/rsv-op/Heretic/releases/download/voice-models-v1/qwen2.5-0.5b-instruct-q4_k_m.gguf) | `468.64 MiB` | `74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db` |
| **2 · STT (`Parakeet TDT`)** | [`parakeet-tdt-stt-models.zip`](https://github.com/rsv-op/Heretic/releases/download/voice-models-v1/parakeet-tdt-stt-models.zip) | `604.92 MiB` | `7e84c12d30f5de598069c8f77b36b14ea38de6c193449c5c9e08ba38b2a58436` |
| **3 · TTS (`Supertonic`)** | [`supertonic-tts-models.zip`](https://github.com/rsv-op/Heretic/releases/download/voice-models-v1/supertonic-tts-models.zip) | `254.83 MiB` | `1c231f85a3942fdc263f94b92856d8a753a6ca718f5919fe2a447acae018c9a0` |

---

## Repository Structure

```text
Heretic/
├── public/android/HeretIc/          # Canonical Android 16 ARM64 native project
│   └── app/src/
│       ├── main/assets/             # silero_vad.onnx + SILERO_VAD_LICENSE.txt only
│       ├── main/cpp/                # llama_jni.cpp + CMakeLists.txt (links llama + ggml)
│       ├── main/java/
│       │   ├── ai/heretic/app/      # Compose UI, HereticCore, ErrorEngine, Gates, ADRs, LiteRT
│       │   ├── com/heretic/voice/   # LlamaCppEngine, Orchestrator, AudioTrack, SAF Store
│       │   ├── org/schabi/parakeetype/    # Parakeet TDT ONNX STT, Silero VAD v6, MicScorer
│       │   └── com/brahmadeo/supertonic/  # Supertonic ONNX TTS, LexiconManager, WavUtils
│       └── test/java/               # 35 JVM unit tests (core, LiteRT, voice pipeline, ADRs)
├── scripts/
│   ├── fetch-supertonic-tts.sh      # Fetches & schema-validates Supertonic ONNX TTS assets
│   └── package-voice-models.sh      # Reproducibly builds & SHA-256 verifies all 3 model packs
└── .github/workflows/
    ├── android.yml                  # Runs 35 unit tests, builds & verifies pure-native ARM64 APK
    ├── fetch-voice-models.yml       # On-demand / push Supertonic TTS bundle verification
    └── package-voice-models.yml     # Publishes voice-models-v1 release bundles
```

---

## Building from Source

Prerequisites: **JDK 17**, **Android SDK (`compileSdk 36`)**, **NDK `27.2.12479018`**, **CMake `3.22.1`**, and **Gradle `8.7`**.

```bash
# 1. Clone llama.cpp into the JNI source tree
git clone --depth 1 https://github.com/ggml-org/llama.cpp.git \
  public/android/HeretIc/app/src/main/cpp/llama.cpp

# 2. Run the 35 JVM unit tests and assemble the native ARM64 APK
cd public/android/HeretIc
gradle :app:testDebugUnitTest :app:assembleDebug

# 3. Install onto a connected arm64-v8a Android device
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
