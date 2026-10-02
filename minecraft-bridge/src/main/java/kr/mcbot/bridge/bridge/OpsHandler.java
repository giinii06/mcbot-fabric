package kr.mcbot.bridge.bridge;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import kr.mcbot.bridge.stats.PlaytimeService;
import kr.mcbot.bridge.util.BridgeAuth;
import kr.mcbot.bridge.util.Validation;
import kr.mcbot.bridge.whitelist.WhitelistFileReader;
import kr.mcbot.bridge.whitelist.WhitelistService;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.logging.Logger;

/** Parses, validates and executes the typed bridge operations. */
public final class OpsHandler implements BridgeHttpServer.Handler {

    private final Plugin plugin;
    private final WhitelistService whitelist;
    private final PlaytimeService playtime;
    private final String secret;
    private final String pluginVersion;
    private final long syncTimeoutMillis;
    private final Gson gson = new Gson();
    private final Logger logger;

    public OpsHandler(
            Plugin plugin,
            WhitelistService whitelist,
            PlaytimeService playtime,
            String secret,
            String pluginVersion,
            long syncTimeoutMillis,
            Logger logger) {
        this.plugin = plugin;
        this.whitelist = whitelist;
        this.playtime = playtime;
        this.secret = secret;
        this.pluginVersion = pluginVersion;
        this.syncTimeoutMillis = Math.max(500, syncTimeoutMillis);
        this.logger = logger;
    }

    @Override
    public HttpResult health() {
        JsonObject body = new JsonObject();
        body.addProperty("ok", true);
        body.addProperty("plugin", plugin == null ? "MinecraftBridge" : plugin.getName());
        body.addProperty("version", pluginVersion);
        body.addProperty("minecraft", true);
        return new HttpResult(200, gson.toJson(body));
    }

    @Override
    public HttpResult ops(String body, String authorization, String bridgeSecret) {
        if (!BridgeAuth.isAuthorized(authorization, bridgeSecret, secret)) {
            return error(401, "unauthorized");
        }

        JsonObject request;
        try {
            var parsed = JsonParser.parseString(body == null ? "" : body);
            if (!parsed.isJsonObject()) {
                return error(400, "invalid payload");
            }
            request = parsed.getAsJsonObject();
        } catch (Exception ex) {
            return error(400, "invalid json");
        }

        String opName = readString(request, "op");
        Optional<Ops> op = Ops.fromWire(opName);
        if (op.isEmpty()) {
            // deliberately generic: no arbitrary command execution exists here
            return error(400, "unknown operation");
        }

        String requestId = readString(request, "requestId");
        if (!Validation.isValidRequestId(requestId)) {
            return error(400, "invalid payload: requestId");
        }

        try {
            return dispatch(op.get(), request);
        } catch (ValidationException ex) {
            return error(400, "invalid payload: " + ex.getMessage());
        } catch (Exception ex) {
            logger.warning("bridge op failed: " + op.get().wireName() + " - " + ex.getMessage());
            return error(500, "internal error");
        }
    }

