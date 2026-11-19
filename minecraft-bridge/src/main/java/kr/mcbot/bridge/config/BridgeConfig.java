package kr.mcbot.bridge.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonSyntaxException;
import org.slf4j.Logger;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Bridge configuration. The secret itself is never written to disk by this
 * class: it comes from {@code MC_BRIDGE_SECRET} or a read-only secret file
 * (Docker secret), exactly like the RCON password.
 */
public final class BridgeConfig {

    public static final String FILE_NAME = "minecraftbridge.json";

    public boolean enabled = true;
    public String botBaseUrl = "http://mcbot:47865";
    public String bind = "0.0.0.0";
    public int port = 8765;
    public String secretFile = "/run/secrets/bridge_secret";
    /** Optional inline secret; prefer secretFile. Only honoured when no env/file secret exists. */
    public String secret = "";
    public Timeouts timeouts = new Timeouts();
    public Queue queue = new Queue();

    public static final class Timeouts {
        public int botConnectMs = 3000;
        public int botRequestMs = 3000;
        public int syncTaskMs = 4000;
    }

    public static final class Queue {
        public int capacity = 200;
        public int workers = 2;
        public int retry = 1;
    }

    public static BridgeConfig load(Path configDir, Logger logger) throws IOException {
        Files.createDirectories(configDir);
        Path file = configDir.resolve(FILE_NAME);
        Gson gson = new GsonBuilder().setPrettyPrinting().create();
        BridgeConfig config;
        if (Files.isRegularFile(file)) {
            String raw = Files.readString(file, StandardCharsets.UTF_8);
            try {
                config = raw.isBlank() ? new BridgeConfig() : gson.fromJson(raw, BridgeConfig.class);
            } catch (JsonSyntaxException ex) {
                throw new IOException("invalid " + FILE_NAME + ": " + ex.getMessage(), ex);
            }
            if (config == null) {
                config = new BridgeConfig();
            }
        } else {
            config = new BridgeConfig();
            Files.writeString(file, gson.toJson(config) + System.lineSeparator(), StandardCharsets.UTF_8);
            logger.info("created default bridge config at {}", file);
        }
        config.applyEnvironment();
        return config;
    }

    private void applyEnvironment() {
        String botUrl = System.getenv("MC_BRIDGE_BOT_URL");
        if (botUrl != null && !botUrl.isBlank()) {
            botBaseUrl = botUrl.trim();
        }
        String bindValue = System.getenv("MC_BRIDGE_BIND");
        if (bindValue != null && !bindValue.isBlank()) {
            bind = bindValue.trim();
        }
        String portValue = System.getenv("MC_BRIDGE_PORT");
        if (portValue != null && !portValue.isBlank()) {
            try {
                port = Integer.parseInt(portValue.trim());
            } catch (NumberFormatException ignored) {
                // keep the configured port; the server logs the effective value
            }
        }
        String secretFileValue = System.getenv("MC_BRIDGE_SECRET_FILE");
        if (secretFileValue != null && !secretFileValue.isBlank()) {
            secretFile = secretFileValue.trim();
        }
    }

    /**
     * Returns the shared bot secret, or an empty string when it is missing,
     * too short or still the placeholder. Callers must not log the value.
     */
    public String resolveSecret() {
        String value = System.getenv("MC_BRIDGE_SECRET");
        if (value == null || value.isBlank()) {
            value = readSecretFile();
        }
        if (value == null || value.isBlank()) {
            value = secret;
        }
        if (value == null) {
            return "";
        }
        value = value.trim();
        if (value.length() < 16 || "CHANGE_ME".equals(value)) {
            return "";
        }
        return value;
    }

    private String readSecretFile() {
        if (secretFile == null || secretFile.isBlank()) {
            return null;
        }
        Path path = Path.of(secretFile);
        if (!Files.isRegularFile(path)) {
            return null;
        }
        try {
            return Files.readString(path, StandardCharsets.UTF_8).trim();
        } catch (IOException ex) {
            return null;
        }
    }
}
