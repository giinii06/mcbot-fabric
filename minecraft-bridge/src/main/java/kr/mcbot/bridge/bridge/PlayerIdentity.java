package kr.mcbot.bridge.bridge;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Player identity as seen by the server. Bedrock players connected through
 * Floodgate get {@code new UUID(0, xuid)} (most significant 64 bits zero);
 * everything else is treated as Java Edition.
 */
public final class PlayerIdentity {

    private PlayerIdentity() {
    }

    public static boolean isBedrock(UUID uuid, String name) {
        if (uuid == null) {
            return false;
        }
        if (name != null && name.startsWith(".")) {
            return true;
        }
        return uuid.version() == 0 && uuid.getMostSignificantBits() == 0L;
    }

    public static String editionOf(UUID uuid, String name) {
        return isBedrock(uuid, name) ? "BEDROCK" : "JAVA";
    }

    /** XUID of a Floodgate player, or null when the player is not Bedrock. */
    public static String xuidOf(UUID uuid) {
        if (uuid == null || uuid.version() != 0 || uuid.getMostSignificantBits() != 0L) {
            return null;
        }
        return Long.toUnsignedString(uuid.getLeastSignificantBits());
    }

    public static Map<String, Object> playerRef(UUID uuid, String name) {
        Map<String, Object> ref = new LinkedHashMap<>();
        ref.put("uuid", uuid.toString().toLowerCase(Locale.ROOT));
        ref.put("username", name);
        ref.put("edition", editionOf(uuid, name));
        String xuid = xuidOf(uuid);
        ref.put("xuid", xuid);
        return ref;
    }
}
