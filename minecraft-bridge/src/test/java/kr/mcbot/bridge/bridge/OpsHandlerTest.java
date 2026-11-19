package kr.mcbot.bridge.bridge;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Wire contract of the bridge: auth, payload validation, the enumerated ops,
 * Bedrock rejection and the server-thread timeout mapping. Uses a fake
 * backend so no Minecraft server is needed.
 */
class OpsHandlerTest {

    private static final String SECRET = "0123456789abcdef0123456789abcdef";
    private static final String REQUEST_ID = "request-12345678";
    private static final UUID UUID_A = UUID.fromString("069a79f4-44e9-4726-a5be-ca90e38aaf51");

    private FakeBackend backend;
    private OpsHandler handler;

    @BeforeEach
    void setUp() {
        backend = new FakeBackend();
        handler = new OpsHandler(backend, SECRET, "1.1.0-test", LoggerFactory.getLogger("test"));
    }

    private HttpResult post(String json, String auth) {
        return handler.ops(json, auth, null);
    }

    private JsonObject body(HttpResult result) {
        return JsonParser.parseString(result.body()).getAsJsonObject();
    }

    @Test
    void healthDoesNotExposeSecrets() {
        HttpResult result = handler.health();
        assertEquals(200, result.status());
        JsonObject json = body(result);
        assertTrue(json.get("ok").getAsBoolean());
        assertEquals("MinecraftBridge", json.get("plugin").getAsString());
        assertEquals("1.1.0-test", json.get("version").getAsString());
        assertFalse(result.body().contains(SECRET));
    }

    @Test
    void rejectsUnauthorizedRequests() {
        assertEquals(401, post("{}", null).status());
        assertEquals(401, post("{}", "Bearer wrong").status());
        assertEquals(401, handler.ops("{}", null, "also-wrong").status());
        assertNull(backend.lastOp);
    }

    @Test
    void acceptsBearerAndBridgeSecretHeaders() {
        String json = "{\"op\":\"getStatus\",\"requestId\":\"" + REQUEST_ID + "\"}";
        assertEquals(200, handler.ops(json, "Bearer " + SECRET, null).status());
        assertEquals(200, handler.ops(json, null, SECRET).status());
        assertEquals("getStatus", backend.lastOp);
    }

    @Test
    void rejectsInvalidJsonAndUnknownOperations() {
        assertEquals(400, post("not json", "Bearer " + SECRET).status());
        assertEquals(400, post("[]", "Bearer " + SECRET).status());
        assertEquals(400, post("{\"op\":\"runCommand\",\"requestId\":\"" + REQUEST_ID + "\"}",
                "Bearer " + SECRET).status());
    }

    @Test
    void requiresAValidRequestId() {
        String json = "{\"op\":\"getStatus\",\"requestId\":\"short\"}";
        HttpResult result = post(json, "Bearer " + SECRET);
        assertEquals(400, result.status());
        assertTrue(body(result).get("error").getAsString().contains("requestId"));
    }

    @Test
    void addsAJavaWhitelistEntry() {
        String json = "{\"op\":\"whitelistAddJava\",\"requestId\":\"" + REQUEST_ID
                + "\",\"uuid\":\"" + UUID_A + "\",\"username\":\"Notch\"}";
        HttpResult result = post(json, "Bearer " + SECRET);
        assertEquals(200, result.status());
        JsonObject jsonBody = body(result);
        assertTrue(jsonBody.get("ok").getAsBoolean());
        assertTrue(jsonBody.get("applied").getAsBoolean());
        assertEquals("whitelistAddJava", backend.lastOp);
        assertEquals(UUID_A, backend.lastUuid);
        assertEquals("Notch", backend.lastUsername);
    }

    @Test
    void invalidJavaIdentityIsRejectedBeforeTheBackend() {
        String badUuid = "{\"op\":\"whitelistAddJava\",\"requestId\":\"" + REQUEST_ID
                + "\",\"uuid\":\"nope\",\"username\":\"Notch\"}";
        assertEquals(400, post(badUuid, "Bearer " + SECRET).status());
        String badName = "{\"op\":\"whitelistAddJava\",\"requestId\":\"" + REQUEST_ID
                + "\",\"uuid\":\"" + UUID_A + "\",\"username\":\"<script>\"}";
        assertEquals(400, post(badName, "Bearer " + SECRET).status());
        assertNull(backend.lastOp);
    }

    @Test
    void bedrockOperationsAreExplicitlyUnsupported() {
        for (String op : List.of("whitelistAddBedrock", "whitelistRemoveBedrock")) {
            String json = "{\"op\":\"" + op + "\",\"requestId\":\"" + REQUEST_ID
                    + "\",\"gamertag\":\"SomeOne\",\"xuid\":\"2535423456789012\"}";
            HttpResult result = post(json, "Bearer " + SECRET);
            assertEquals(501, result.status(), op);
            assertEquals("bedrock edition is not supported by this server",
                    body(result).get("error").getAsString());
        }
        assertNull(backend.lastOp);
    }

    @Test
    void returnsWhitelistEntriesWithEdition() {
        backend.whitelist.add(new OpsBackend.WhitelistItem(UUID_A.toString(), "Notch"));
        backend.whitelist.add(new OpsBackend.WhitelistItem("00000000-0000-0000-0001-000000000002", ".Bedrock"));
        backend.whitelist.add(new OpsBackend.WhitelistItem("not-a-uuid", "broken"));
        String json = "{\"op\":\"getWhitelist\",\"requestId\":\"" + REQUEST_ID + "\"}";
        HttpResult result = post(json, "Bearer " + SECRET);
        assertEquals(200, result.status());
        var entries = body(result).getAsJsonArray("entries");
        assertEquals(2, entries.size());
        assertEquals("JAVA", entries.get(0).getAsJsonObject().get("edition").getAsString());
        assertEquals("BEDROCK", entries.get(1).getAsJsonObject().get("edition").getAsString());
    }

