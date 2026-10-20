package kr.mcbot.bridge.events;

import com.google.gson.JsonParser;
import com.sun.net.httpserver.HttpServer;
import io.papermc.paper.chat.ChatRenderer;
import io.papermc.paper.event.player.AsyncChatEvent;
import kr.mcbot.bridge.publish.EventPublisher;
import net.kyori.adventure.text.Component;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Proxy;
import java.net.InetSocketAddress;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;

import static org.junit.jupiter.api.Assertions.*;

class ChatListenerTest {
    @Test
    void deliversPublicChatWithoutFormattingOrControlCharacters() throws Exception {
        var received = new LinkedBlockingQueue<String>();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/bridge/events", exchange -> {
            received.add(new String(exchange.getRequestBody().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
        });
        server.start();
        var publisher = new EventPublisher("http://127.0.0.1:" + server.getAddress().getPort(),
                "test-secret-123456", 8, 1, 1000, 1000, 0, Logger.getLogger("test"));
        try {
            Player player = (Player) Proxy.newProxyInstance(Player.class.getClassLoader(), new Class<?>[]{Player.class},
                    (proxy, method, args) -> switch (method.getName()) {
                        case "getUniqueId" -> UUID.fromString("069a79f4-44e9-4726-a5be-ca90e38aaf51");
                        case "getName" -> "Notch";
                        default -> null;
                    });
            var listener = new ChatListener(publisher);
            var message = Component.text("안녕 @everyone x=123 (1, 64, 2)\n");
            var event = new AsyncChatEvent(true, player, Set.of(), ChatRenderer.defaultRenderer(), message, message, null);
            listener.onChat(event);
            assertFalse(event.isCancelled());
            String body = received.poll(3, TimeUnit.SECONDS);
            assertNotNull(body);
            var payload = JsonParser.parseString(body).getAsJsonObject();
            assertEquals("player.chat", payload.get("type").getAsString());
            assertEquals("Notch", payload.getAsJsonObject("player").get("username").getAsString());
            assertEquals("안녕 @everyone x=123 (1, 64, 2)", payload.get("message").getAsString());
            listener.onChat(new AsyncChatEvent(true, player, Set.of(), ChatRenderer.defaultRenderer(),
                    Component.text(" \n "), Component.empty(), null));
            assertNull(received.poll(100, TimeUnit.MILLISECONDS));
        } finally {
            publisher.shutdown(1000);
            server.stop(0);
        }
    }
}
