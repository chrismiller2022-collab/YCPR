plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.ycpr.scorebug"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.ycpr.scorebug"
        minSdk = 28
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    // A fixed debug key checked into the repo, so every CI build is signed
    // the same way and a new APK installs over the old one (adb install -r)
    // instead of failing on a signature mismatch. It only matters for
    // sideloading onto your own TV over adb; it isn't a Play Store key.
    signingConfigs {
        getByName("debug") {
            storeFile = file("scorebug-debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        getByName("debug") {
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