    private HttpResult dispatch(Ops op, JsonObject request) {
        switch (op) {
            case WHITELIST_ADD_JAVA:
            case WHITELIST_REMOVE_JAVA: {
                UUID uuid = requireUuid(request);
                String username = requireJavaName(request);
                boolean add = op == Ops.WHITELIST_ADD_JAVA;
                return runSync(() -> {
                    WhitelistService.Result result = add
                            ? whitelist.addJava(uuid, username)
                            : whitelist.removeJava(uuid, username);
                    return mutate(result);
                });
            }
            case WHITELIST_ADD_BEDROCK:
            case WHITELIST_REMOVE_BEDROCK: {
                String gamertag = requireGamertag(request);
                String xuid = optionalString(request, "xuid");
                if (xuid != null && !Validation.isValidXuid(xuid)) {
                    throw new ValidationException("xuid");
                }
                boolean add = op == Ops.WHITELIST_ADD_BEDROCK;
                return runSync(() -> {
                    WhitelistService.Result result = add
                            ? whitelist.addBedrock(gamertag, xuid)
                            : whitelist.removeBedrock(gamertag, xuid);
                    return mutate(result);
                });
            }
            case GET_WHITELIST: {
                List<Map<String, Object>> entries = new ArrayList<>();
                for (WhitelistFileReader.Entry entry : whitelist.list()) {
                    if (!Validation.isValidUuid(entry.uuid())) {
                        continue;
                    }
                    String name = Validation.sanitizeText(entry.name(), 32);
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("uuid", entry.uuid().toLowerCase(Locale.ROOT));
                    item.put("name", name.isEmpty() ? "(unknown)" : name);
                    item.put(
                            "edition",
                            Validation.isBedrockUuid(entry.uuid()) || name.startsWith(".") ? "BEDROCK" : "JAVA");
                    entries.add(item);
                }
                JsonObject body = new JsonObject();
                body.add("entries", gson.toJsonTree(entries));
                return new HttpResult(200, gson.toJson(body));
            }
            case GET_PLAYTIME: {
                UUID uuid = requireUuid(request);
                PlaytimeService.Playtime value = playtime.get(uuid);
                JsonObject body = new JsonObject();
                body.addProperty("uuid", uuid.toString().toLowerCase(Locale.ROOT));
                body.addProperty("seconds", value.seconds());
                body.addProperty("ticks", value.ticks());
                body.addProperty("source", value.source());
                return new HttpResult(200, gson.toJson(body));
            }
            case GET_ONLINE_PLAYERS: {
                return runSync(() -> {
                    List<Map<String, Object>> players = new ArrayList<>();
                    for (Player player : Bukkit.getOnlinePlayers()) {
                        players.add(PlayerIdentity.playerRef(player.getUniqueId(), player.getName()));
                    }
                    JsonObject body = new JsonObject();
                    body.add("players", gson.toJsonTree(players));
                    return new HttpResult(200, gson.toJson(body));
                });
            }
            case GET_STATUS: {
                return runSync(() -> {
                    JsonObject body = new JsonObject();
                    body.addProperty("ok", true);
                    body.addProperty("online", Bukkit.getOnlinePlayers().size());
                    body.addProperty("max", Bukkit.getMaxPlayers());
                    body.addProperty("version", Validation.sanitizeText(Bukkit.getVersion(), 120));
                    body.addProperty("whitelistEnabled", Bukkit.hasWhitelist());
                    body.addProperty("enforceWhitelist", Bukkit.isWhitelistEnforced());
                    return new HttpResult(200, gson.toJson(body));
                });
            }
            default:
                return error(400, "unknown operation");
        }
    }

    private HttpResult mutate(WhitelistService.Result result) {
        JsonObject body = new JsonObject();
        body.addProperty("ok", result.ok());
        body.addProperty("applied", result.applied());
        if (result.reason() != null) {
            body.addProperty("reason", Validation.sanitizeText(result.reason(), 300));
        }
        return new HttpResult(result.ok() ? 200 : 502, gson.toJson(body));
    }

    private <T> HttpResult runSync(Callable<T> task) {
        try {
            T value = Bukkit.getScheduler()
                    .callSyncMethod(plugin, task)
                    .get(syncTimeoutMillis, TimeUnit.MILLISECONDS);
            if (value instanceof HttpResult httpResult) {
                return httpResult;
            }
            return error(500, "internal error");
        } catch (TimeoutException ex) {
            return error(504, "server busy");
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            return error(503, "interrupted");
        } catch (ExecutionException ex) {
            Throwable cause = ex.getCause();
            logger.warning("sync task failed: " + (cause == null ? ex.getMessage() : cause.getMessage()));
            return error(500, "internal error");
        } catch (RuntimeException ex) {
            logger.warning("sync task rejected: " + ex.getMessage());
            return error(503, "server unavailable");
        }
    }

    // ------------------------------------------------------------------
    // payload helpers
    // ------------------------------------------------------------------

    private static final class ValidationException extends RuntimeException {
        ValidationException(String field) {
            super(field);
        }
    }

    private static String readString(JsonObject obj, String key) {
        if (obj == null || !obj.has(key) || !obj.get(key).isJsonPrimitive()) {
            return null;
        }
        return obj.get(key).getAsString();
    }

    private static String optionalString(JsonObject obj, String key) {
        String value = readString(obj, key);
        if (value == null || value.isBlank()) {
            return null;
        }
        return value;
    }

    private static UUID requireUuid(JsonObject obj) {
        String value = readString(obj, "uuid");
        if (!Validation.isValidUuid(value)) {
            throw new ValidationException("uuid");
        }
        return UUID.fromString(value.toLowerCase(Locale.ROOT));
    }

    private static String requireJavaName(JsonObject obj) {
        String value = readString(obj, "username");
        if (!Validation.isValidJavaName(value)) {
            throw new ValidationException("username");
        }
        return value;
    }

    private static String requireGamertag(JsonObject obj) {
        String value = readString(obj, "gamertag");
        if (!Validation.isValidGamertag(value)) {
            throw new ValidationException("gamertag");
        }
        return value;
    }

    private static HttpResult error(int status, String message) {
        JsonObject body = new JsonObject();
        body.addProperty("ok", false);
        body.addProperty("error", Validation.sanitizeText(message, 200));
        return new HttpResult(status, new Gson().toJson(body));
    }
}
