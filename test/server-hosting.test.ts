import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const server = resolve(import.meta.dir, "../server");

test("backup space check refuses insufficient space before saving is disabled", () => {
  const dir = mkdtempSync(join(tmpdir(), "mc-backup-test-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "du"), "#!/bin/sh\necho '100 /data'\n", { mode: 0o755 });
    writeFileSync(join(bin, "df"), "#!/bin/sh\nprintf 'Filesystem 1024-blocks Used Available Capacity Mounted\\n/dev/test 2000000 0 %s 0%% /backups\\n' \"$TEST_FREE\"\n", { mode: 0o755 });
    for (const [free, expected] of [["1024", 1], ["2000000", 0]] as const) {
      const result = Bun.spawnSync(["bash", join(server, "backup-space.sh")], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_FREE: free },
      });
      expect(result.exitCode).toBe(expected);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("failed, missing, and corrupt backups fail verification", () => {
  const dir = mkdtempSync(join(tmpdir(), "mc-backup-test-"));
  try {
    const run = (status: string) => Bun.spawnSync(["bash", join(server, "backup-verify.sh"), status], {
      env: { ...process.env, DEST_DIR: dir },
    });
    expect(run("1").exitCode).not.toBe(0);
    expect(run("0").exitCode).not.toBe(0);
    writeFileSync(join(dir, "world.tar.zst"), "corrupt");
    expect(run("0").exitCode).not.toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

