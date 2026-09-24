import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing material lives outside the repository (Week 17): a local
// key.properties (git-ignored) or, in CI, the same four values as environment
// variables written by the release workflow from repository secrets.
val keyProperties = Properties().apply {
    val file = rootProject.file("key.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
fun signingValue(name: String, envName: String): String? =
    keyProperties.getProperty(name) ?: System.getenv(envName)
val releaseStoreFile = signingValue("storeFile", "INVEXA_KEYSTORE_FILE")

android {
    namespace = "com.invexaretail.invexaretail_mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.invexaretail.invexaretail_mobile"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (releaseStoreFile != null) {
            create("release") {
                storeFile = file(releaseStoreFile)
                storePassword = signingValue("storePassword", "INVEXA_KEYSTORE_PASSWORD")
                keyAlias = signingValue("keyAlias", "INVEXA_KEY_ALIAS")
                keyPassword = signingValue("keyPassword", "INVEXA_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            // CI sets INVEXA_REQUIRE_RELEASE_SIGNING so an unsigned/debug-signed
            // artifact can never be published; local builds fall back to debug keys.
            signingConfig = if (releaseStoreFile != null) {
                signingConfigs.getByName("release")
            } else {
                check(System.getenv("INVEXA_REQUIRE_RELEASE_SIGNING") == null) {
                    "Release signing is required but no keystore was provided."
                }
                signingConfigs.getByName("debug")
            }
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
