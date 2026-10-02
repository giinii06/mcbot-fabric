package kr.mcbot.bridge.bridge;

import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OpsTest {

    @Test
    void knownOpsResolve() {
        assertEquals(Optional.of(Ops.WHITELIST_ADD_JAVA), Ops.fromWire("whitelistAddJava"));
        assertEquals(Optional.of(Ops.WHITELIST_REMOVE_JAVA), Ops.fromWire("whitelistRemoveJava"));
        assertEquals(Optional.of(Ops.WHITELIST_ADD_BEDROCK), Ops.fromWire("whitelistAddBedrock"));
        assertEquals(Optional.of(Ops.WHITELIST_REMOVE_BEDROCK), Ops.fromWire("whitelistRemoveBedrock"));
        assertEquals(Optional.of(Ops.GET_WHITELIST), Ops.fromWire("getWhitelist"));
        assertEquals(Optional.of(Ops.GET_PLAYTIME), Ops.fromWire("getPlaytime"));
        assertEquals(Optional.of(Ops.GET_ONLINE_PLAYERS), Ops.fromWire("getOnlinePlayers"));
        assertEquals(Optional.of(Ops.GET_STATUS), Ops.fromWire("getStatus"));
    }

    @Test
    void arbitraryCommandsAreNeverOps() {
        assertTrue(Ops.fromWire("console.exec").isEmpty());
        assertTrue(Ops.fromWire("minecraft/command").isEmpty());
        assertTrue(Ops.fromWire("op give").isEmpty());
        assertTrue(Ops.fromWire("stop").isEmpty());
        assertTrue(Ops.fromWire("whitelist add").isEmpty());
        assertTrue(Ops.fromWire(null).isEmpty());
        assertTrue(Ops.fromWire("").isEmpty());
        assertTrue(Ops.fromWire(" GET_STATUS").isEmpty());
        assertTrue(Ops.fromWire("getstatus").isEmpty());
    }

    @Test
    void wireNamesMatchTheBotContract() {
        assertEquals("whitelistAddJava", Ops.WHITELIST_ADD_JAVA.wireName());
        assertEquals("whitelistRemoveBedrock", Ops.WHITELIST_REMOVE_BEDROCK.wireName());
        assertEquals("getWhitelist", Ops.GET_WHITELIST.wireName());
        assertEquals("getPlaytime", Ops.GET_PLAYTIME.wireName());
        assertEquals("getOnlinePlayers", Ops.GET_ONLINE_PLAYERS.wireName());
        assertEquals("getStatus", Ops.GET_STATUS.wireName());
        assertEquals(8, Ops.values().length);
    }
}
