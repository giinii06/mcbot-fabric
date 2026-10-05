package kr.mcbot.bridge.stats;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

class DeathCounterTest {

    @TempDir
    Path tempDir;

    private final UUID id = UUID.fromString("f642a5e3-d12f-4a7d-9c96-aef87fcf92be");

    private void writeStats(String content) throws IOException {
        Files.writeString(tempDir.resolve(id + ".json"), content);
    }

    @Test
    void countsOnTopOfThePersistedValue() throws IOException {
        writeStats("{\"stats\":{\"minecraft:custom\":{\"minecraft:deaths\": 7}}}");
        DeathCounter counter = new DeathCounter(tempDir);
        counter.onJoin(id);
        assertEquals(8L, counter.onDeath(id));
        assertEquals(9L, counter.onDeath(id));
    }

    @Test
    void startsAtOneWithoutAStatsFile() {
        DeathCounter counter = new DeathCounter(tempDir);
        assertEquals(1L, counter.onDeath(id));
    }

    @Test
    void resetsTheSessionCountOnRejoin() throws IOException {
        writeStats("{\"stats\":{\"minecraft:custom\":{\"minecraft:deaths\": 2}}}");
        DeathCounter counter = new DeathCounter(tempDir);
        counter.onJoin(id);
        assertEquals(3L, counter.onDeath(id));
        counter.onQuit(id);
        counter.onJoin(id);
        assertEquals(3L, counter.onDeath(id));
    }

    @Test
    void toleratesAMissingStatsDir() {
        DeathCounter counter = new DeathCounter(null);
        counter.onJoin(id);
        assertEquals(1L, counter.onDeath(id));
    }
}
