buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:9.1.0")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.20")
        classpath("com.google.devtools.ksp:symbol-processing-gradle-plugin:2.2.20-2.0.3")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

// Tauri's library modules declare consumer ProGuard files that are not shipped in
// the crate (e.g. tauri-plugin-notification's consumer-rules.pro). AGP 8 ignored
// missing files; AGP 9 fails the build. Drop the missing entries after each
// module is evaluated, without touching the cargo registry sources.
subprojects {
    if (name.startsWith("tauri-")) {
        afterEvaluate {
            extensions.findByType(com.android.build.gradle.LibraryExtension::class.java)
                ?.defaultConfig?.consumerProguardFiles?.removeIf { !it.exists() }
        }
    }
}

tasks.register("clean").configure {
    delete("build")
}

