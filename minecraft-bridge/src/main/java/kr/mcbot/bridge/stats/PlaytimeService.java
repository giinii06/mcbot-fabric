package kr.mcbot.bridge.stats;

import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.Statistic;

import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;

/**
 * Playtime source.
 *
 * Online players  -> Bukkit statistic (snapshot refreshed on the main thread)
 * Offline players -> player stats JSON, read only, never on the main thread
 *
 * Both paths read the same underlying value which vanilla stores in ticks
 * (20 ticks = 1 second), so the two sources never disagree in unit.
 */
public final class PlaytimeService {

    public record Playtime(long ticks, long seconds, String source) {
    }

    private record Cached(Playtime value, long fetchedAt) {
    }

    private final Logger logger;
    private final Path statsDir;
    private final long ttlMillis;
    private final int cacheLimit;
    private final Map<UUID, Long> onlineTicks = new ConcurrentHashMap<>();
    private final Map<UUID, Cached> cache = new ConcurrentHashMap<>();
    private volatile boolean apiAvailable = true;

    public PlaytimeService(Logger logger, Path statsDir, long ttlMillis, int cacheLimit) {
        this.logger = logger;
        this.statsDir = statsDir;
        this.ttlMillis = ttlMillis;
        this.cacheLimit = cacheLimit;
    }

    /** Called from the main thread only (scheduled task). */
    public void refreshOnlineSnapshot() {
        boolean any = false;
        for (var player : Bukkit.getOnlinePlayers()) {
            try {
                long ticks = player.getStatistic(Statistic.PLAY_ONE_MINUTE);
                onlineTicks.put(player.getUniqueId(), ticks);
                any = true;
                apiAvailable = true;
            } catch (Throwable ex) {
                apiAvailable = false;
            }
        }
        if (!any && !Bukkit.getOnlinePlayers().isEmpty()) {
            apiAvailable = false;
        }
    }

    /** Startup self check - logs whether the Bukkit statistic mapping works. */
    public String selfCheck() {
        try {
            OfflinePlayer probe = Bukkit.getOfflinePlayer(new UUID(0L, 1L));
            probe.getStatistic(Statistic.PLAY_ONE_MINUTE);
            apiAvailable = true;
            return "ok";
        } catch (Throwable ex) {
            apiAvailable = false;
            return "unsupported (" + ex.getClass().getSimpleName() + ")";
        }
    }

    public boolean isApiAvailable() {
        return apiAvailable;
    }

    /** Safe to call from the bridge HTTP threads. */
    public Playtime get(UUID uuid) {
        long now = System.currentTimeMillis();
        Cached cached = cache.get(uuid);
        if (cached != null && now - cached.fetchedAt() < ttlMillis) {
            return cached.value();
        }

        Long snapshot = onlineTicks.get(uuid);
        Playtime value;
        if (snapshot != null) {
            value = new Playtime(snapshot, StatsFileReader.ticksToSeconds(snapshot), "api");
        } else {
            value = fromFile(uuid);
        }

        if (cache.size() > cacheLimit) {
            cache.clear();
        }
        cache.put(uuid, new Cached(value, now));
        return value;
    }

    private Playtime fromFile(UUID uuid) {
        if (statsDir == null) {
            return new Playtime(0L, 0L, "none");
        }
        try {
            long ticks = StatsFileReader.readTicks(statsDir.resolve(uuid + ".json"));
            if (ticks == StatsFileReader.NOT_FOUND) {
                return new Playtime(0L, 0L, "none");
            }
            return new Playtime(ticks, StatsFileReader.ticksToSeconds(ticks), "file");
        } catch (Exception ex) {
            logger.warning("failed to read stats for " + uuid + ": " + ex.getMessage());
            return new Playtime(0L, 0L, "none");
        }
    }
}
