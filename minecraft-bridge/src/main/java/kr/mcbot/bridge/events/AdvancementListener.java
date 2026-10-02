package kr.mcbot.bridge.events;

import io.papermc.paper.advancement.AdvancementDisplay;
import kr.mcbot.bridge.bridge.PlayerIdentity;
import kr.mcbot.bridge.publish.EventPublisher;
import kr.mcbot.bridge.util.ComponentText;
import kr.mcbot.bridge.util.Validation;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerAdvancementDoneEvent;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Advancement events -> Discord log channel.
 *
 * `message()` is null when the advancement is not announced to chat (recipe
 * unlocks, roots, advancements with announce-to-chat disabled), so those are
 * filtered out here - only publicly announced advancements are published.
 */
public final class AdvancementListener implements Listener {

    private final EventPublisher publisher;

    public AdvancementListener(EventPublisher publisher) {
        this.publisher = publisher;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onAdvancement(PlayerAdvancementDoneEvent event) {
        if (event.message() == null) {
            return;
        }
        AdvancementDisplay display = event.getAdvancement().getDisplay();
        if (display == null || !display.doesAnnounceToChat()) {
            return;
        }

        String title = Validation.sanitizeText(ComponentText.plain(display.title()), 200);
        if (title.isEmpty()) {
            title = Validation.sanitizeText(event.getAdvancement().getKey().toString(), 200);
        }
        String description = Validation.sanitizeText(ComponentText.plain(display.description()), 600);
        String key = Validation.sanitizeText(event.getAdvancement().getKey().toString(), 160);

        Map<String, Object> advancement = new LinkedHashMap<>();
        advancement.put("key", key);
        advancement.put("title", title);
        advancement.put("description", description.isEmpty() ? null : description);
        advancement.put("frame", display.frame().name());

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("type", "player.advancement");
        payload.put("player", PlayerIdentity.playerRef(event.getPlayer().getUniqueId(), event.getPlayer().getName()));
        payload.put("advancement", advancement);
        publisher.submit(payload);
    }
}
