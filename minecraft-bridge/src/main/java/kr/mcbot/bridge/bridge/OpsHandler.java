package kr.mcbot.bridge.bridge;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import kr.mcbot.bridge.util.BridgeAuth;
import kr.mcbot.bridge.util.Validation;
import org.slf4j.Logger;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Parses, validates and executes the typed bridge operations.
 *
 * <p>This class contains no Minecraft API calls: {@link OpsBackend} owns the
 * server-thread hop, which keeps the wire contract easy to test and makes it
 * impossible to touch game state from an HTTP thread by accident.</p>
 */
public final class OpsHandler implements BridgeHttpServer.Handler {

    private final OpsBackend backend;
    private final String secret;
    private final String bridgeVersion;
    private final Gson gson = new Gson();
    private final Logger logger;

    public OpsHandler(OpsBackend backend, String secret, String bridgeVersion, Logger logger) {
        this.backend = backend;
        this.secret = secret;
        this.bridgeVersion = bridgeVersion;
        this.logger = logger;
    }

    @Override
    public HttpResult health() {
        JsonObject body = new JsonObject();
        body.addProperty("ok", true);
        body.addProperty("plugin", "MinecraftBridge");
        body.addProperty("version", bridgeVersion);
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
        } catch (OpsBackend.BackendTimeoutException ex) {
            return error(504, "server busy");
        } catch (OpsBackend.BackendUnavailableException ex) {
            return error(503, "server unavailable");
        } catch (OpsBackend.BackendFailureException ex) {
            logger.warn("bridge op failed: {} - {}", op.get().wireName(), ex.getMessage());
            return error(500, "internal error");
        } catch (Exception ex) {
            logger.warn("bridge op crashed: {} - {}", op.get().wireName(), ex.toString());
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
                OpsBackend.MutationResult result = add
                        ? backend.addJava(uuid, username)
                        : backend.removeJava(uuid, username);
                return mutate(result);
            }
            case WHITELIST_ADD_BEDROCK:
            case WHITELIST_REMOVE_BEDROCK:
                // This server is Java-only (Fabric + Cobblemon, no Geyser/Floodgate).
                return error(501, "bedrock edition is not supported by this server");
            case GET_WHITELIST: {
                List<Map<String, Object>> entries = new ArrayList<>();
                for (OpsBackend.WhitelistItem entry : backend.whitelist()) {
                    if (!Validation.isValidUuid(entry.uuid())) {
                        continue;
                    }
                    String name = Validation.sanitizeText(entry.name(), 32);
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("uuid", entry.uuid().toLowerCase(Locale.ROOT));
                    item.put("name", name.isEmpty() ? "(unknown)" : name);
                    item.put("edition", PlayerIdentity.editionOf(
                            UUID.fromString(entry.uuid().toLowerCase(Locale.ROOT)), name));
                    entries.add(item);
                }
                JsonObject body = new JsonObject();
                body.add("entries", gson.toJsonTree(entries));
                return new HttpResult(200, gson.toJson(body));
            }
            case GET_PLAYTIME: {
                UUID uuid = requireUuid(request);
                OpsBackend.Playtime value = backend.playtime(uuid);
                JsonObject body = new JsonObject();
                body.addProperty("uuid", uuid.toString().toLowerCase(Locale.ROOT));
                body.addProperty("seconds", value.seconds());
                body.addProperty("ticks", value.ticks());
                body.addProperty("source", value.source());
                return new HttpResult(200, gson.toJson(body));
            }
            case GET_ONLINE_PLAYERS: {
                List<Map<String, Object>> players = new ArrayList<>();
                for (OpsBackend.OnlinePlayer player : backend.onlinePlayers()) {
                    players.add(PlayerIdentity.playerRef(
                            UUID.fromString(player.uuid().toLowerCase(Locale.ROOT)), player.username()));
                }
                JsonObject body = new JsonObject();
                body.add("players", gson.toJsonTree(players));
                return new HttpResult(200, gson.toJson(body));
            }
            case GET_STATUS: {
                OpsBackend.ServerStatus status = backend.status();
                JsonObject body = new JsonObject();
                body.addProperty("ok", status.ok());
                body.addProperty("online", status.online());
                body.addProperty("max", status.max());
                body.addProperty("version", Validation.sanitizeText(status.version(), 120));
                body.addProperty("whitelistEnabled", status.whitelistEnabled());
                body.addProperty("enforceWhitelist", status.enforceWhitelist());
                return new HttpResult(200, gson.toJson(body));
            }
            default:
                return error(400, "unknown operation");
        }
    }

    private HttpResult mutate(OpsBackend.MutationResult result) {
        JsonObject body = new JsonObject();
        body.addProperty("ok", result.ok());
        body.addProperty("applied", result.applied());
        if (result.reason() != null) {
            body.addProperty("reason", Validation.sanitizeText(result.reason(), 300));
        }
        return new HttpResult(result.ok() ? 200 : 502, gson.toJson(body));
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

    private static HttpResult error(int status, String message) {
        JsonObject body = new JsonObject();
        body.addProperty("ok", false);
        body.addProperty("error", Validation.sanitizeText(message, 200));
        return new HttpResult(status, new Gson().toJson(body));
    }
}
