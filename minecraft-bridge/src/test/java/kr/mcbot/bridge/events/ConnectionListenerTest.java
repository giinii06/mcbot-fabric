package kr.mcbot.bridge.events;

import com.google.gson.JsonParser;
import com.sun.net.httpserver.HttpServer;
import com.destroystokyo.paper.profile.PlayerProfile;
import kr.mcbot.bridge.publish.EventPublisher;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;
import org.junit.jupiter.api.Test;

import java.net.InetAddress;
import java.lang.reflect.Proxy;
import java.net.InetSocketAddress;
import java.util.UUID;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;

import static org.junit.jupiter.api.Assertions.*;

class ConnectionListenerTest {
    private AsyncPlayerPreLoginEvent login(String name, String uuid) {
        var id = UUID.fromString(uuid);
        var profile = (PlayerProfile) Proxy.newProxyInstance(PlayerProfile.class.getClassLoader(),
                new Class<?>[]{PlayerProfile.class}, (proxy, method, args) -> switch (method.getName()) {
                    case "getName" -> name;
                    case "getId" -> id;
                    default -> null;
                });
        return new AsyncPlayerPreLoginEvent(name, InetAddress.getLoopbackAddress(), InetAddress.getLoopbackAddress(),
                id, false, profile, "", null);
    }
    @Test
    void publishesBedrockIdentityEvenWhenWhitelistDeniesLogin() throws Exception {
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
            var listener = new ConnectionListener(publisher, null);
            var event = login(".Bedrock_Kid", "00000000-0000-0000-0009-01fb54b26482");
            event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_WHITELIST, net.kyori.adventure.text.Component.text("not whitelisted"));
            listener.onPreLogin(event);
            var body = received.poll(3, TimeUnit.SECONDS);
            assertNotNull(body);
            var payload = JsonParser.parseString(body).getAsJsonObject();
            assertEquals("player.identity", payload.get("type").getAsString());
            assertEquals("2535453759792258", payload.getAsJsonObject("player").get("xuid").getAsString());
            listener.onPreLogin(login("Notch", "069a79f4-44e9-4726-a5be-ca90e38aaf51"));
            assertNull(received.poll(100, TimeUnit.MILLISECONDS));
        } finally {
            publisher.shutdown(1000);
            server.stop(0);
        }
    }
}
