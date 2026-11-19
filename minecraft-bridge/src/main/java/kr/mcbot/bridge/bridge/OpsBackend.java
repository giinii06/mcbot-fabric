package kr.mcbot.bridge.bridge;

import java.util.List;
import java.util.UUID;

/**
 * The small, typed surface the HTTP layer needs from the Minecraft server.
 *
 * <p>Implementations must run every game-state access on the server thread.
 * Keeping the interface free of Minecraft types makes the request parsing and
 * the response schema unit-testable without a running server.</p>
 */
public interface OpsBackend {

    record MutationResult(boolean ok, boolean applied, String reason) {
        public static MutationResult ok(boolean applied) {
            return new MutationResult(true, applied, null);
        }

        public static MutationResult fail(String reason) {
            return new MutationResult(false, false, reason);
        }
    }

    record WhitelistItem(String uuid, String name) {
    }

    record Playtime(long ticks, long seconds, String source) {
    }

    record OnlinePlayer(String uuid, String username) {
    }

    record ServerStatus(
            boolean ok,
            int online,
            int max,
            String version,
            boolean whitelistEnabled,
            boolean enforceWhitelist) {
    }

    MutationResult addJava(UUID uuid, String username);

    MutationResult removeJava(UUID uuid, String username);

    List<WhitelistItem> whitelist();

    Playtime playtime(UUID uuid);

    List<OnlinePlayer> onlinePlayers();

    ServerStatus status();

    /** The server is stopping or its executor rejected the task. */
    class BackendUnavailableException extends RuntimeException {
        public BackendUnavailableException() {
            super("server unavailable");
        }
    }

    /** The server thread did not finish the task within the configured timeout. */
    class BackendTimeoutException extends RuntimeException {
        public BackendTimeoutException() {
            super("server busy");
        }
    }

    /** A game-state operation failed unexpectedly. */
    class BackendFailureException extends RuntimeException {
        public BackendFailureException(Throwable cause) {
            super(cause == null ? "game operation failed" : cause.getMessage(), cause);
        }
    }
}
