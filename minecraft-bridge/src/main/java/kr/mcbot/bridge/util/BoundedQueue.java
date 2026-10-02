package kr.mcbot.bridge.util;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.LinkedBlockingDeque;

/**
 * FIFO queue with a hard capacity: when it is full the oldest entry is
 * dropped so the producer can never be blocked or OOM the server.
 */
public final class BoundedQueue<T> {

    private final LinkedBlockingDeque<T> deque;
    private final int capacity;
    private long dropped;

    public BoundedQueue(int capacity) {
        if (capacity < 1) {
            throw new IllegalArgumentException("capacity must be >= 1");
        }
        this.capacity = capacity;
        this.deque = new LinkedBlockingDeque<>(capacity);
    }

    /** Offers an item, evicting the oldest one when the queue is full. */
    public synchronized boolean offer(T item) {
        if (item == null) {
            return false;
        }
        boolean offered = deque.offerLast(item);
        if (!offered) {
            deque.pollFirst();
            dropped++;
            offered = deque.offerLast(item);
        }
        return offered;
    }

    public T poll(long timeoutMillis) throws InterruptedException {
        return deque.pollFirst(timeoutMillis, java.util.concurrent.TimeUnit.MILLISECONDS);
    }

    public T poll() {
        return deque.pollFirst();
    }

    public synchronized int size() {
        return deque.size();
    }

    public synchronized long droppedCount() {
        return dropped;
    }

    public int capacity() {
        return capacity;
    }

    public synchronized void clear() {
        deque.clear();
    }

    public synchronized List<T> drain(int max) {
        List<T> items = new ArrayList<>();
        for (int i = 0; i < max; i++) {
            T item = deque.pollFirst();
            if (item == null) {
                break;
            }
            items.add(item);
        }
        return items;
    }
}
