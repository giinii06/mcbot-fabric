package kr.mcbot.bridge.whitelist;

import kr.mcbot.bridge.util.Validation;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;

import java.io.File;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.logging.Logger;

/**
 * Whitelist mutations. Every mutating method must run on the main server
 * thread (Bukkit API + command dispatch); `list()` only reads the file and is
 * safe from any thread.
 *
 * Strategy per operation: server command first (writes a proper entry with a
 * name), Bukkit API as fallback, then always verify the resulting state.
 */
public final class WhitelistService {

    public record Result(boolean ok, boolean applied, String reason) {
        static Result ok(boolean applied) {
            return new Result(true, applied, null);
        }

        static Result fail(String reason) {
            return new Result(false, false, reason);
        }
    }

    private final Logger logger;
    private final Path whitelistPath;

    public WhitelistService(Logger logger, File worldContainer) {
        this.logger = logger;
        this.whitelistPath = worldContainer.toPath().resolve("whitelist.json");
    }

    public Path whitelistPath() {
        return whitelistPath;
    }

    // ------------------------------------------------------------------
    // read only (any thread)
    // ------------------------------------------------------------------

    public List<WhitelistFileReader.Entry> list() {
        try {
            return WhitelistFileReader.read(whitelistPath);
        } catch (Exception ex) {
            logger.warning("failed to read whitelist.json: " + ex.getMessage());
            return new ArrayList<>();
        }
    }

    // ------------------------------------------------------------------
    // main thread only
    // ------------------------------------------------------------------

    public boolean contains(UUID uuid) {
        for (OfflinePlayer player : Bukkit.getWhitelistedPlayers()) {
            if (uuid.equals(player.getUniqueId())) {
                return true;
            }
        }
        return false;
    }

    public Result addJava(UUID uuid, String name) {
        if (uuid == null || !Validation.isValidJavaName(name)) {
            return Result.fail("invalid java player identity");
        }
        if (contains(uuid)) {
            return Result.ok(true);
        }

        boolean dispatched = dispatch("whitelist add " + name);
        if (contains(uuid)) {
            return Result.ok(true);
        }

        try {
            OfflinePlayer offline = Bukkit.getOfflinePlayer(uuid);
            offline.setWhitelisted(true);
        } catch (Throwable ex) {
            logger.warning("whitelist api add failed: " + ex.getMessage());
        }
        if (contains(uuid)) {
            return Result.ok(true);
        }

        try {
            Bukkit.reloadWhitelist();
        } catch (Throwable ex) {
            logger.warning("whitelist reload failed: " + ex.getMessage());
        }
        if (contains(uuid)) {
            return Result.ok(true);
        }
        return Result.fail(dispatched ? "whitelist entry was not created" : "whitelist command unavailable");
    }

    public Result removeJava(UUID uuid, String name) {
        if (uuid == null || !Validation.isValidJavaName(name)) {
            return Result.fail("invalid java player identity");
        }
        if (!contains(uuid)) {
            return Result.ok(true);
        }

        boolean dispatched = dispatch("whitelist remove " + name);
        if (!contains(uuid)) {
            return Result.ok(true);
        }

        try {
            OfflinePlayer offline = Bukkit.getOfflinePlayer(uuid);
            offline.setWhitelisted(false);
        } catch (Throwable ex) {
            logger.warning("whitelist api remove failed: " + ex.getMessage());
        }
        if (!contains(uuid)) {
            return Result.ok(true);
        }

        try {
            Bukkit.reloadWhitelist();
        } catch (Throwable ex) {
            logger.warning("whitelist reload failed: " + ex.getMessage());
        }
        if (!contains(uuid)) {
            return Result.ok(true);
        }
        return Result.fail(dispatched ? "whitelist entry could not be removed" : "whitelist command unavailable");
    }

    public Result addBedrock(String gamertag, String xuid) {
        if (!Validation.isValidGamertag(gamertag)) {
            return Result.fail("invalid gamertag");
        }
        if (!Validation.isValidXuid(xuid)) {
            return Result.fail("invalid xuid");
        }
        if (!hasCommand("fwhitelist")) {
            return Result.fail("floodgate fwhitelist command is not available");
        }

        UUID expected = xuid == null || xuid.isBlank() ? null : UUID.fromString(Validation.bedrockUuid(xuid));
        if (expected != null && contains(expected)) {
            return Result.ok(true);
        }
        if (findByName(gamertag) != null) {
            return Result.ok(true);
        }

        dispatch("fwhitelist add " + quote(gamertag));
        if (expected != null && contains(expected)) {
            return Result.ok(true);
        }
        if (findByName(gamertag) != null) {
            return Result.ok(true);
        }
        return Result.fail("bedrock whitelist entry was not created (check the gamertag)");
    }

    public Result removeBedrock(String gamertag, String xuid) {
        if (!Validation.isValidGamertag(gamertag)) {
            return Result.fail("invalid gamertag");
        }
        if (!Validation.isValidXuid(xuid)) {
            return Result.fail("invalid xuid");
        }

        UUID expected = xuid == null || xuid.isBlank() ? null : UUID.fromString(Validation.bedrockUuid(xuid));
        boolean present = (expected != null && contains(expected)) || findByName(gamertag) != null;
        if (!present) {
            return Result.ok(true);
        }
        if (!hasCommand("fwhitelist")) {
            return Result.fail("floodgate fwhitelist command is not available");
        }

        dispatch("fwhitelist remove " + quote(gamertag));
        boolean stillPresent = (expected != null && contains(expected)) || findByName(gamertag) != null;
        if (!stillPresent) {
            return Result.ok(true);
        }
        return Result.fail("bedrock whitelist entry could not be removed");
    }

    // ------------------------------------------------------------------

    private String quote(String gamertag) {
        return "\"" + gamertag.replace("\"", "") + "\"";
    }

    private boolean hasCommand(String name) {
        try {
            return Bukkit.getServer().getCommandMap().getCommand(name) != null;
        } catch (Throwable ex) {
            // command map unavailable - assume present and let the dispatch decide
            return true;
        }
    }

    private UUID findByName(String gamertag) {
        if (gamertag == null) {
            return null;
        }
        String wanted = gamertag.toLowerCase(Locale.ROOT);
        for (WhitelistFileReader.Entry entry : list()) {
            String name = entry.name();
            if (name == null) {
                continue;
            }
            if (name.startsWith(".")) {
                name = name.substring(1);
            }
            if (name.equalsIgnoreCase(gamertag) || name.toLowerCase(Locale.ROOT).equals(wanted)) {
                try {
                    return UUID.fromString(entry.uuid());
                } catch (IllegalArgumentException ignored) {
                    return null;
                }
            }
        }
        return null;
    }

    private boolean dispatch(String commandLine) {
        try {
            return Bukkit.dispatchCommand(Bukkit.getConsoleSender(), commandLine);
        } catch (Throwable ex) {
            logger.warning("command dispatch failed: " + commandLine.split(" ")[0] + " - " + ex.getMessage());
            return false;
        }
    }

    public Set<String> snapshotUuids() {
        Set<String> uuids = new HashSet<>();
        for (WhitelistFileReader.Entry entry : list()) {
            uuids.add(entry.uuid().toLowerCase(Locale.ROOT));
        }
        return uuids;
    }
}
