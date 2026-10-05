package kr.mcbot.bridge.stats;

import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Total deaths per player, for the "n-th death" line in the Discord log.
 *
 * The stats file is only flushed on world save / disconnect, so the number is
 * snapshotted once when the player joins and every death observed while they
 * are online is counted in memory. No file is polled while a player is in the
 * server.
 */
public final class DeathCounter {

    private final Path statsDir;
    private final Map<UUID, Long> base = new HashMap<>();
    private final Map<UUID, Long> session = new HashMap<>();

    public DeathCounter(Path statsDir) {
        this.statsDir = statsDir;
    }

    /** Snapshot the persisted death count when the player connects. */
    public void onJoin(UUID id) {
        base.put(id, read(id));
        session.put(id, 0L);
    }

    public void onQuit(UUID id) {
        base.remove(id);
        session.remove(id);
    }

    /** Total deaths including the death that just happened. */
    public long onDeath(UUID id) {
        long before = base.computeIfAbsent(id, key -> read(key));
        long seen = session.merge(id, 1L, Long::sum);
        return Math.max(1L, before + seen);
    }

    private long read(UUID id) {
        Path file = statsDir == null ? null : statsDir.resolve(id.toString() + ".json");
        long deaths = StatsFileReader.readDeaths(file);
        return deaths > 0 ? deaths : 0L;
    }
}
