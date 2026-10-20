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
  triggerMic: () => void;
  triggerFilePicker: () => void;
  coreVersion?: () => string;
}

declare global {
  interface Window {
    HereticNative?: HereticNativeBridge;
  }

  interface WindowEventMap {
    "heretic-stt": CustomEvent<string>;
    "heretic-stt-error": CustomEvent<string>;
    "heretic-file-picked": CustomEvent<string>;
  }
}

export {};
