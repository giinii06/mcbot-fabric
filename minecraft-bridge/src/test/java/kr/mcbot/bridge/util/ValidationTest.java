package kr.mcbot.bridge.util;

import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ValidationTest {

    @Test
    void acceptsRealUuids() {
        assertTrue(Validation.isValidUuid("069a79f4-44e9-4726-a5be-ca90e38aaf51"));
        assertTrue(Validation.isValidUuid("00000000-0000-0000-0000-069a79f444e9"));
        assertFalse(Validation.isValidUuid("not-a-uuid"));
        assertFalse(Validation.isValidUuid(null));
        assertFalse(Validation.isValidUuid("069a79f444e94726a5befca90e38aaf51"));
    }

    @Test
    void javaNamesAreStrict() {
        assertTrue(Validation.isValidJavaName("Notch_123"));
        assertFalse(Validation.isValidJavaName("ab"));
        assertFalse(Validation.isValidJavaName("waytoolongusername1"));
        assertFalse(Validation.isValidJavaName("bad name"));
        assertFalse(Validation.isValidJavaName("name; op"));
        assertFalse(Validation.isValidJavaName(null));
    }

    @Test
    void gamertagsAllowSpacesButNoInjection() {
        assertTrue(Validation.isValidGamertag("Master Chief"));
        assertTrue(Validation.isValidGamertag("player_one"));
        assertFalse(Validation.isValidGamertag("\"quoted\""));
        assertFalse(Validation.isValidGamertag("a;b"));
        assertFalse(Validation.isValidGamertag(""));
        assertFalse(Validation.isValidGamertag(".prefixed"));
    }

    @Test
    void requestIdsAreBounded() {
        assertTrue(Validation.isValidRequestId("req-12345678"));
        assertFalse(Validation.isValidRequestId("short"));
        assertFalse(Validation.isValidRequestId("has spaces here"));
        assertFalse(Validation.isValidRequestId(null));
    }

    @Test
    void xuidRoundTripMatchesFloodgate() {
        // ground truth from org.geysermc.floodgate.util.Utils#getJavaUuid(long)
        String uuid = Validation.bedrockUuid("2535453759792258");
        assertEquals("00000000-0000-0000-0009-01fb54b26482", uuid);
        assertTrue(Validation.isBedrockUuid(uuid));
        assertTrue(Validation.isValidUuid(uuid));
        assertEquals("2535453759792258", Validation.xuidFromBedrockUuid(uuid));
        assertTrue(Validation.isValidXuid(Validation.xuidFromBedrockUuid(uuid)));
    }

    @Test
    void smallXuidStillUsesTheFirstGroups() {
        assertEquals("00000000-0000-0000-0000-000000000001", Validation.bedrockUuid("1"));
        assertTrue(Validation.isValidUuid(Validation.bedrockUuid("1")));
        assertFalse(Validation.isBedrockUuid(UUID.randomUUID().toString()));
        assertFalse(Validation.isBedrockUuid(null));
        assertNull(Validation.xuidFromBedrockUuid("not-a-uuid"));
        assertNull(Validation.xuidFromBedrockUuid("069a79f4-44e9-4726-a5be-ca90e38aaf51"));
    }

    @Test
    void sanitizeStripsCoordinatesAndControlCharacters() {
        String raw = "Steve fell from a high place (-123, 64, -456) in x=78";
        String clean = Validation.sanitizeText(raw, 400);
        assertFalse(clean.contains("-123"));
        assertFalse(clean.contains("x=78"));
        assertTrue(clean.contains("fell from a high place"));
    }

    @Test
    void sanitizeCapsLength() {
        String clean = Validation.sanitizeText("a".repeat(500), 50);
        assertEquals(50, clean.length());
        assertTrue(clean.endsWith("..."));
    }

    @Test
    void sanitizeHandlesNull() {
        assertEquals("", Validation.sanitizeText(null, 50));
    }
}
