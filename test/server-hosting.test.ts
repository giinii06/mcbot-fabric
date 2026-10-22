import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const server = resolve(import.meta.dir, "../server");

test("TLS renewal rejects a certificate for another IP before replacing the active certificate", () => {
  const dir = mkdtempSync(join(tmpdir(), "mc-tls-test-"));
  try {
    const source = join(dir, "secrets/letsencrypt/live/minecraft-bedrock");
    const target = join(dir, "data/plugins/Geyser-Spigot/https");
    const bin = join(dir, "bin");
    for (const path of [source, target, bin]) mkdirSync(path, { recursive: true });
    copyFileSync(join(server, "renew-bedrock-tls.sh"), join(dir, "renew-bedrock-tls.sh"));
    writeFileSync(join(bin, "id"), "#!/bin/sh\necho 0\n", { mode: 0o755 });
    writeFileSync(join(bin, "docker"), "#!/bin/sh\necho \"$*\" >> \"$TEST_CALLS\"\n", { mode: 0o755 });
    writeFileSync(join(target, "fullchain.pem"), "existing certificate");
    const cert = Bun.spawnSync(["openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
      "-nodes", "-days", "1", "-subj", "/CN=192.0.2.1", "-addext", "subjectAltName=IP:192.0.2.1",
      "-out", join(source, "fullchain.pem"), "-keyout", join(source, "privkey.pem")]);
    expect(cert.exitCode).toBe(0);
    const calls = join(dir, "calls");
    const result = Bun.spawnSync(["bash", join(dir, "renew-bedrock-tls.sh")], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_CALLS: calls },
    });
    expect(result.exitCode).not.toBe(0);
    expect(readFileSync(join(target, "fullchain.pem"), "utf8")).toBe("existing certificate");
    expect(readFileSync(calls, "utf8")).not.toContain("exec minecraft");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

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

