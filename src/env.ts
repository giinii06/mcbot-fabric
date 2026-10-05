import { z } from "zod";

export const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1).optional(),
  DISCORD_APPLICATION_ID: z.string().regex(/^\d+$/, "snowflake").optional(),
  MC_BRIDGE_SECRET: z.string().min(16, "MC_BRIDGE_SECRET must be at least 16 chars"),
  MC_BRIDGE_BASE_URL: z.string().min(1).default("http://minecraft:8765"),
  MC_BOT_PORT: z.coerce.number().int().min(1).max(65535).default(47865),
  SQLITE_PATH: z.string().min(1).default("data/mcbot.sqlite"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  DISCORD_DISABLED: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export type EnvSource = Record<string, string | undefined>;

/** `KEY=` in a .env file means "not configured", not an empty value. */
function normalize(source: EnvSource): EnvSource {
  const out: EnvSource = {};
  for (const [key, value] of Object.entries(source)) out[key] = value === "" ? undefined : value;
  return out;
}

export function loadEnv(source: EnvSource = process.env): Env {
  const parsed = envSchema.safeParse(normalize(source));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid environment: ${issues}`);
  }
  return parsed.data;
}

export function discordEnabled(env: Env): boolean {
  if (env.DISCORD_DISABLED === "1" || env.DISCORD_DISABLED === "true") return false;
  return Boolean(env.DISCORD_TOKEN && env.DISCORD_APPLICATION_ID);
}

/** Every secret that must never show up in a log line. */
export function secretValues(env: Env): string[] {
  const list = [env.MC_BRIDGE_SECRET];
  if (env.DISCORD_TOKEN) list.push(env.DISCORD_TOKEN);
  return list;
}
