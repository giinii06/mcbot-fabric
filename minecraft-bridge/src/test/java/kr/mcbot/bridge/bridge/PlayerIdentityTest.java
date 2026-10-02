package kr.mcbot.bridge.bridge;

import kr.mcbot.bridge.util.Validation;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PlayerIdentityTest {

    @Test
    void randomUuidIsJava() {
        UUID uuid = UUID.randomUUID();
        assertFalse(PlayerIdentity.isBedrock(uuid, "Notch"));
        assertEquals("JAVA", PlayerIdentity.editionOf(uuid, "Notch"));
        assertNull(PlayerIdentity.xuidOf(uuid));
    }

    @Test
    void xuidBasedUuidIsBedrock() {
        String xuid = "2535453759792258";
        UUID uuid = UUID.fromString(Validation.bedrockUuid(xuid));
        assertTrue(PlayerIdentity.isBedrock(uuid, "BedrockKid"));
        assertEquals("BEDROCK", PlayerIdentity.editionOf(uuid, "BedrockKid"));
        assertEquals(xuid, PlayerIdentity.xuidOf(uuid));
    }

    @Test
    void floodgatePrefixMarksBedrock() {
        UUID uuid = UUID.randomUUID();
        assertTrue(PlayerIdentity.isBedrock(uuid, ".prefixed"));
        assertEquals("BEDROCK", PlayerIdentity.editionOf(uuid, ".prefixed"));
    }

    @Test
    void playerRefShapeMatchesBridgeSchema() {
        UUID uuid = UUID.fromString("069a79f4-44e9-4726-a5be-ca90e38aaf51");
        Map<String, Object> ref = PlayerIdentity.playerRef(uuid, "Notch");
        assertEquals("069a79f4-44e9-4726-a5be-ca90e38aaf51", ref.get("uuid"));
        assertEquals("Notch", ref.get("username"));
        assertEquals("JAVA", ref.get("edition"));
        assertNull(ref.get("xuid"));
    }

    @Test
    void playerRefCarriesXuidForBedrock() {
        String xuid = "2535453759792258";
        UUID uuid = UUID.fromString(Validation.bedrockUuid(xuid));
        Map<String, Object> ref = PlayerIdentity.playerRef(uuid, "BedrockKid");
        assertEquals("BEDROCK", ref.get("edition"));
        assertEquals(xuid, ref.get("xuid"));
        assertEquals("BedrockKid", ref.get("username"));
    }
}
