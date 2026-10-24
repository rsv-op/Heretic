plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "ai.heretic.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "ai.heretic.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 24
        versionName = "2.4.0-android16-personal"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // litertlm-android 0.18.0 ships native libraries for arm64-v8a and x86_64
        // only. There is no 32-bit ARM build, so armeabi-v7a is not packaged and
        // LiteRtLmEngine.isArm64Device() refuses to load the engine there.
        ndk {
            abiFilters += listOf("arm64-v8a", "x86_64")
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
            // Signed locally with the operator's own debug/release key.
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

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        jniLibs {
            useLegacyPackaging = false
        }
        }
    }

    // The single-file web command center is copied here by the build workflow:
    //   cp dist/index.html app/src/main/assets/index.html
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

    // Serves app/src/main/assets over https://appassets.androidplatform.net so
    // the WebView can import ES modules and stream the PGlite WebAssembly while
    // allowFileAccess stays false.
    implementation(libs.androidx.webkit)

    // ---- On-device inference (offline, no cloud) -------------------------
    implementation(libs.litert)
    // Optional GPU delegate for .tflite/.task models
    implementation(libs.litert.gpu)
    // LiteRT-LM: loads the .litertlm Gemma bundles (Gemma 4 E2B / Gemma 3n E2B)
    implementation(libs.litertlm.android)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(platform(libs.androidx.compose.bom))
}

/**
 * Local staging guard.
 *
 * The split PGlite runtime (pglite-*.js / .wasm / .data, ~16 MB) is gitignored, so
 * a clean checkout only carries index.html. Without staging, assembleDebug would
 * still succeed and ship an APK whose dashboard cannot boot its database. This
 * task fails the asset merge with the exact fix instead. Unit tests do not depend
 * on it, so `:app:testDebugUnitTest` works on a bare checkout.
 */
val verifyWebAssets by tasks.registering {
    val assetsDir = layout.projectDirectory.dir("src/main/assets").asFile
    inputs.files(fileTree(assetsDir)).withPropertyName("webAssets")
    doLast {
        val html = File(assetsDir, "index.html")
        check(html.isFile) {
            "src/main/assets/index.html is missing. Run ./scripts/stage-web.sh from the repository root."
        }
        val text = html.readText()
        val referenced = Regex("pglite-[A-Za-z0-9_-]+[.]js").findAll(text).map { it.value }.toSet()
        val missing = referenced.filterNot { File(assetsDir, it).isFile }
        check(missing.isEmpty()) {
            "index.html references ${missing.joinToString(", ")}, which is missing from " +
                "src/main/assets. Run ./scripts/stage-web.sh from the repository root."
        }
        val runtime = assetsDir.listFiles().orEmpty().filter {
            it.name.startsWith("pglite-") && (it.extension == "wasm" || it.extension == "data")
        }
        check(runtime.isNotEmpty()) {
            "The PGlite wasm/data runtime is not staged into src/main/assets. " +
                "Run ./scripts/stage-web.sh from the repository root."
        }
    }
}

tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }.configureEach {
    dependsOn(verifyWebAssets)
}

configurations.all {
    exclude(group = "androidx.work")
}
