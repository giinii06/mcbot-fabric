import { Client, Events, GatewayIntentBits } from "discord.js";
import { createRateLimiter } from "./core/rate-limit";
import { discordEnabled, loadEnv, secretValues } from "./env";
import { createLogger } from "./log";
import { openDatabase } from "./db/database";
import { createRepositories } from "./db/repositories";
import { BridgeClient } from "./bridge/client";
import { createBridgeHandler } from "./bridge/server";
import { IdentityService } from "./minecraft/identity";
import { createDiscordSender, createLogChannelService } from "./minecraft/channels";
import { createMemberResolver } from "./minecraft/members";
import { handleBridgeEvent } from "./minecraft/events";
import { createInteractionRouter } from "./discord/interactions";
import type { Services } from "./services";

export interface App {
  services: Services;
  stop(): Promise<void>;
}

export async function start(): Promise<App> {
  const env = loadEnv();
  const log = createLogger(env.LOG_LEVEL, secretValues(env));

  const db = openDatabase(env.SQLITE_PATH);
  const repos = createRepositories(db);

  const bridge = new BridgeClient({
    baseUrl: env.MC_BRIDGE_BASE_URL,
    secret: env.MC_BRIDGE_SECRET,
    log,
  });
  const identity = new IdentityService({ log });
  const registrationLimiter = createRateLimiter(3, 8000);

  const useDiscord = discordEnabled(env);
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  const sender = useDiscord
    ? createDiscordSender(env.DISCORD_TOKEN ?? "")
    : {
        send: async (channelId: string) => {
          log.warn("discord disabled - dropped log message", { channelId });
        },
      };

  const logChannels = createLogChannelService({ repos, sender, log });
  const resolveMember = useDiscord ? createMemberResolver(client) : async () => null;

  const services: Services = {
    env,
    log,
    db,
    repos,
    bridge,
    identity,
    registrationLimiter,
    logChannels,
    resolveMember,
    now: Date.now,
  };

  const handler = createBridgeHandler({
    port: env.MC_BOT_PORT,
    secret: env.MC_BRIDGE_SECRET,
    log,
    onEvent: (event) => handleBridgeEvent(services, event),
    isMinecraftHealthy: () => bridge.isHealthy(30_000),
  });

  const server = Bun.serve({
    port: env.MC_BOT_PORT,
    hostname: "0.0.0.0",
    fetch: handler,
  });
  log.info("bridge endpoint listening", { port: server.port, discord: useDiscord });

  const probe = setInterval(() => {
    void bridge.health();
  }, 10_000);
  probe.unref?.();
  await bridge.health();

  if (useDiscord) {
    const router = createInteractionRouter({ services });
    client.on(Events.InteractionCreate, router);
    client.on(Events.Error, (err) => log.error("discord client error", { error: err.message }));
    client.on(Events.Warn, (msg) => log.warn("discord client warning", { message: msg }));
    client.on(Events.ClientReady, (ready) => log.info("discord ready", { user: ready.user.tag }));
    await client.login(env.DISCORD_TOKEN);
  } else {
    log.warn("discord disabled - set DISCORD_TOKEN and DISCORD_APPLICATION_ID to connect");
  }

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    clearInterval(probe);
    try {
      await client.destroy();
    } catch {
      /* already destroyed */
    }
    await server.stop(true);
    try {
      db.close();
    } catch {
      /* already closed */
    }
    log.info("stopped");
  };

  return { services, stop };
}

if (import.meta.main) {
  start()
    .then((app) => {
      const shutdown = (signal: string) => {
        void app.stop().then(() => process.exit(0));
        setTimeout(() => process.exit(0), 5000).unref();
        void signal;
      };
      process.on("SIGINT", () => shutdown("SIGINT"));
      process.on("SIGTERM", () => shutdown("SIGTERM"));
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.stack ?? err.message : err);
      process.exit(1);
    });
}
