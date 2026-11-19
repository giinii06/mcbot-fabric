package kr.mcbot.bridge.runtime;

import kr.mcbot.bridge.bridge.BridgeHttpServer;
import kr.mcbot.bridge.bridge.OpsHandler;
import kr.mcbot.bridge.bridge.PlayerIdentity;
import kr.mcbot.bridge.config.BridgeConfig;
import kr.mcbot.bridge.publish.EventPublisher;
import kr.mcbot.bridge.stats.DeathCounter;
import kr.mcbot.bridge.stats.StatsFileReader;
import kr.mcbot.bridge.util.Validation;
import net.minecraft.advancement.AdvancementDisplay;
import net.minecraft.advancement.AdvancementEntry;
import net.minecraft.advancement.AdvancementProgress;
import net.minecraft.entity.Entity;
import net.minecraft.entity.damage.DamageSource;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.util.WorldSavePath;
import org.slf4j.Logger;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Owns the bridge for one server lifecycle: HTTP listener, event publisher,
 * whitelist/playtime services and the Fabric event handlers.
 *
 * <p>All methods are called from the server thread except the HTTP handler
 * itself, which hops onto the server thread through {@link FabricOpsBackend}.</p>
 */
public final class BridgeRuntime {

    private final BridgeConfig config;
    private final String secret;
    private final String version;
    private final Logger logger;

    private final Set<String> announcedAdvancements = ConcurrentHashMap.newKeySet();

    private volatile MinecraftServer server;
    private volatile EventPublisher publisher;
    private volatile FabricPlaytime playtime;
    private volatile DeathCounter deaths;
    private volatile BridgeHttpServer httpServer;

    public BridgeRuntime(BridgeConfig config, String secret, String version, Logger logger) {
        this.config = config;
        this.secret = secret;
        this.version = version;
        this.logger = logger;
    }

    // ------------------------------------------------------------------
    // lifecycle
    // ------------------------------------------------------------------

    public void onServerStarted(MinecraftServer startedServer) {
        this.server = startedServer;

        Path statsDir = StatsFileReader.statsDirectory(startedServer.getSavePath(WorldSavePath.ROOT));
        this.deaths = new DeathCounter(statsDir);
        this.playtime = new FabricPlaytime(startedServer, logger, 15_000L, 256);

        this.publisher = new EventPublisher(
                config.botBaseUrl,
                secret,
                config.queue.capacity,
                config.queue.workers,
                config.timeouts.botConnectMs,
                config.timeouts.botRequestMs,
                config.queue.retry,
                logger);

        FabricWhitelist whitelist = new FabricWhitelist(startedServer, logger);
        FabricOpsBackend backend = new FabricOpsBackend(
                startedServer, whitelist, playtime, config.timeouts.syncTaskMs);
        OpsHandler handler = new OpsHandler(backend, secret, version, logger);

        try {
            BridgeHttpServer started = new BridgeHttpServer(
                    config.bind, config.port, config.queue.workers, handler, logger);
            started.start();
            this.httpServer = started;
        } catch (Exception ex) {
            logger.error("failed to start bridge http server on {}:{} - {}",
                    config.bind, config.port, ex.getMessage());
        }

        this.playtime.refreshOnlineSnapshot();
        publishStatus("started");

        logger.info("MinecraftBridge {} listening on {}:{} -> {} (mods: Fabric, server {})",
                version, config.bind, config.port, config.botBaseUrl, startedServer.getVersion());
    }

    public void onServerStopping(MinecraftServer stoppingServer) {
        EventPublisher current = publisher;
        if (current != null) {
            publishStatus("stopped");
            current.shutdown(2000L);
        }
        BridgeHttpServer http = httpServer;
        if (http != null) {
            http.stop();
        }
        httpServer = null;
        publisher = null;
        playtime = null;
        deaths = null;
        announcedAdvancements.clear();
        logger.info("MinecraftBridge stopped");
    }

    public void onTick(MinecraftServer tickingServer) {
        FabricPlaytime current = playtime;
        if (current != null && tickingServer.getTicks() % 200 == 0) {
            current.refreshOnlineSnapshot();
        }
    }

    // ------------------------------------------------------------------
    // player events (server thread)
    // ------------------------------------------------------------------

    public void onJoin(ServerPlayerEntity player) {
        EventPublisher current = publisher;
        if (current == null) {
            return;
        }
        DeathCounter counter = deaths;
        if (counter != null) {
            counter.onJoin(player.getUuid());
        }
        current.submit(base("player.join", player.getUuid(), player.getNameForScoreboard()));
    }

