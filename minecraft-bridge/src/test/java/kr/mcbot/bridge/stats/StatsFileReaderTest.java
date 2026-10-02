package kr.mcbot.bridge.stats;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class StatsFileReaderTest {

    @TempDir
    Path tempDir;

    private Path write(String name, String content) throws IOException {
        Path file = tempDir.resolve(name);
        Files.writeString(file, content);
        return file;
    }

    @Test
    void readsModernPlayTimeKey() throws IOException {
        Path file = write("a.json", """
                {"stats":{"minecraft:play_time": 7200, "minecraft:play_one_minute": 3600}}
                """);
        long ticks = StatsFileReader.readTicks(file);
        assertEquals(7200L, ticks);
        assertEquals(360L, StatsFileReader.ticksToSeconds(ticks));
    }

    @Test
    void fallsBackToLegacyPlayOneMinute() throws IOException {
        Path file = write("b.json", """
                {"stats":{"minecraft:play_one_minute": 3600}}
                """);
        assertEquals(3600L, StatsFileReader.readTicks(file));
        assertEquals(180L, StatsFileReader.ticksToSeconds(3600L));
    }

    @Test
    void readsNestedKeysRecursively() throws IOException {
        Path file = write("c.json", """
                {"stats":{"custom":{"minecraft:play_time": 600}}}
                """);
        assertEquals(600L, StatsFileReader.readTicks(file));
    }

    @Test
    void missingFileIsNotFound() throws IOException {
        assertEquals(StatsFileReader.NOT_FOUND, StatsFileReader.readTicks(tempDir.resolve("nope.json")));
        assertFalse(StatsFileReader.exists(tempDir.resolve("nope.json")));
        assertEquals(StatsFileReader.NOT_FOUND, StatsFileReader.readTicks(null));
    }

    @Test
    void malformedJsonIsNotFound() throws IOException {
        Path file = write("broken.json", "{not json");
        assertEquals(StatsFileReader.NOT_FOUND, StatsFileReader.readTicks(file));
    }

    @Test
    void blankFileIsNotFound() throws IOException {
        Path file = write("blank.json", "   ");
        assertEquals(StatsFileReader.NOT_FOUND, StatsFileReader.readTicks(file));
    }

    @Test
    void nonModernValueFallsBackToLegacy() throws IOException {
        Path file = write("d.json", """
                {"stats":{"minecraft:play_time":"soon","minecraft:play_one_minute":100}}
                """);
        assertEquals(100L, StatsFileReader.readTicks(file));
    }

    @Test
    void ticksToSecondsClampsNegativesAndUses20Ticks() {
        assertEquals(0L, StatsFileReader.ticksToSeconds(0));
        assertEquals(0L, StatsFileReader.ticksToSeconds(-5));
        assertEquals(0L, StatsFileReader.ticksToSeconds(19));
        assertEquals(1L, StatsFileReader.ticksToSeconds(20));
        assertEquals(3600L, StatsFileReader.ticksToSeconds(72000));
        assertTrue(StatsFileReader.ticksToSeconds(1) == 0L);
    }
}
