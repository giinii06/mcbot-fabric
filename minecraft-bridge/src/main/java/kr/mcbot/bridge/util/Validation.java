package kr.mcbot.bridge.util;

import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Input validation shared by every bridge operation. Nothing that reaches a
 * Minecraft command may be unvalidated.
 */
public final class Validation {

    private static final Pattern UUID_PATTERN =
            Pattern.compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");
    private static final Pattern JAVA_NAME = Pattern.compile("^[A-Za-z0-9_]{3,16}$");
    private static final Pattern GAMERTAG = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9 _.'-]{0,15}$");
    private static final Pattern XUID = Pattern.compile("^[0-9]{4,20}$");
    private static final Pattern REQUEST_ID = Pattern.compile("^[A-Za-z0-9_-]{8,64}$");
    private static final Pattern CONTROL = Pattern.compile("[\\x00-\\x1f\\x7f]");
    private static final Pattern COORDINATE_TRIPLE =
            Pattern.compile("\\(-?\\d{1,7},\\s*-?\\d{1,7},\\s*-?\\d{1,7}\\)");
    private static final Pattern COORDINATE_ASSIGN =
            Pattern.compile("(?i)\\b[xz]\\s*[=:]\\s*-?\\d{1,7}|\\by\\s*[=:]\\s*-?\\d{1,7}");

    private Validation() {
    }

    public static boolean isValidUuid(String value) {
        return value != null && UUID_PATTERN.matcher(value).matches();
    }

    public static boolean isValidJavaName(String value) {
        return value != null && JAVA_NAME.matcher(value).matches();
    }

    public static boolean isValidGamertag(String value) {
        return value != null && GAMERTAG.matcher(value).matches();
    }

    public static boolean isValidXuid(String value) {
        return value == null || XUID.matcher(value).matches();
    }

    public static boolean isValidRequestId(String value) {
        return value != null && REQUEST_ID.matcher(value).matches();
    }

    public static Optional<UUID> parseUuid(String value) {
        if (!isValidUuid(value)) {
            return Optional.empty();
        }
        return Optional.of(UUID.fromString(value.toLowerCase(Locale.ROOT)));
    }

    /** True for a Floodgate style uuid (most significant 64 bits are zero). */
    public static boolean isBedrockUuid(String uuid) {
        return uuid != null && uuid.toLowerCase(Locale.ROOT).startsWith("00000000-0000-0000-");
    }

    /**
     * Floodgate style uuid: {@code new UUID(0, xuid)}, printed as
     * {@code 00000000-0000-0000-<xuid>} in 8-4-4-4-12 hex groups. This is
     * exactly what {@code org.geysermc.floodgate.util.Utils#getJavaUuid(long)}
     * returns (the fourth group is the top 16 bits of the XUID).
     */
    public static String bedrockUuid(String xuid) {
        long value = new java.math.BigInteger(xuid).longValue();
        return new UUID(0L, value).toString();
    }

    public static String xuidFromBedrockUuid(String uuid) {
        if (uuid == null) {
            return null;
        }
        UUID parsed;
        try {
            parsed = UUID.fromString(uuid.toLowerCase(Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            return null;
        }
        if (parsed.getMostSignificantBits() != 0L) {
            return null;
        }
        return Long.toUnsignedString(parsed.getLeastSignificantBits());
    }

    /**
     * Makes arbitrary server text safe to ship to Discord: control characters
     * removed, coordinate-like fragments stripped, hard length cap.
     * Death payloads must never carry a position.
     */
    public static String sanitizeText(String input, int maxLength) {
        if (input == null || input.isEmpty()) {
            return "";
        }
        String value = input;
        value = COORDINATE_TRIPLE.matcher(value).replaceAll("").trim();
        value = COORDINATE_ASSIGN.matcher(value).replaceAll("").trim();
        value = CONTROL.matcher(value).replaceAll("");
        value = value.replaceAll("\\s{2,}", " ").trim();
        if (value.length() > maxLength) {
            if (maxLength <= 3) {
                return value.substring(0, Math.max(0, maxLength));
            }
            value = value.substring(0, maxLength - 3) + "...";
        }
        return value;
    }
}
