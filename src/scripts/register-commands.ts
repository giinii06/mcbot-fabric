import { REST, Routes, type APIApplicationCommand } from "discord.js";
import { loadEnv } from "../env";
import { commandModules, toApplicationCommand } from "../minecraft/commands";

async function main(): Promise<void> {
  const env = loadEnv();
  const missing = [
    !env.DISCORD_TOKEN && "DISCORD_TOKEN",
    !env.DISCORD_APPLICATION_ID && "DISCORD_APPLICATION_ID",
    !env.MINECRAFT_GUILD_ID && "MINECRAFT_GUILD_ID",
  ].filter(Boolean);

  if (missing.length > 0) {
    console.error(`missing environment: ${missing.join(", ")}`);
    console.error("create a new Discord application, put its token/id into .env, then re-run.");
    process.exit(1);
  }

  const body = commandModules.map(toApplicationCommand);
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN as string);
  const result = (await rest.put(
    Routes.applicationGuildCommands(env.DISCORD_APPLICATION_ID as string, env.MINECRAFT_GUILD_ID as string),
    { body },
  )) as APIApplicationCommand[];

  console.log(`registered ${result.length} guild commands:`);
  for (const command of result) {
    const perms = "default_member_permissions" in command ? command.default_member_permissions : null;
    console.log(` - /${command.name}${perms ? "  [admin]" : ""}`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
