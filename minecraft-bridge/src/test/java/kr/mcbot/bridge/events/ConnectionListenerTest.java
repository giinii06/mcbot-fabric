package kr.mcbot.bridge.events;

import com.google.gson.JsonParser;
import com.sun.net.httpserver.HttpServer;
import com.destroystokyo.paper.profile.PlayerProfile;
import com.destroystokyo.paper.event.profile.ProfileWhitelistVerifyEvent;
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
            var listener = new ConnectionListener(publisher, null, uuid -> false);
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

    @Test
    void onlyAuthenticatedFloodgatePlayersBypassWhitelist() {
        var bedrock = login(".Bedrock_Kid", "00000000-0000-0000-0009-01fb54b26482");
        var linked = login("LinkedJava", "f642a5e3-d12f-4a7d-9c96-aef87fcf92be");
        var java = login("Notch", "069a79f4-44e9-4726-a5be-ca90e38aaf51");
        var spoofed = login(".Fake", "00000000-0000-0000-0000-000000000001");
        var listener = new ConnectionListener(null, null,
                uuid -> uuid.equals(bedrock.getUniqueId()) || uuid.equals(linked.getUniqueId()));
        for (var login : new AsyncPlayerPreLoginEvent[]{bedrock, linked, java, spoofed}) {
            var event = new ProfileWhitelistVerifyEvent(login.getPlayerProfile(), true, false, false, null);
            listener.onWhitelistVerify(event);
            assertEquals(login == bedrock || login == linked, event.isWhitelisted());
        }
        var allowed = new ProfileWhitelistVerifyEvent(java.getPlayerProfile(), true, true, false, null);
        listener.onWhitelistVerify(allowed);
        assertTrue(allowed.isWhitelisted());
        var noFloodgate = new ConnectionListener(null, null, uuid -> false);
        var denied = new ProfileWhitelistVerifyEvent(bedrock.getPlayerProfile(), true, false, false, null);
        noFloodgate.onWhitelistVerify(denied);
        assertFalse(denied.isWhitelisted());
    }
}
