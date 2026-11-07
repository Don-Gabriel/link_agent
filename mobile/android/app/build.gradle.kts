import java.util.Base64
import java.util.Properties
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
val cloudClient = (project.findProperty("dart-defines") as? String).orEmpty().split(",").any {
    runCatching { String(Base64.getDecoder().decode(it)) == "BYLINE_APP_VARIANT=cloud" }.getOrDefault(false)
}
val releaseKeys = Properties()
if (cloudClient) {
    val keyFile = rootProject.file("key.properties")
    check(keyFile.exists()) { "Prepare the private ByLine release signing key before building the cloud app." }
    keyFile.inputStream().use { releaseKeys.load(it) }
}
if (localPreview) {
    tasks.matching { it.name.endsWith("GoogleServices") }.configureEach { enabled = false }
}
if (liveClient || cloudClient) {
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
        applicationId = if (liveClient || cloudClient) "com.linkdin.byline" else if (localPreview) "com.linkdin.byline_preview" else "com.linkdin.linkdin_mobile"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        manifestPlaceholders["bylineLabel"] = if (liveClient) "ByLine Live" else if (localPreview) "ByLine Preview" else "ByLine"
    }

    if (cloudClient) {
        signingConfigs.create("bylineRelease") {
            storeFile = file(releaseKeys.getProperty("storeFile"))
            storePassword = releaseKeys.getProperty("storePassword")
            keyAlias = releaseKeys.getProperty("keyAlias")
            keyPassword = releaseKeys.getProperty("keyPassword")
        }
    }

    buildTypes {
        release {
            // Cloud releases require the private key; development variants keep their existing signing.
            signingConfig = signingConfigs.getByName(if (cloudClient) "bylineRelease" else "debug")
        }
    }
    testOptions {
        unitTests.all {
            // Robolectric's native loader misreads URL-escaped spaces in the
            // Windows user-home Maven cache. Keep its SDK jars with build output.
            it.systemProperty("maven.repo.local", rootProject.layout.buildDirectory.dir("robolectric-m2").get().asFile.absolutePath)
            it.jvmArgs("--add-opens=java.base/java.lang=ALL-UNNAMED",
                "--add-opens=java.base/java.util=ALL-UNNAMED",
                "--add-opens=java.base/java.io=ALL-UNNAMED")
        }
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.17")
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
