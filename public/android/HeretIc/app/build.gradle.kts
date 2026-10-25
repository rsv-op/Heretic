plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "ai.heretic.app"
    compileSdk = 36
    ndkVersion = "27.2.12479018"

    defaultConfig {
        applicationId = "ai.heretic.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 30
        versionName = "3.0.0-native-voice-assistant"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        ndk {
            abiFilters += listOf("arm64-v8a")
        }

        externalNativeBuild {
            cmake {
                cppFlags += listOf("-std=c++17", "-O3")
                arguments += listOf(
                    "-DANDROID_STL=c++_shared",
                    "-DANDROID_PLATFORM=android-26",
                    "-DGGML_OPENMP=OFF",
                    "-DGGML_LLAMAFILE=OFF",
                )
            }
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        jvmToolchain(17)
    }

    buildFeatures {
        compose = true
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    androidResources {
        noCompress += listOf("onnx", "gguf", "litertlm")
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
        jniLibs {
            useLegacyPackaging = false
            pickFirsts += "**/libc++_shared.so"
        }
    }

    sourceSets["main"].assets.srcDirs("src/main/assets")
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.kotlinx.coroutines.android)

    // ---- On-device inference (100% offline, zero network) ----------------
    implementation(libs.litert)
    implementation(libs.litert.gpu)
    implementation(libs.litertlm.android)
    // ONNX Runtime Android for Parakeet TDT STT, Silero VAD v6, and Supertonic TTS
    implementation(libs.onnxruntime.android)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(platform(libs.androidx.compose.bom))
}

/**
 * Native Voice Assistant asset verification guard.
 *
 * Ensures Silero VAD v6 (`silero_vad.onnx`) is embedded in `src/main/assets` and verifies
 * that no legacy WebView (`index.html` / `pglite-*`) bundle is packaged into the native APK.
 */
val verifyVoiceAssets by tasks.registering {
    val assetsDir = layout.projectDirectory.dir("src/main/assets").asFile
    inputs.files(fileTree(assetsDir)).withPropertyName("voiceAssets")
    doLast {
        val vad = File(assetsDir, "silero_vad.onnx")
        check(vad.isFile && vad.length() > 1_000_000L) {
            "src/main/assets/silero_vad.onnx is missing or truncated."
        }
        val staleHtml = File(assetsDir, "index.html")
        check(!staleHtml.exists()) {
            "Legacy WebUI src/main/assets/index.html must not be packaged in the native Heretic Voice Assistant APK."
        }
    }
}

tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }.configureEach {
    dependsOn(verifyVoiceAssets)
}

configurations.all {
    exclude(group = "androidx.work")
}
