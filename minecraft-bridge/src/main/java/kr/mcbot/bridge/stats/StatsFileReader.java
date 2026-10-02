package kr.mcbot.bridge.stats;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Read-only reader for `<world>/stats/<uuid>.json`.
 * Vanilla 1.21.11 stores play time under `stats.minecraft:custom.minecraft:play_time`
 * (in ticks); older files may still carry `minecraft:play_one_minute`.
 */
public final class StatsFileReader {

    public static final String KEY_MODERN = "minecraft:play_time";
    public static final String KEY_LEGACY = "minecraft:play_one_minute";
    public static final long NOT_FOUND = -1L;

    private StatsFileReader() {
    }

    public static boolean exists(Path statsFile) {
        return statsFile != null && Files.isRegularFile(statsFile);
    }

    public static long readTicks(Path statsFile) throws IOException {
        if (statsFile == null || !Files.isRegularFile(statsFile)) {
            return NOT_FOUND;
        }
        String raw = Files.readString(statsFile, StandardCharsets.UTF_8);
        if (raw.isBlank()) {
            return NOT_FOUND;
        }
        JsonElement root;
        try {
            root = JsonParser.parseString(raw);
        } catch (RuntimeException ex) {
            return NOT_FOUND;
        }
        if (!root.isJsonObject()) {
            return NOT_FOUND;
        }
        return findTicks(root.getAsJsonObject());
    }

    static long findTicks(JsonObject root) {
        long modern = findKey(root, KEY_MODERN);
        if (modern >= 0) {
            return modern;
        }
        return findKey(root, KEY_LEGACY);
    }

    private static long findKey(JsonObject node, String key) {
        if (node.has(key)) {
            try {
                return node.get(key).getAsLong();
            } catch (RuntimeException ex) {
                return -1L;
            }
        }
        for (var entry : node.entrySet()) {
            if (entry.getValue() != null && entry.getValue().isJsonObject()) {
                long found = findKey(entry.getValue().getAsJsonObject(), key);
                if (found >= 0) {
                    return found;
                }
            }
        }
        return -1L;
    }

    /** 20 ticks = 1 second. */
    public static long ticksToSeconds(long ticks) {
        if (ticks <= 0) {
            return 0L;
        }
        return ticks / 20L;
    }
}
