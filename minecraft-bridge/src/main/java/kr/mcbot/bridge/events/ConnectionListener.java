package kr.mcbot.bridge.events;

import kr.mcbot.bridge.bridge.PlayerIdentity;
import kr.mcbot.bridge.publish.EventPublisher;
import kr.mcbot.bridge.util.Validation;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Join / quit events -> Discord log channel. */
public final class ConnectionListener implements Listener {

    private final EventPublisher publisher;

    public ConnectionListener(EventPublisher publisher) {
        this.publisher = publisher;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onJoin(PlayerJoinEvent event) {
        publisher.submit(base("player.join", event.getPlayer().getUniqueId(), event.getPlayer().getName()));
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onQuit(PlayerQuitEvent event) {
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
