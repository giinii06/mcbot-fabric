package kr.mcbot.bridge.publish;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Logger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Delivery contract of the event publisher: correct endpoint, Bearer auth,
 * bounded queue behaviour and no blocking of the caller when the bot is down.
 */
class EventPublisherTest {

    private static final String SECRET = "0123456789abcdef0123456789abcdef";

    private final List<String> bodies = new CopyOnWriteArrayList<>();
    private final List<String> authHeaders = new CopyOnWriteArrayList<>();
    private final List<String> paths = new CopyOnWriteArrayList<>();
    private final AtomicInteger status = new AtomicInteger(200);
    private HttpServer server;
    private EventPublisher publisher;

    private int startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/bridge/events", this::handle);
        server.start();
        return server.getAddress().getPort();
    }

    private void handle(HttpExchange exchange) throws IOException {
        paths.add(exchange.getRequestURI().getPath());
        authHeaders.add(exchange.getRequestHeaders().getFirst("authorization"));
        bodies.add(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
        byte[] response = "{\"ok\":true}".getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(status.get(), response.length);
        try (var out = exchange.getResponseBody()) {
            out.write(response);
        }
    }

    @AfterEach
    void tearDown() {
        if (publisher != null) {
            publisher.shutdown(500L);
            publisher = null;
        }
        if (server != null) {
            server.stop(0);
            server = null;
        }
    }

    private Map<String, Object> joinPayload() {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("type", "player.join");
        Map<String, Object> player = new LinkedHashMap<>();
        player.put("uuid", "069a79f4-44e9-4726-a5be-ca90e38aaf51");
        player.put("username", "Notch");
        player.put("edition", "JAVA");
        payload.put("player", player);
        return payload;
    }

    @Test
    void deliversToTheBotWithBearerAuth() throws Exception {
        int port = startServer();
        publisher = new EventPublisher("http://127.0.0.1:" + port, SECRET, 32, 1, 1000, 2000, 1, Logger.getLogger("test"));

        assertTrue(publisher.submit(joinPayload()));
        assertTrue(publisher.awaitDrain(5000L));

        long deadline = System.currentTimeMillis() + 3000;
        while (bodies.isEmpty() && System.currentTimeMillis() < deadline) {
            Thread.sleep(25);
        }
        assertEquals(1, bodies.size());
        assertEquals("/bridge/events", paths.get(0));
        assertEquals("Bearer " + SECRET, authHeaders.get(0));
        String body = bodies.get(0);
        assertTrue(body.contains("\"type\":\"player.join\""), body);
        assertTrue(body.contains("\"username\":\"Notch\""), body);
        assertTrue(body.contains("\"eventId\""), "eventId must be injected");
        assertTrue(body.contains("\"ts\""), "ts must be injected");
        assertEquals(0, publisher.dropped());
    }

    @Test
    void injectsEventIdAndTimestampOnlyWhenMissing() throws Exception {
        int port = startServer();
        publisher = new EventPublisher("http://127.0.0.1:" + port, SECRET, 32, 1, 1000, 2000, 1, Logger.getLogger("test"));

        Map<String, Object> payload = joinPayload();
        payload.put("eventId", "fixed-event-id-12345678");
        payload.put("ts", 123456789L);
        assertTrue(publisher.submit(payload));
        assertTrue(publisher.awaitDrain(5000L));

        long deadline = System.currentTimeMillis() + 3000;
        while (bodies.isEmpty() && System.currentTimeMillis() < deadline) {
            Thread.sleep(25);
        }
        assertEquals(1, bodies.size());
        assertTrue(bodies.get(0).contains("fixed-event-id-12345678"));
        assertTrue(bodies.get(0).contains("\"ts\":123456789"));
    }

    @Test
    void queueIsBoundedAndOldestEventsAreDropped() throws Exception {
        publisher = new EventPublisher("http://127.0.0.1:1", SECRET, 5, 1, 100, 100, 0, Logger.getLogger("test"));
        for (int i = 0; i < 50; i++) {
            assertTrue(publisher.submit(joinPayload()));
        }
        assertTrue(publisher.pending() <= 5, "queue must stay within capacity: " + publisher.pending());
        assertTrue(publisher.dropped() >= 40, "most events must be dropped: " + publisher.dropped());
    }

    @Test
    void callerIsNeverBlockedWhenTheBotIsDown() throws Exception {
        publisher = new EventPublisher("http://127.0.0.1:1", SECRET, 8, 1, 100, 100, 0, Logger.getLogger("test"));
        long start = System.nanoTime();
        for (int i = 0; i < 8; i++) {
            assertTrue(publisher.submit(joinPayload()));
        }
        long elapsedMs = (System.nanoTime() - start) / 1_000_000;
        assertTrue(elapsedMs < 1000, "submit must not block, took " + elapsedMs + "ms");
        assertTrue(publisher.pending() <= 8, "queue must stay within capacity: " + publisher.pending());

        // shutdown must not hang either
        publisher.shutdown(1000L);
        assertFalse(publisher.submit(joinPayload()), "submit must be rejected after shutdown");
        publisher = null;
    }

    @Test
    void non2xxResponsesCountAsFailedDeliveries() throws Exception {
        status.set(500);
        int port = startServer();
        publisher = new EventPublisher("http://127.0.0.1:" + port, SECRET, 32, 1, 1000, 1000, 0, Logger.getLogger("test"));
        assertTrue(publisher.submit(joinPayload()));
        assertTrue(publisher.awaitDrain(5000L));

        long deadline = System.currentTimeMillis() + 3000;
        while (bodies.isEmpty() && System.currentTimeMillis() < deadline) {
            Thread.sleep(25);
        }
        assertEquals(1, bodies.size(), "the event was still attempted");
        assertEquals("Bearer " + SECRET, authHeaders.get(0));
    }
}
