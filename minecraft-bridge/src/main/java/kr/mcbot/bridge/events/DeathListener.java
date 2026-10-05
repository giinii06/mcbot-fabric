package kr.mcbot.bridge.events;

import kr.mcbot.bridge.bridge.PlayerIdentity;
import kr.mcbot.bridge.publish.EventPublisher;
import kr.mcbot.bridge.stats.DeathCounter;
import kr.mcbot.bridge.util.ComponentText;
import kr.mcbot.bridge.util.Validation;
import org.bukkit.entity.Entity;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.PlayerDeathEvent;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Death events -> Discord log channel.
 *
 * Only the plain text message, the damage cause and the killer name are
 * published. The payload schema has no coordinate / world / biome fields and
 * coordinate-like fragments are stripped from the message as a second layer.
 */
public final class DeathListener implements Listener {

    private final EventPublisher publisher;
    private final DeathCounter deaths;

    public DeathListener(EventPublisher publisher, DeathCounter deaths) {
        this.publisher = publisher;
        this.deaths = deaths;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onDeath(PlayerDeathEvent event) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("type", "player.death");
        payload.put("player", PlayerIdentity.playerRef(event.getEntity().getUniqueId(), event.getEntity().getName()));

        String message = Validation.sanitizeText(ComponentText.plain(event.deathMessage()), 400);
        payload.put("message", message.isEmpty() ? null : message);

        EntityDamageEvent damage = event.getEntity().getLastDamageCause();
        String cause = null;
        String killer = null;
        if (damage != null) {
            cause = damage.getCause().name().toLowerCase(java.util.Locale.ROOT);
            if (damage instanceof EntityDamageByEntityEvent byEntity) {
                Entity damager = byEntity.getDamager();
                if (damager != null && !damager.getUniqueId().equals(event.getEntity().getUniqueId())) {
                    killer = Validation.sanitizeText(damager.getName(), 32);
                }
            }
        }
        if (killer == null && event.getEntity().getKiller() != null) {
            killer = Validation.sanitizeText(event.getEntity().getKiller().getName(), 32);
        }

        payload.put("cause", cause);
        payload.put("killer", killer == null || killer.isEmpty() ? null : killer);
        payload.put("deathCount", deaths.onDeath(event.getEntity().getUniqueId()));
        publisher.submit(payload);
    }
}
