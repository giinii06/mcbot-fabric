package kr.mcbot.bridge.util;

import org.junit.jupiter.api.Test;

import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BoundedQueueTest {

    @Test
    void rejectsInvalidCapacity() {
        org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class, () -> new BoundedQueue<String>(0));
    }

    @Test
    void dropsOldestWhenFull() {
        BoundedQueue<Integer> queue = new BoundedQueue<>(3);
        assertTrue(queue.offer(1));
        assertTrue(queue.offer(2));
        assertTrue(queue.offer(3));
        assertTrue(queue.offer(4));

        assertEquals(3, queue.size());
        assertEquals(1, queue.droppedCount());
        assertEquals(2, queue.poll());
        assertEquals(3, queue.poll());
        assertEquals(4, queue.poll());
        assertNull(queue.poll());
    }

    @Test
    void neverGrowsBeyondCapacity() {
        BoundedQueue<Integer> queue = new BoundedQueue<>(10);
        for (int i = 0; i < 1000; i++) {
            assertTrue(queue.offer(i));
        }
        assertEquals(10, queue.size());
        assertEquals(990, queue.droppedCount());
    }

    @Test
    void rejectsNullItems() {
        BoundedQueue<String> queue = new BoundedQueue<>(2);
        assertFalse(queue.offer(null));
        assertEquals(0, queue.size());
    }

    @Test
    void timedPollReturnsNullOnTimeout() throws Exception {
        BoundedQueue<String> queue = new BoundedQueue<>(2);
        long start = System.nanoTime();
        assertNull(queue.poll(50));
        long elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
        assertTrue(elapsedMs >= 40, "poll should wait for the timeout, waited " + elapsedMs + "ms");
    }
}
