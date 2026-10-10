plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// "Score Bug On/Off": a no-UI shortcut app for the remote's customizable
// button. Signed with the same key as :app so it holds the signature-level
// TOGGLE permission that app's ToggleReceiver requires.
android {
    namespace = "com.ycpr.scorebug.toggle"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.ycpr.scorebug.toggle"
        minSdk = 28
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    signingConfigs {
        getByName("debug") {
            storeFile = file("../app/scorebug-debug.keystore")
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
