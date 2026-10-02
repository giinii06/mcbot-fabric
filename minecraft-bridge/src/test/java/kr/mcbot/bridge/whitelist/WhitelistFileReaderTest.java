package kr.mcbot.bridge.whitelist;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WhitelistFileReaderTest {

    @TempDir
    Path tempDir;

    private Path write(String content) throws IOException {
        Path file = tempDir.resolve("whitelist.json");
        Files.writeString(file, content);
        return file;
    }

    @Test
    void parsesEntries() throws IOException {
        Path file = write("""
                [
                  {"name":"Steve","uuid":"00000000-0000-0000-0000-000000000001"},
                  {"name":".BedrockKid","uuid":"00000000-0000-0000-0009-01fb54b26482"}
                ]
                """);
        List<WhitelistFileReader.Entry> entries = WhitelistFileReader.read(file);
        assertEquals(2, entries.size());
        assertEquals("Steve", entries.get(0).name());
        assertEquals("00000000-0000-0000-0000-000000000001", entries.get(0).uuid());
        assertEquals(".BedrockKid", entries.get(1).name());
    }

    @Test
    void skipsEntriesWithoutUuid() throws IOException {
        Path file = write("""
                [{"name":"NoUuid"},{"uuid":"11111111-1111-1111-1111-111111111111","name":"HasUuid"}]
                """);
        List<WhitelistFileReader.Entry> entries = WhitelistFileReader.read(file);
        assertEquals(1, entries.size());
        assertEquals("HasUuid", entries.get(0).name());
    }

    @Test
    void toleratesNonObjectElementsAndExtraFields() throws IOException {
        Path file = write("""
                [7, "text", {"uuid":"22222222-2222-2222-2222-222222222222","name":"Extra","other":1}]
                """);
        List<WhitelistFileReader.Entry> entries = WhitelistFileReader.read(file);
        assertEquals(1, entries.size());
        assertEquals("Extra", entries.get(0).name());
    }

    @Test
    void emptyOrMissingOrBrokenFileIsEmpty() throws IOException {
        assertEquals(0, WhitelistFileReader.read(write("[]")).size());
        assertEquals(0, WhitelistFileReader.read(write("   ")).size());
        assertEquals(0, WhitelistFileReader.read(write("{broken")).size());
        assertEquals(0, WhitelistFileReader.read(write("{}")).size());
        Files.delete(tempDir.resolve("whitelist.json"));
        assertTrue(WhitelistFileReader.read(tempDir.resolve("whitelist.json")).isEmpty());
        assertTrue(WhitelistFileReader.read(null).isEmpty());
    }
}
