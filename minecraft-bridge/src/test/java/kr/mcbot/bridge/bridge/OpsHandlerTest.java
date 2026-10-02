package kr.mcbot.bridge.bridge;

import kr.mcbot.bridge.stats.PlaytimeService;
import kr.mcbot.bridge.whitelist.WhitelistService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.logging.Logger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Contract tests for the HTTP surface exposed to the Discord bot:
 * auth rejection, payload validation and the "no arbitrary command" rule.
 * Nothing here touches Bukkit - only operations that are safe off the main
 * thread are exercised.
 */
class OpsHandlerTest {

    private static final String SECRET = "0123456789abcdef0123456789abcdef";
    private static final String BEARER = "Bearer " + SECRET;

    @TempDir
    Path tempDir;

    private OpsHandler handler;

    @BeforeEach
    void setUp() throws IOException {
        Files.writeString(tempDir.resolve("whitelist.json"), """
                [
                  {"name":"Steve","uuid":"00000000-0000-0000-0000-000000000001"},
                  {"name":".BedrockKid","uuid":"00000000-0000-0000-0009-01fb54b26482"},
                  {"name":"Bad","uuid":"not-a-uuid"}
                ]
                """);
        Path statsDir = Files.createDirectories(tempDir.resolve("world").resolve("stats"));
        Files.writeString(statsDir.resolve("069a79f4-44e9-4726-a5be-ca90e38aaf51.json"), """
                {"stats":{"minecraft:play_time": 72000}}
                """);

        WhitelistService whitelist = new WhitelistService(Logger.getLogger("test"), tempDir.toFile());
        PlaytimeService playtime = new PlaytimeService(Logger.getLogger("test"), statsDir, 5000L, 16);
        handler = new OpsHandler(null, whitelist, playtime, SECRET, "1.0.0", 4000L, Logger.getLogger("test"));
    }

    // ------------------------------------------------------------------
    // auth
    // ------------------------------------------------------------------

    @Test
    void rejectsMissingOrWrongSecret() {
        assertEquals(401, handler.ops(json("getStatus"), null, null).status());
        assertEquals(401, handler.ops(json("getStatus"), "Bearer wrong", null).status());
        assertEquals(401, handler.ops(json("getStatus"), null, "wrong").status());
        assertEquals(401, handler.ops(json("getStatus"), "Basic " + SECRET, null).status());
        assertEquals(401, handler.ops(json("getStatus"), "bearer", null).status());
        assertEquals(401, handler.ops(json("getStatus"), "Bearer ", null).status());
    }

    @Test
    void acceptsBearerAndSecretHeader() {
        assertEquals(200, handler.ops(json("getWhitelist"), BEARER, null).status());
        assertEquals(200, handler.ops(json("getWhitelist"), null, SECRET).status());
    }

    // ------------------------------------------------------------------
    // payload validation
    // ------------------------------------------------------------------

    @Test
    void rejectsMalformedBodies() {
        assertEquals(400, handler.ops("not json", BEARER, null).status());
        assertEquals(400, handler.ops("[1,2,3]", BEARER, null).status());
        assertEquals(400, handler.ops(null, BEARER, null).status());
        assertEquals(400, handler.ops("{}", BEARER, null).status());
    }

    @Test
    void rejectsArbitraryCommandOperations() {
        assertEquals(400, handler.ops("""
                {"op":"console.exec","requestId":"abcdefgh"}
                """, BEARER, null).status());
        assertEquals(400, handler.ops("""
                {"op":"minecraft/command","requestId":"abcdefgh","command":"stop"}
                """, BEARER, null).status());
        assertEquals(400, handler.ops("""
                {"op":"op give Notch","requestId":"abcdefgh"}
                """, BEARER, null).status());
    }

    @Test
    void rejectsBadRequestIds() {
        assertEquals(400, handler.ops("""
                {"op":"getStatus","requestId":"short"}
                """, BEARER, null).status());
        assertEquals(400, handler.ops("""
                {"op":"getStatus"}
                """, BEARER, null).status());
        assertEquals(400, handler.ops("""
                {"op":"getStatus","requestId":"bad id here"}
                """, BEARER, null).status());
    }

    @Test
    void rejectsInvalidWhitelistPayloadsBeforeTouchingTheServer() {
        assertEquals(400, handler.ops("""
                {"op":"whitelistAddJava","requestId":"abcdefgh","uuid":"nope","username":"Notch"}
                """, BEARER, null).status());
        assertEquals(400, handler.ops("""
                {"op":"whitelistAddJava","requestId":"abcdefgh",
                 "uuid":"069a79f4-44e9-4726-a5be-ca90e38aaf51","username":"bad name"}
                """, BEARER, null).status());
        assertEquals(400, handler.ops("""
                {"op":"whitelistAddJava","requestId":"abcdefgh",
                 "uuid":"069a79f4-44e9-4726-a5be-ca90e38aaf51","username":"Notch; op"}
                """, BEARER, null).status());
        assertEquals(400, handler.ops("""
                {"op":"whitelistAddBedrock","requestId":"abcdefgh","gamertag":"\\"quoted\\""}
                """, BEARER, null).status());
        assertEquals(400, handler.ops("""
                {"op":"whitelistAddBedrock","requestId":"abcdefgh","gamertag":"Kid","xuid":"abc"}
                """, BEARER, null).status());
    }

    // ------------------------------------------------------------------
    // safe read operations
    // ------------------------------------------------------------------

    @Test
    void healthReportsPluginState() {
        HttpResult result = handler.health();
        assertEquals(200, result.status());
        assertTrue(result.body().contains("\"ok\":true"));
        assertTrue(result.body().contains("\"minecraft\":true"));
        assertTrue(result.body().contains("\"version\":\"1.0.0\""));
    }

    @Test
    void getWhitelistFiltersBrokenEntries() {
        HttpResult result = handler.ops(json("getWhitelist"), BEARER, null);
        assertEquals(200, result.status());
        assertTrue(result.body().contains("Steve"));
        assertTrue(result.body().contains(".BedrockKid"));
        assertTrue(result.body().contains("\"edition\":\"BEDROCK\""));
        assertFalse(result.body().contains("not-a-uuid"), "invalid uuid entries must be dropped: " + result.body());
        assertFalse(result.body().contains("\"Bad\""), "entries without a valid uuid must be dropped");
    }

    @Test
    void getPlaytimeReadsTheStatsFile() {
        HttpResult result = handler.ops("""
                {"op":"getPlaytime","requestId":"abcdefgh",
                 "uuid":"069a79f4-44e9-4726-a5be-ca90e38aaf51"}
                """, BEARER, null);
        assertEquals(200, result.status());
        assertTrue(result.body().contains("\"seconds\":3600"));
        assertTrue(result.body().contains("\"ticks\":72000"));
        assertTrue(result.body().contains("\"source\":\"file\""));
    }

    @Test
    void getPlaytimeForUnknownPlayerIsZeroButStillSucceeds() {
        HttpResult result = handler.ops("""
                {"op":"getPlaytime","requestId":"abcdefgh",
                 "uuid":"11111111-2222-3333-4444-555555555555"}
                """, BEARER, null);
        assertEquals(200, result.status());
        assertTrue(result.body().contains("\"seconds\":0"));
        assertTrue(result.body().contains("\"source\":\"none\""));
    }

    private static String json(String op) {
        return "{\"op\":\"" + op + "\",\"requestId\":\"abcdefgh\"}";
    }
}
