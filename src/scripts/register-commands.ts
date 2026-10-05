import { REST, Routes, type APIApplicationCommand, type APIGuild } from "discord.js";
import { loadEnv } from "../env";
import { commandModules, toApplicationCommand } from "../minecraft/commands";

/**
 * Registers the slash commands.
 *
 * Global by default, so every guild the bot is in gets the same commands.
 * Discord propagates global commands with a delay (up to ~1 hour).
 *
 * Pass a guild id to scope the registration to one server instead
 * (visible immediately, useful while iterating):
 *
 *   bun run minecraft:commands            # 전역 (여러 서버 공통)
 *   bun run minecraft:commands -- 123456  # 특정 길드만, 즉시 반영
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const missing = [
    !env.DISCORD_TOKEN && "DISCORD_TOKEN",
    !env.DISCORD_APPLICATION_ID && "DISCORD_APPLICATION_ID",
  ].filter(Boolean);

  if (missing.length > 0) {
    console.error(`missing environment: ${missing.join(", ")}`);
    console.error("create a new Discord application, put its token/id into .env, then re-run.");
    process.exit(1);
  }

  const guildId = (process.argv[2] ?? "").replace(/\D/g, "") || null;
  const appId = env.DISCORD_APPLICATION_ID as string;
  const body = commandModules.map(toApplicationCommand);
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN as string);
  const route = guildId ? Routes.applicationGuildCommands(appId, guildId) : Routes.applicationCommands(appId);
  const result = (await rest.put(route, { body })) as APIApplicationCommand[];

  const scope = guildId ? `guild commands (guild ${guildId}, 즉시 반영)` : "global commands (전 서버 적용, 반영 최대 1시간)";
  console.log(`registered ${result.length} ${scope}:`);
  for (const command of result) {
    const perms = "default_member_permissions" in command ? command.default_member_permissions : null;
    console.log(` - /${command.name}${perms ? "  [admin]" : ""}`);
  }

  const guilds = (await rest.get(Routes.userGuilds())) as APIGuild[];
  console.log(`bot is in ${guilds.length} guild(s):`);
  for (const guild of guilds) console.log(` - ${guild.name}  (${guild.id})`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
