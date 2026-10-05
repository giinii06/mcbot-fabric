package kr.mcbot.bridge;

import kr.mcbot.bridge.bridge.BridgeHttpServer;
import kr.mcbot.bridge.bridge.OpsHandler;
import kr.mcbot.bridge.bridge.PlayerIdentity;
import kr.mcbot.bridge.events.AdvancementListener;
import kr.mcbot.bridge.events.ConnectionListener;
import kr.mcbot.bridge.events.DeathListener;
import kr.mcbot.bridge.publish.EventPublisher;
import kr.mcbot.bridge.stats.DeathCounter;
import kr.mcbot.bridge.stats.PlaytimeService;
import kr.mcbot.bridge.whitelist.WhitelistService;
import org.bukkit.Bukkit;
import org.bukkit.GameRule;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.world.WorldLoadEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

import java.io.File;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Discord bot &lt;-&gt; Minecraft bridge.
 *
 * Exposes a small typed HTTP API on the private Docker network (whitelist and
 * query operations only) and pushes gameplay events to the bot. Nothing in
 * here polls logs, tails files or executes arbitrary server commands.
 */
public final class MinecraftBridgePlugin extends JavaPlugin {

    /** Hard cap shown everywhere (Discord status, server list) - kept in code. */
    private static final int MAX_PLAYERS = 1000;

    private BridgeHttpServer httpServer;
    private EventPublisher publisher;
    private PlaytimeService playtime;
    private BukkitTask snapshotTask;

    @Override
    public void onEnable() {
        saveDefaultConfig();

        Bukkit.setMaxPlayers(MAX_PLAYERS);

        boolean enabled = getConfig().getBoolean("enabled", true);
        String secret = getConfig().getString("bot.secret", "");
        if (!enabled) {
            getLogger().info("disabled via config (enabled: false)");
            getServer().getPluginManager().disablePlugin(this);
            return;
        }
        if (secret == null || secret.length() < 16 || "CHANGE_ME".equals(secret)) {
            getLogger().severe("bot.secret is missing or still the placeholder.");
            getLogger().severe("Set plugins/MinecraftBridge/config.yml -> bot.secret to the MC_BRIDGE_SECRET of the Discord bot.");
            getServer().getPluginManager().disablePlugin(this);
            return;
        }

        String botUrl = getConfig().getString("bot.base-url", "http://mcbot:47865");
        String bind = getConfig().getString("server.bind", "0.0.0.0");
        int port = getConfig().getInt("server.port", 8765);
        int httpThreads = getConfig().getInt("queue.workers", 2);
        int queueCapacity = getConfig().getInt("queue.capacity", 200);
        int workers = getConfig().getInt("queue.workers", 2);
        int retries = getConfig().getInt("queue.retry", 1);
        int connectMs = getConfig().getInt("timeouts.bot-connect-ms", 3000);
        int requestMs = getConfig().getInt("timeouts.bot-request-ms", 3000);
        int syncMs = getConfig().getInt("timeouts.sync-task-ms", 4000);

        File worldContainer = Bukkit.getWorldContainer();
        WhitelistService whitelist = new WhitelistService(getLogger(), worldContainer);
        Path statsDir = resolveStatsDir();
        playtime = new PlaytimeService(getLogger(), statsDir, 15_000L, 256);

        publisher = new EventPublisher(botUrl, secret, queueCapacity, workers, connectMs, requestMs, retries, getLogger());

        OpsHandler ops = new OpsHandler(this, whitelist, playtime, secret, getPluginMeta().getVersion(), syncMs, getLogger());
        try {
            httpServer = new BridgeHttpServer(bind, port, httpThreads, ops, getLogger());
            httpServer.start();
        } catch (Exception ex) {
            getLogger().severe("failed to start bridge http server: " + ex.getMessage());
            getServer().getPluginManager().disablePlugin(this);
            return;
        }

        enforceKeepInventory();
        getServer().getPluginManager().registerEvents(new KeepInventoryListener(), this);

        DeathCounter deathCounter = new DeathCounter(resolveStatsDir());
        getServer().getPluginManager().registerEvents(new ConnectionListener(publisher, deathCounter), this);
        getServer().getPluginManager().registerEvents(new DeathListener(publisher, deathCounter), this);
        getServer().getPluginManager().registerEvents(new AdvancementListener(publisher), this);

        snapshotTask = Bukkit.getScheduler().runTaskTimer(
                this,
                () -> playtime.refreshOnlineSnapshot(),
                200L,
                200L);

        String apiState = playtime.selfCheck();
        getLogger().info("playtime api self-check: " + apiState);

        // give the server a moment to finish booting before announcing "started"
        Bukkit.getScheduler().runTaskLater(this, () -> publishStatus("started"), 100L);

        getLogger().info("MinecraftBridge listening on " + bind + ":" + httpServer.port() + " -> " + botUrl);
    }

    @Override
    public void onDisable() {
        if (publisher != null) {
            publishStatus("stopped");
            publisher.shutdown(2500L);
        }
        if (snapshotTask != null) {
            snapshotTask.cancel();
            snapshotTask = null;
        }
        if (httpServer != null) {
            httpServer.stop();
            httpServer = null;
        }
        getLogger().info("MinecraftBridge disabled");
    }

    /**
     * keepInventory is tracked per dimension in Java Edition, so the rule has to
     * be forced on every world (overworld, nether, end) and kept on for worlds
     * that load later.
     */
    private void enforceKeepInventory() {
        for (World world : Bukkit.getWorlds()) {
            applyKeepInventory(world);
        }
    }

    private void applyKeepInventory(World world) {
        world.setGameRule(GameRule.KEEP_INVENTORY, true);
        getLogger().info("keepInventory=true enforced on " + world.getName());
    }

    private final class KeepInventoryListener implements Listener {
        @EventHandler
        public void onWorldLoad(WorldLoadEvent event) {
            applyKeepInventory(event.getWorld());
        }
    }

    private Path resolveStatsDir() {
        List<World> worlds = Bukkit.getWorlds();
        if (worlds.isEmpty()) {
            return null;
        }
        World main = worlds.get(0);
        return main.getWorldFolder().toPath().resolve("stats");
    }

    private void publishStatus(String status) {
        if (publisher == null) {
            return;
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("type", "server.status");
        payload.put("status", status);
        payload.put("online", Bukkit.getOnlinePlayers().size());
        payload.put("max", Bukkit.getMaxPlayers());
        List<Map<String, Object>> players = new ArrayList<>();
        for (Player player : Bukkit.getOnlinePlayers()) {
            players.add(PlayerIdentity.playerRef(player.getUniqueId(), player.getName()));
        }
        payload.put("players", players);
        publisher.submit(payload);
    }
}
