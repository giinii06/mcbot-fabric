package kr.mcbot.bridge.util;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BridgeAuthTest {

    private static final String SECRET = "0123456789abcdef0123456789abcdef";

    @Test
    void acceptsBearerHeader() {
        assertTrue(BridgeAuth.isAuthorized("Bearer " + SECRET, null, SECRET));
        assertTrue(BridgeAuth.isAuthorized("bearer " + SECRET, null, SECRET));
    }

    @Test
    void acceptsSecretHeader() {
        assertTrue(BridgeAuth.isAuthorized(null, SECRET, SECRET));
        assertTrue(BridgeAuth.isAuthorized(null, "  " + SECRET + "  ", SECRET));
    }

    @Test
    void rejectsWrongOrMissingSecret() {
        assertFalse(BridgeAuth.isAuthorized(null, null, SECRET));
        assertFalse(BridgeAuth.isAuthorized("Bearer wrong", null, SECRET));
        assertFalse(BridgeAuth.isAuthorized(null, "wrong", SECRET));
        assertFalse(BridgeAuth.isAuthorized("Basic " + SECRET, null, SECRET));
        assertFalse(BridgeAuth.isAuthorized("", "", SECRET));
        assertFalse(BridgeAuth.isAuthorized(null, null, null));
        assertFalse(BridgeAuth.isAuthorized("Bearer " + SECRET.substring(0, 16), null, SECRET));
    }

    @Test
    void constantTimeEqualsComparesContent() {
        assertTrue(BridgeAuth.constantTimeEquals(SECRET, SECRET));
        assertFalse(BridgeAuth.constantTimeEquals(SECRET, SECRET + "x"));
        assertFalse(BridgeAuth.constantTimeEquals(null, SECRET));
        assertFalse(BridgeAuth.constantTimeEquals(SECRET, null));
    }
}
