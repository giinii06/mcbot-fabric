import { forceUnregisterCommand } from "./force-unregister";
import { leaderboardCommand } from "./leaderboard";
import { listCommand } from "./list";
import { logSetupCommand } from "./log-setup";
import { lookupCommand } from "./lookup";
import { bedrockRegisterCommand, registerCommand } from "./register";
import { unregisterCommand } from "./unregister";
import { whitelistSyncCommand } from "./whitelist-sync";
import type { CommandModule } from "./types";

export const commandModules: CommandModule[] = [
  logSetupCommand,
  registerCommand,
  bedrockRegisterCommand,
  unregisterCommand,
  forceUnregisterCommand,
  lookupCommand,
  listCommand,
  whitelistSyncCommand,
  leaderboardCommand,
];

export const commandRegistry: Map<string, CommandModule> = new Map(
  commandModules.map((module) => [module.name, module]),
);

export { toApplicationCommand } from "./types";
export type { CommandModule, CommandContext } from "./types";
