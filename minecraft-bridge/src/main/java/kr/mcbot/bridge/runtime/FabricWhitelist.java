package kr.mcbot.bridge.runtime;

import com.mojang.authlib.GameProfile;
import kr.mcbot.bridge.whitelist.WhitelistFileReader;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.Whitelist;
import net.minecraft.server.WhitelistEntry;
import org.slf4j.Logger;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Whitelist access through the vanilla server API.
 *
 * <p>Mutations call {@link Whitelist#add}/{@link Whitelist#remove} and then
 * {@link Whitelist#save()}; the running server's {@code whitelist.json} is
 * never rewritten behind its back. The file is read only to report UUID/name
 * pairs (the in-memory API exposes names but not UUIDs) and to verify the
 * result of a mutation.</p>
 *
 * <p>Every method here must be called on the server thread.</p>
 */
public final class FabricWhitelist {

    private final MinecraftServer server;
    private final Logger logger;

    public FabricWhitelist(MinecraftServer server, Logger logger) {
        this.server = server;
        this.logger = logger;
    }

    public Path whitelistPath() {
        return server.getRunDirectory().resolve("whitelist.json");
    }

    public List<WhitelistFileReader.Entry> list() {
        try {
            return WhitelistFileReader.read(whitelistPath());
        } catch (Exception ex) {
            logger.warn("failed to read whitelist.json: {}", ex.getMessage());
            return new ArrayList<>();
        }
    }

    public boolean contains(UUID uuid) {
        return findByUuid(uuid) != null;
    }

    public Result addJava(UUID uuid, String name) {
        Whitelist whitelist = server.getPlayerManager().getWhitelist();
        GameProfile profile = new GameProfile(uuid, name);
        try {
            // Reload first so a whitelist.json edit made while the server is
            // running cannot be turned into a duplicate entry.
            server.getPlayerManager().reloadWhitelist();
            if (findByUuid(uuid) != null) {
                return Result.ok(true);
            }
            whitelist.add(new WhitelistEntry(profile));
            whitelist.save();
        } catch (IOException | RuntimeException ex) {
            logger.warn("whitelist add failed for {}: {}", uuid, ex.getMessage());
            return Result.fail("whitelist could not be saved");
        }

        if (findByUuid(uuid) == null) {
            // Do not leave an entry that exists only in memory.
            try {
                whitelist.remove(profile);
            } catch (RuntimeException ignored) {
                // best effort
            }
            return Result.fail("whitelist entry was not created");
        }
        return Result.ok(true);
    }

    public Result removeJava(UUID uuid, String name) {
        Whitelist whitelist = server.getPlayerManager().getWhitelist();
        try {
            server.getPlayerManager().reloadWhitelist();
            WhitelistFileReader.Entry existing = findByUuid(uuid);
            if (existing == null) {
                return Result.ok(true);
            }
            String storedName = existing.name() == null || existing.name().isBlank() ? name : existing.name();
            GameProfile profile = new GameProfile(uuid, storedName);
            whitelist.remove(profile);
            whitelist.save();
        } catch (IOException | RuntimeException ex) {
            logger.warn("whitelist remove failed for {}: {}", uuid, ex.getMessage());
            return Result.fail("whitelist could not be saved");
        }

        if (findByUuid(uuid) != null) {
            return Result.fail("whitelist entry could not be removed");
        }
        return Result.ok(true);
    }

    public WhitelistFileReader.Entry findByUuid(UUID uuid) {
        if (uuid == null) {
            return null;
        }
        String wanted = uuid.toString().toLowerCase(Locale.ROOT);
        for (WhitelistFileReader.Entry entry : list()) {
            if (entry.uuid() != null && entry.uuid().toLowerCase(Locale.ROOT).equals(wanted)) {
                return entry;
            }
        }
        return null;
    }

    public record Result(boolean ok, boolean applied, String reason) {
        static Result ok(boolean applied) {
            return new Result(true, applied, null);
        }

        static Result fail(String reason) {
            return new Result(false, false, reason);
        }
    }
}
