# The WebView bridge is reached reflectively from JavaScript.
-keepclassmembers class ai.heretic.app.ui.HereticJsBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclassmembers class ai.heretic.app.ui.WebViewHostKt { *; }

# LiteRT / TFLite native entry points.
-keep class com.google.ai.edge.litert.** { *; }
-keepclassmembers class com.google.ai.edge.litert.** { native <methods>; }
-dontwarn com.google.ai.edge.litert.**

# Kotlin metadata for Compose reflection-free tooling.
-keepattributes *Annotation*, InnerClasses, Signature
-dontwarn kotlinx.coroutines.**
