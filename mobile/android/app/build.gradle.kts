import java.util.Base64
import com.google.gms.googleservices.GoogleServicesTask

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    // Must come after the Android plugin. Fails the build loudly if
    // google-services.json is missing, which is the correct behaviour: a silent
    // success would produce an app that registers for push and never receives.
    id("com.google.gms.google-services")
}

val localPreview = (project.findProperty("dart-defines") as? String).orEmpty().split(",").any {
    runCatching { String(Base64.getDecoder().decode(it)) == "BYLINE_LOCAL_TEST=true" }.getOrDefault(false)
}
val liveClient = (project.findProperty("dart-defines") as? String).orEmpty().split(",").any {
    runCatching { String(Base64.getDecoder().decode(it)) == "BYLINE_APP_VARIANT=live" }.getOrDefault(false)
}
if (localPreview) {
    tasks.matching { it.name.endsWith("GoogleServices") }.configureEach { enabled = false }
}
if (liveClient) {
    afterEvaluate {
        tasks.withType<GoogleServicesTask>().configureEach {
            googleServicesJsonFiles.set(listOf(file("../../../.byline-local/firebase-live-google-services.json")))
        }
    }
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
        applicationId = if (liveClient) "com.linkdin.byline" else if (localPreview) "com.linkdin.byline_preview" else "com.linkdin.linkdin_mobile"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        manifestPlaceholders["bylineLabel"] = if (liveClient) "ByLine Live" else if (localPreview) "ByLine Preview" else "ByLine"
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
