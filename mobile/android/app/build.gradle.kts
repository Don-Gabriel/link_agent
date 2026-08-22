plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    // Must come after the Android plugin. Fails the build loudly if
    // google-services.json is missing, which is the correct behaviour: a silent
    // success would produce an app that registers for push and never receives.
    id("com.google.gms.google-services")
}

android {
    namespace = "com.linkdin.linkdin_mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // Must match the package registered in the Firebase console, or push
        // notifications register successfully and then never arrive.
        applicationId = "com.linkdin.linkdin_mobile"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            // Debug keys, deliberately. This app is installed by cable onto one
            // phone and is not distributed, so a release keystore would be a
            // secret to manage for no benefit — and it must never live in the
            // repository, which is the usual way that goes wrong.
            //
            // Publishing to Play Store one day means generating a keystore,
            // keeping it OUT of git, and referencing it from key.properties.
            // Until then this keeps `flutter run --release` working.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
