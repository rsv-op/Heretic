# The WebView bridge is reached reflectively from JavaScript.
-keepclassmembers class ai.heretic.app.ui.HereticJsBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclassmembers class ai.heretic.app.ui.WebViewHostKt { *; }

# LiteRT / TFLite native entry points.
-keep class com.google.ai.edge.litert.** { *; }
-keepclassmembers class com.google.ai.edge.litert.** { native <methods>; }
-dontwarn com.google.ai.edge.litert.**

# ONNX Runtime Java + JNI bindings (Parakeet TDT, Silero VAD, Supertonic TTS).
-keep class ai.onnxruntime.** { *; }
-keepclassmembers class ai.onnxruntime.** { *; }

# llama.cpp JNI engine & TokenCallback.onToken(String) invoked from C++.
-keep class com.heretic.voice.** { *; }
-keepclassmembers class com.heretic.voice.** { *; }

# SupertonicTTS JNI callbacks (isCancelled, notifyProgress, notifyAudioChunk).
-keep class com.brahmadeo.supertonic.tts.** { *; }
-keepclassmembers class com.brahmadeo.supertonic.tts.** { *; }

# Parakeet STT & Silero VAD classes.
-keep class org.schabi.parakeetype.** { *; }
-keepclassmembers class org.schabi.parakeetype.** { *; }

# Kotlin metadata for Compose reflection-free tooling.
-keepattributes *Annotation*, InnerClasses, Signature
-dontwarn kotlinx.coroutines.**
