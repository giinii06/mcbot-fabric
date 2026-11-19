package kr.mcbot.bridge.runtime;

import kr.mcbot.bridge.stats.StatsFileReader;
import net.minecraft.server.MinecraftServer;
import net.minecraft.stat.Stats;
import net.minecraft.util.WorldSavePath;
import org.slf4j.Logger;

import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Playtime in ticks/seconds.
 *
 * <p>Online players are snapshotted from the server statistic on the server
 * thread every 10 seconds. Offline players are read from the 1.21.1 stats file
 * ({@code <world>/stats/<uuid>.json}) on the HTTP thread - a read-only file
 * access that never touches game state.</p>
 */
public final class FabricPlaytime {

    private record Cached(Playtime value, long fetchedAt) {
    }

    public record Playtime(long ticks, long seconds, String source) {
    }

    private final MinecraftServer server;
    private final Logger logger;
    private final long ttlMillis;
    private final int cacheLimit;
    private final Map<UUID, Long> onlineTicks = new ConcurrentHashMap<>();
    private final Map<UUID, Cached> cache = new ConcurrentHashMap<>();

    public FabricPlaytime(MinecraftServer server, Logger logger, long ttlMillis, int cacheLimit) {
        this.server = server;
        this.logger = logger;
        this.ttlMillis = ttlMillis;
        this.cacheLimit = cacheLimit;
    }

    /** Called from the server thread only. */
    public void refreshOnlineSnapshot() {
        for (var player : server.getPlayerManager().getPlayerList()) {
            try {
                int ticks = player.getStatHandler().getStat(Stats.CUSTOM.getOrCreateStat(Stats.PLAY_TIME));
                onlineTicks.put(player.getUuid(), (long) ticks);
            } catch (Throwable ex) {
                logger.warn("failed to read playtime for {}: {}", player.getUuid(), ex.getMessage());
            }
        }
    }

    /** Safe to call from the bridge HTTP threads. */
    public Playtime get(UUID uuid) {
        long now = System.currentTimeMillis();
        Cached cached = cache.get(uuid);
        if (cached != null && now - cached.fetchedAt() < ttlMillis) {
            return cached.value();
        }

        Long snapshot = onlineTicks.get(uuid);
        Playtime value = snapshot != null
                ? new Playtime(snapshot, StatsFileReader.ticksToSeconds(snapshot), "api")
                : fromFile(uuid);

        if (cache.size() > cacheLimit) {
            cache.clear();
        }
        cache.put(uuid, new Cached(value, now));
        return value;
    }

    private Playtime fromFile(UUID uuid) {
        try {
            long ticks = StatsFileReader.readTicks(statsDirectory().resolve(uuid + ".json"));
            if (ticks == StatsFileReader.NOT_FOUND) {
                return new Playtime(0L, 0L, "none");
            }
            return new Playtime(ticks, StatsFileReader.ticksToSeconds(ticks), "file");
        } catch (Exception ex) {
            logger.warn("failed to read stats for {}: {}", uuid, ex.getMessage());
            return new Playtime(0L, 0L, "none");
        }
    }

    private Path statsDirectory() {
        // 1.21.1 stores stats in <world>/stats; the helper also recognises the
        // newer <world>/players/stats layout without changing the wire format.
        return StatsFileReader.statsDirectory(server.getSavePath(WorldSavePath.ROOT));
    }
}
