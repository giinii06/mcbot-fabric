package kr.mcbot.bridge.bridge;

import java.util.Arrays;
import java.util.Optional;

/**
 * The complete set of operations the Discord bot may perform. There is
 * deliberately no generic "run this Minecraft command" operation.
 */
public enum Ops {
    WHITELIST_ADD_JAVA("whitelistAddJava"),
    WHITELIST_REMOVE_JAVA("whitelistRemoveJava"),
    WHITELIST_ADD_BEDROCK("whitelistAddBedrock"),
    WHITELIST_REMOVE_BEDROCK("whitelistRemoveBedrock"),
    GET_WHITELIST("getWhitelist"),
    GET_PLAYTIME("getPlaytime"),
    GET_ONLINE_PLAYERS("getOnlinePlayers"),
    GET_STATUS("getStatus");

    private final String wireName;

    Ops(String wireName) {
        this.wireName = wireName;
    }

    public String wireName() {
        return wireName;
    }

    public static Optional<Ops> fromWire(String value) {
        if (value == null) {
            return Optional.empty();
        }
        return Arrays.stream(values()).filter(op -> op.wireName.equals(value)).findFirst();
    }
}
