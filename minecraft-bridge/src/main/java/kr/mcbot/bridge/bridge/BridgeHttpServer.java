package kr.mcbot.bridge.bridge;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.slf4j.Logger;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Minimal HTTP surface exposed to the Discord bot:
 *
 * <pre>
 *   GET  /health  - liveness probe (no auth)
 *   POST /ops     - one of the typed operations in {@link Ops} (Bearer secret)
 * </pre>
 *
 * <p>Anything else is a 404. There is no endpoint that can run an arbitrary
 * Minecraft command, and the listener is only reachable over the private
 * Docker network (never published to the host).</p>
 */
public final class BridgeHttpServer {

    public interface Handler {
        HttpResult health();

        HttpResult ops(String body, String authorization, String bridgeSecret);
    }

    private static final int MAX_BODY_BYTES = 64 * 1024;

    private final HttpServer server;
    private final ExecutorService executor;
    private final Handler handler;
    private final Logger logger;
    private final int port;

    public BridgeHttpServer(String bind, int port, int threads, Handler handler, Logger logger) throws IOException {
        this.handler = handler;
        this.logger = logger;
        ThreadFactory factory = new ThreadFactory() {
            private final AtomicInteger seq = new AtomicInteger();

            @Override
            public Thread newThread(Runnable runnable) {
                Thread thread = new Thread(runnable, "mcbridge-http-" + seq.incrementAndGet());
                thread.setDaemon(true);
                return thread;
            }
        };
        this.executor = Executors.newFixedThreadPool(Math.max(1, threads), factory);
        this.server = HttpServer.create(new InetSocketAddress(bind, port), 0);
        this.server.setExecutor(executor);
        this.server.createContext("/", this::dispatch);
        this.port = server.getAddress().getPort();
    }

    public int port() {
        return port;
    }

    public void start() {
        server.start();
    }

    public void stop() {
        try {
            server.stop(1);
        } catch (Exception ex) {
            logger.warn("bridge http stop failed: {}", ex.getMessage());
        }
        executor.shutdownNow();
    }

    private void dispatch(HttpExchange exchange) throws IOException {
        HttpResult result;
        try {
            String path = exchange.getRequestURI().getPath();
            String method = exchange.getRequestMethod();

            if ("/health".equals(path) && "GET".equalsIgnoreCase(method)) {
                result = handler.health();
            } else if ("/ops".equals(path) && "POST".equalsIgnoreCase(method)) {
                String body = readBody(exchange.getRequestBody());
                if (body == null) {
                    result = json(413, "payload too large");
                } else {
                    result = handler.ops(
                            body,
                            exchange.getRequestHeaders().getFirst("Authorization"),
                            exchange.getRequestHeaders().getFirst("X-Bridge-Secret"));
                }
            } else {
                result = json(404, "not found");
            }
        } catch (Exception ex) {
            logger.warn("bridge request failed: {} - {}",
                    ex.getClass().getSimpleName(), ex.getMessage());
            result = json(500, "internal error");
        }
        write(exchange, result);
    }

    private static String readBody(InputStream in) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[4096];
        int total = 0;
        int read;
        while ((read = in.read(chunk)) != -1) {
            total += read;
            if (total > MAX_BODY_BYTES) {
                return null;
            }
            buffer.write(chunk, 0, read);
        }
        return buffer.toString(StandardCharsets.UTF_8);
    }

    private static HttpResult json(int status, String message) {
        String escaped = message.replace("\\", "\\\\").replace("\"", "\\\"");
        return new HttpResult(status, "{\"ok\":false,\"error\":\"" + escaped + "\"}");
    }

    private static void write(HttpExchange exchange, HttpResult result) throws IOException {
        byte[] bytes = result.body().getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("content-type", "application/json; charset=utf-8");
        exchange.getResponseHeaders().set("cache-control", "no-store");
        exchange.sendResponseHeaders(result.status(), bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }
}
