plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "ai.heretic.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "ai.heretic.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 23
        versionName = "2.3.0-offline"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Zero background drain: only the ABIs we actually ship native libs for.
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a")
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

    // ---- On-device inference (offline, no cloud) -------------------------
    implementation("com.google.ai.edge.litert:litert:2.3.0")
    // Optional: include for GPU acceleration
    implementation("com.google.ai.edge.litert:litert-gpu:2.3.0")

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(platform(libs.androidx.compose.bom))
}