    @Test
    void returnsPlaytimeInSeconds() {
        backend.playtime = new OpsBackend.Playtime(72_000L, 3_600L, "file");
        String json = "{\"op\":\"getPlaytime\",\"requestId\":\"" + REQUEST_ID
                + "\",\"uuid\":\"" + UUID_A + "\"}";
        HttpResult result = post(json, "Bearer " + SECRET);
        assertEquals(200, result.status());
        JsonObject jsonBody = body(result);
        assertEquals(3_600L, jsonBody.get("seconds").getAsLong());
        assertEquals(72_000L, jsonBody.get("ticks").getAsLong());
        assertEquals("file", jsonBody.get("source").getAsString());
    }

    @Test
    void returnsOnlinePlayersInTheExistingShape() {
        backend.players.add(new OpsBackend.OnlinePlayer(UUID_A.toString(), "Notch"));
        String json = "{\"op\":\"getOnlinePlayers\",\"requestId\":\"" + REQUEST_ID + "\"}";
        HttpResult result = post(json, "Bearer " + SECRET);
        assertEquals(200, result.status());
        JsonObject player = body(result).getAsJsonArray("players").get(0).getAsJsonObject();
        assertEquals(UUID_A.toString(), player.get("uuid").getAsString());
        assertEquals("Notch", player.get("username").getAsString());
        assertEquals("JAVA", player.get("edition").getAsString());
        // Gson omits null map values; the bot schema declares xuid optional.
        assertTrue(!player.has("xuid") || player.get("xuid").isJsonNull());
    }

    @Test
    void returnsServerStatus() {
        String json = "{\"op\":\"getStatus\",\"requestId\":\"" + REQUEST_ID + "\"}";
        HttpResult result = post(json, "Bearer " + SECRET);
        assertEquals(200, result.status());
        JsonObject jsonBody = body(result);
        assertTrue(jsonBody.get("ok").getAsBoolean());
        assertEquals(1, jsonBody.get("online").getAsInt());
        assertEquals(20, jsonBody.get("max").getAsInt());
        assertTrue(jsonBody.get("whitelistEnabled").getAsBoolean());
        assertTrue(jsonBody.get("enforceWhitelist").getAsBoolean());
    }

    @Test
    void mapsBackendTimeoutsAndAvailability() {
        String json = "{\"op\":\"getOnlinePlayers\",\"requestId\":\"" + REQUEST_ID + "\"}";
        backend.failure = new OpsBackend.BackendTimeoutException();
        assertEquals(504, post(json, "Bearer " + SECRET).status());

        backend.failure = new OpsBackend.BackendUnavailableException();
        assertEquals(503, post(json, "Bearer " + SECRET).status());

        backend.failure = new OpsBackend.BackendFailureException(new IllegalStateException("boom"));
        assertEquals(500, post(json, "Bearer " + SECRET).status());
    }

    @Test
    void mutationFailuresSurfaceAs502WithAReason() {
        backend.mutation = OpsBackend.MutationResult.fail("whitelist could not be saved");
        String json = "{\"op\":\"whitelistRemoveJava\",\"requestId\":\"" + REQUEST_ID
                + "\",\"uuid\":\"" + UUID_A + "\",\"username\":\"Notch\"}";
        HttpResult result = post(json, "Bearer " + SECRET);
        assertEquals(502, result.status());
        assertFalse(body(result).get("ok").getAsBoolean());
        assertEquals("whitelist could not be saved", body(result).get("reason").getAsString());
    }

    private static final class FakeBackend implements OpsBackend {
        final List<WhitelistItem> whitelist = new ArrayList<>();
        final List<OnlinePlayer> players = new ArrayList<>();
        String lastOp;
        UUID lastUuid;
        String lastUsername;
        Playtime playtime = new Playtime(0L, 0L, "none");
        MutationResult mutation = MutationResult.ok(true);
        RuntimeException failure;

        private void failIfAsked() {
            if (failure != null) {
                throw failure;
            }
        }

        @Override
        public MutationResult addJava(UUID uuid, String username) {
            lastOp = "whitelistAddJava";
            lastUuid = uuid;
            lastUsername = username;
            failIfAsked();
            return mutation;
        }

        @Override
        public MutationResult removeJava(UUID uuid, String username) {
            lastOp = "whitelistRemoveJava";
            lastUuid = uuid;
            lastUsername = username;
            failIfAsked();
            return mutation;
        }

        @Override
        public List<WhitelistItem> whitelist() {
            lastOp = "getWhitelist";
            failIfAsked();
            return whitelist;
        }

        @Override
        public Playtime playtime(UUID uuid) {
            lastOp = "getPlaytime";
            lastUuid = uuid;
            failIfAsked();
            return playtime;
        }

        @Override
        public List<OnlinePlayer> onlinePlayers() {
            lastOp = "getOnlinePlayers";
            failIfAsked();
            return players;
        }

        @Override
        public ServerStatus status() {
            lastOp = "getStatus";
            failIfAsked();
            return new ServerStatus(true, 1, 20, "1.21.1 (fabric)", true, true);
        }
    }
}
