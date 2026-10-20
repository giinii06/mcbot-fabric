package kr.mcbot.bridge.events;

import io.papermc.paper.event.player.AsyncChatEvent;
import kr.mcbot.bridge.bridge.PlayerIdentity;
import kr.mcbot.bridge.publish.EventPublisher;
import kr.mcbot.bridge.util.ComponentText;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;

import java.util.Map;

public final class ChatListener implements Listener {
    private final EventPublisher publisher;

    public ChatListener(EventPublisher publisher) {
        this.publisher = publisher;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onChat(AsyncChatEvent event) {
        String message = ComponentText.plain(event.message()).replaceAll("[\\p{Cntrl}]", "").strip();
        if (message.isEmpty()) {
            return;
        }
        publisher.submit(Map.of(
                "type", "player.chat",
                "player", PlayerIdentity.playerRef(event.getPlayer().getUniqueId(), event.getPlayer().getName()),
                "message", message.substring(0, Math.min(message.length(), 1024))));
    }
}
