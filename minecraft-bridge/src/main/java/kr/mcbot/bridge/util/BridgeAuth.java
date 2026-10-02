package kr.mcbot.bridge.util;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;

/** Constant-time secret handling for the bridge HTTP API. */
public final class BridgeAuth {

    private BridgeAuth() {
    }

    public static boolean constantTimeEquals(String provided, String expected) {
        if (provided == null || expected == null) {
            return false;
        }
        byte[] a = provided.getBytes(StandardCharsets.UTF_8);
        byte[] b = expected.getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(a, b);
    }

    /** Accepts `Authorization: Bearer <secret>` or `X-Bridge-Secret: <secret>`. */
    public static boolean isAuthorized(String authorizationHeader, String bridgeSecretHeader, String expected) {
        if (expected == null || expected.isEmpty()) {
            return false;
        }
        String provided = null;
        if (authorizationHeader != null && !authorizationHeader.isBlank()) {
            String value = authorizationHeader.trim();
            String lower = value.toLowerCase(Locale.ROOT);
            if (lower.startsWith("bearer ")) {
                provided = value.substring(7).trim();
            }
        }
        if (provided == null && bridgeSecretHeader != null && !bridgeSecretHeader.isBlank()) {
            provided = bridgeSecretHeader.trim();
        }
        if (provided == null) {
            return false;
        }
        return constantTimeEquals(provided, expected);
    }
}