    public void onDisconnect(ServerPlayerEntity player) {
        EventPublisher current = publisher;
        if (current == null) {
            return;
        }
        DeathCounter counter = deaths;
        if (counter != null) {
            counter.onQuit(player.getUuid());
        }
        String prefix = player.getUuidAsString() + ":";
        announcedAdvancements.removeIf(key -> key.startsWith(prefix));
        current.submit(base("player.quit", player.getUuid(), player.getNameForScoreboard()));
    }

    public void onChat(ServerPlayerEntity player, String rawMessage) {
        EventPublisher current = publisher;
        if (current == null) {
            return;
        }
        String message = rawMessage == null ? "" : rawMessage.replaceAll("[\\p{Cntrl}]", "").strip();
        if (message.isEmpty()) {
            return;
        }
        if (message.length() > 1024) {
            message = message.substring(0, 1024);
        }
        Map<String, Object> payload = base("player.chat", player.getUuid(), player.getNameForScoreboard());
        payload.put("message", message);
        current.submit(payload);
    }

    public void onDeath(ServerPlayerEntity player, DamageSource source) {
        EventPublisher current = publisher;
        if (current == null) {
            return;
        }

        Map<String, Object> payload = base("player.death", player.getUuid(), player.getNameForScoreboard());
        String message = "";
        try {
            message = Validation.sanitizeText(player.getDamageTracker().getDeathMessage().getString(), 400);
        } catch (RuntimeException ignored) {
            // the damage tracker may already be reset; a null message is valid
        }
        payload.put("message", message.isEmpty() ? null : message);

        String cause = null;
        if (source != null) {
            var key = source.getTypeRegistryEntry().getKey();
            if (key.isPresent()) {
                cause = key.get().getValue().getPath();
            }
        }
        payload.put("cause", cause == null ? null : Validation.sanitizeText(cause, 64));

        String killer = null;
        if (source != null) {
            Entity attacker = source.getAttacker();
            if (attacker != null && !attacker.getUuid().equals(player.getUuid())) {
                killer = Validation.sanitizeText(attacker.getName().getString(), 32);
            }
        }
        payload.put("killer", killer == null || killer.isEmpty() ? null : killer);

        DeathCounter counter = deaths;
        payload.put("deathCount", counter == null ? null : counter.onDeath(player.getUuid()));
        current.submit(payload);
    }

    public void onAdvancement(ServerPlayerEntity player, AdvancementEntry entry) {
        EventPublisher current = publisher;
        if (current == null || entry == null) {
            return;
        }
        Optional<AdvancementDisplay> display = entry.value().display();
        if (display.isEmpty() || !display.get().shouldAnnounceToChat()) {
            return;
        }
        AdvancementProgress progress = player.getAdvancementTracker().getProgress(entry);
        if (progress == null || !progress.isDone()) {
            return;
        }
        String dedupe = player.getUuidAsString() + ":" + entry.id();
        if (!announcedAdvancements.add(dedupe)) {
            return;
        }

        AdvancementDisplay view = display.get();
        Map<String, Object> advancement = new LinkedHashMap<>();
        advancement.put("key", Validation.sanitizeText(entry.id().toString(), 160));
        advancement.put("title", Validation.sanitizeText(view.getTitle().getString(), 200));
        String description = Validation.sanitizeText(view.getDescription().getString(), 600);
        advancement.put("description", description.isEmpty() ? null : description);
        advancement.put("frame", view.getFrame().name());

        Map<String, Object> payload = base("player.advancement", player.getUuid(), player.getNameForScoreboard());
        payload.put("advancement", advancement);
        current.submit(payload);
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    private Map<String, Object> base(String type, UUID uuid, String name) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("type", type);
        payload.put("player", PlayerIdentity.playerRef(uuid, name));
        return payload;
    }

    private void publishStatus(String status) {
        EventPublisher current = publisher;
        MinecraftServer currentServer = server;
        if (current == null || currentServer == null) {
            return;
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("type", "server.status");
        payload.put("status", status);
        List<ServerPlayerEntity> players = currentServer.getPlayerManager().getPlayerList();
        payload.put("online", players.size());
        payload.put("max", currentServer.getPlayerManager().getMaxPlayerCount());
        List<Map<String, Object>> refs = new ArrayList<>();
        for (ServerPlayerEntity player : players) {
            refs.add(PlayerIdentity.playerRef(player.getUuid(), player.getNameForScoreboard()));
        }
        payload.put("players", refs);
        current.submit(payload);
    }
}
