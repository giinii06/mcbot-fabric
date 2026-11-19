plugins {
    id("fabric-loom") version "1.11.8"
}

group = "kr.mcbot"
version = "1.1.0"

base {
    archivesName.set("MinecraftBridge")
}

repositories {
    mavenCentral()
}

dependencies {
    // Pinned by server/mods.lock.json and server/.env.example. Never "latest".
    minecraft("com.mojang:minecraft:1.21.1")
    mappings("net.fabricmc:yarn:1.21.1+build.3:v2")
    modImplementation("net.fabricmc:fabric-loader:0.20.1")
    modImplementation("net.fabricmc.fabric-api:fabric-api:0.116.18+1.21.1")

    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testImplementation("org.junit.jupiter:junit-jupiter-params")
    testImplementation("com.google.code.gson:gson:2.11.0")
    testImplementation("org.slf4j:slf4j-api:2.0.16")
    testRuntimeOnly("org.slf4j:slf4j-nop:2.0.16")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.release.set(21)
}

tasks.test {
    useJUnitPlatform()
    testLogging {
        events("passed", "failed", "skipped")
        showStandardStreams = false
    }
    maxHeapSize = "512m"
}

tasks.jar {
    archiveBaseName.set("MinecraftBridge")
    archiveVersion.set(version.toString())
    manifest {
        attributes(
            "Implementation-Title" to "MinecraftBridge",
            "Implementation-Version" to version,
            "Built-By" to "mcbot",
        )
    }
    exclude("**/test/**")
}

// The server jars are installed by server/mc.sh install-mods; this build only
// produces the bridge mod itself.
tasks.register("printJar") {
    dependsOn(tasks.jar)
    doLast {
        println(tasks.jar.get().archiveFile.get().asFile.absolutePath)
    }
}
