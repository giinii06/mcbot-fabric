package kr.mcbot.bridge.whitelist;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * Read-only reader for the vanilla `whitelist.json`.
 * Reading the file is what makes a DB - whitelist reconciliation possible;
 * the plugin never writes to it (all mutations go through server commands
 * and the Bukkit API).
 */
public final class WhitelistFileReader {

    public record Entry(String uuid, String name) {
    }

    private WhitelistFileReader() {
    }

    public static List<Entry> read(Path whitelistFile) throws IOException {
        List<Entry> entries = new ArrayList<>();
        if (whitelistFile == null || !Files.isRegularFile(whitelistFile)) {
            return entries;
        }
        String raw = Files.readString(whitelistFile, StandardCharsets.UTF_8);
        if (raw.isBlank()) {
            return entries;
        }
        JsonElement root;
        try {
            root = JsonParser.parseString(raw);
        } catch (RuntimeException ex) {
            return entries;
        }
        if (!root.isJsonArray()) {
            return entries;
        }
        JsonArray array = root.getAsJsonArray();
        for (JsonElement element : array) {
            if (!element.isJsonObject()) {
                continue;
            }
            JsonObject object = element.getAsJsonObject();
            String uuid = object.has("uuid") && object.get("uuid").isJsonPrimitive()
                    ? object.get("uuid").getAsString()
                    : "";
            String name = object.has("name") && object.get("name").isJsonPrimitive()
                    ? object.get("name").getAsString()
                    : "";
            if (!uuid.isEmpty()) {
                entries.add(new Entry(uuid, name));
            }
        }
        return entries;
    }
}
