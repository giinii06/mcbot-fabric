package kr.mcbot.bridge.events;

import kr.mcbot.bridge.bridge.PlayerIdentity;
import kr.mcbot.bridge.publish.EventPublisher;
import kr.mcbot.bridge.stats.DeathCounter;
import kr.mcbot.bridge.util.Validation;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;
import org.bukkit.event.player.PlayerQuitEvent;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Join / quit events -> Discord log channel. */
public final class ConnectionListener implements Listener {

    private final EventPublisher publisher;
    private final DeathCounter deaths;

    public ConnectionListener(EventPublisher publisher, DeathCounter deaths) {
        this.publisher = publisher;
        this.deaths = deaths;
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onPreLogin(AsyncPlayerPreLoginEvent event) {
        // Floodgate has authenticated the identity even when the whitelist rejects login.
        if (PlayerIdentity.xuidOf(event.getUniqueId()) != null && event.getName().startsWith(".")) {
            publisher.submit(base("player.identity", event.getUniqueId(), event.getName()));
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onJoin(PlayerJoinEvent event) {
        deaths.onJoin(event.getPlayer().getUniqueId());
        publisher.submit(base("player.join", event.getPlayer().getUniqueId(), event.getPlayer().getName()));
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onQuit(PlayerQuitEvent event) {
        deaths.onQuit(event.getPlayer().getUniqueId());
        Map<String, Object> payload = base("player.quit", event.getPlayer().getUniqueId(), event.getPlayer().getName());
        if (event.getReason() != null) {
            payload.put("reason", Validation.sanitizeText(event.getReason().name(), 64));
        }
        publisher.submit(payload);
    }

    private Map<String, Object> base(String type, UUID uuid, String name) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("type", type);
        payload.put("player", PlayerIdentity.playerRef(uuid, name));
        return payload;
    }
}
