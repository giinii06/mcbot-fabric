package kr.mcbot.bridge.publish;

import com.google.gson.Gson;
import kr.mcbot.bridge.util.BoundedQueue;
import org.slf4j.Logger;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Bounded, asynchronous publisher for gameplay events.
 *
 * <p>Producers (event listeners) never block: the payload is serialised and put
 * on a bounded queue; worker threads deliver it to the Discord bot. When the
 * queue is full the oldest event is dropped and counted - the Minecraft server
 * must never be slowed down or run out of memory because Discord is offline.</p>
 */
public final class EventPublisher {

    private static final long POLL_MILLIS = 400L;
    private static final long RETRY_BACKOFF_MILLIS = 700L;

    private final Gson gson = new Gson();
    private final BoundedQueue<String> queue;
    private final ExecutorService executor;
    private final HttpClient client;
    private final String endpoint;
    private final String secret;
    private final int requestTimeoutMillis;
    private final int connectTimeoutMillis;
    private final int retries;
    private final Logger logger;
    private volatile boolean running = true;
    private final AtomicInteger threadSeq = new AtomicInteger();

    public EventPublisher(
            String botBaseUrl,
            String secret,
            int capacity,
            int workers,
            int connectTimeoutMillis,
            int requestTimeoutMillis,
            int retries,
            Logger logger) {
        String base = botBaseUrl == null ? "" : botBaseUrl.trim();
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        this.endpoint = base + "/bridge/events";
        this.secret = secret;
        this.queue = new BoundedQueue<>(Math.max(1, capacity));
        this.requestTimeoutMillis = Math.max(500, requestTimeoutMillis);
        this.connectTimeoutMillis = Math.max(500, connectTimeoutMillis);
        this.retries = Math.max(0, retries);
        this.logger = logger;
        this.client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(this.connectTimeoutMillis))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        this.executor = Executors.newFixedThreadPool(Math.max(1, workers), runnable -> {
            Thread thread = new Thread(runnable, "mcbridge-publisher-" + threadSeq.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        });
        for (int i = 0; i < Math.max(1, workers); i++) {
            executor.submit(this::runLoop);
        }
    }

    /** Enqueues an event. Returns false when the event was rejected. */
    public boolean submit(Map<String, Object> payload) {
        if (!running || payload == null) {
            return false;
        }
        Map<String, Object> enriched = new java.util.LinkedHashMap<>(payload);
        enriched.putIfAbsent("eventId", UUID.randomUUID().toString());
        enriched.putIfAbsent("ts", System.currentTimeMillis());
        boolean accepted = queue.offer(gson.toJson(enriched));
        if (!accepted) {
            logger.warn("bridge event queue rejected an event (dropped={})", queue.droppedCount());
        }
        return accepted;
    }

    public int pending() {
        return queue.size();
    }

    public long dropped() {
        return queue.droppedCount();
    }

    /** Waits until the queue is empty (or the timeout elapses). */
    public boolean awaitDrain(long timeoutMillis) {
        long deadline = System.currentTimeMillis() + Math.max(0, timeoutMillis);
        while (System.currentTimeMillis() < deadline) {
            if (queue.size() == 0) {
                return true;
            }
            try {
                Thread.sleep(50L);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                return queue.size() == 0;
            }
        }
        return queue.size() == 0;
    }

    public void shutdown(long timeoutMillis) {
        awaitDrain(timeoutMillis);
        running = false;
        executor.shutdownNow();
        try {
            executor.awaitTermination(Math.max(200, timeoutMillis), TimeUnit.MILLISECONDS);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        }
    }

    private void runLoop() {
        while (running) {
            String json;
            try {
                json = queue.poll(POLL_MILLIS);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                return;
            }
            if (json == null) {
                continue;
            }
            if (deliver(json)) {
                continue;
            }
            for (int attempt = 0; attempt < retries && running; attempt++) {
                try {
                    Thread.sleep(RETRY_BACKOFF_MILLIS);
                } catch (InterruptedException ex) {
                    Thread.currentThread().interrupt();
                    return;
                }
                if (deliver(json)) {
                    break;
                }
            }
        }
    }

    private boolean deliver(String json) {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(endpoint))
                    .timeout(Duration.ofMillis(requestTimeoutMillis))
                    .header("content-type", "application/json")
                    .header("authorization", "Bearer " + secret)
                    .POST(HttpRequest.BodyPublishers.ofString(json))
                    .build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            int status = response.statusCode();
            if (status >= 200 && status < 300) {
                return true;
            }
            logger.warn("bridge event delivery failed with HTTP {}", status);
            return false;
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            return false;
        } catch (Exception ex) {
            logger.warn("bridge event delivery failed: {}", ex.getClass().getSimpleName());
            return false;
        }
    }
}
