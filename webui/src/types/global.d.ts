/**
 * The Kotlin `HereticJsBridge` is injected into the WebView as
 * `window.HereticNative` (see public/android/HeretIc/app/src/main/java/ai/heretic/app/ui/WebBridge.kt).
 * In a plain browser the bridge is absent and the web build falls back to the
 * Web Speech API — the UI must work identically in both environments.
 */
export interface HereticNativeBridge {
  reply: (prompt: string) => string;
  analyzeError: (rawLog: string) => string;
  confirmSolution: (pasteBack: string) => string;
  assessFile: (fileName: string) => string;
  speak: (text: string) => void;
  stopSpeaking?: () => void;
  triggerMic: () => void;
  triggerFilePicker: () => void;
  coreVersion?: () => string;
  /** JSON from VoiceManager.voiceStatusJson(): offline speech packs + TTS voices. */
  voiceStatus?: () => string;
  /** JSON from LiteRtLmEngine.statusJson(): ABI, RAM, catalog, installed model. */
  modelStatus?: () => string;
  /** ACTION_OPEN_DOCUMENT; a .litertlm pick is copied into filesDir/models. */
  triggerModelPicker?: () => void;
  /** Unified offline voice pipeline (Parakeet TDT + Silero VAD + llama.cpp + Supertonic TTS). */
  getVoicePipelineConfig?: () => string;
  setVoiceModelPaths?: (ggufPath: string, sttDir: string, ttsDir: string, voiceStylePath: string) => string;
  pickGgufModel?: () => void;
  pickSttModelDir?: () => void;
  pickSttModelZip?: () => void;
  pickTtsModelDir?: () => void;
  pickTtsModelZip?: () => void;
  initUnifiedVoicePipeline?: () => void;
  startUnifiedVoiceListening?: () => boolean;
  stopUnifiedVoiceListening?: () => void;
  stopUnifiedVoicePlayback?: () => void;
  speakWithUnifiedVoice?: (prompt: string) => void;
  openNativeVoiceConsole?: () => void;
  isArm64Device?: () => boolean;
  deviceRamMb?: () => number;
}

declare global {
  interface Window {
    HereticNative?: HereticNativeBridge;
  }

  interface WindowEventMap {
    "heretic-stt": CustomEvent<string>;
    "heretic-stt-error": CustomEvent<string>;
    "heretic-file-picked": CustomEvent<string>;
    "heretic-model": CustomEvent<string>;
    "heretic-model-progress": CustomEvent<string>;
    "heretic-model-error": CustomEvent<string>;
    "heretic-voice-state": CustomEvent<string>;
  }
}

export {};
