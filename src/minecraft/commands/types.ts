import type {
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  ApplicationCommandOptionData,
  ChatInputCommandInteraction,
} from "discord.js";
import type { Services } from "../../services";
import { ApplicationCommandOptionType } from "discord.js";

export const editionOption: ApplicationCommandOptionData = {
  type: ApplicationCommandOptionType.String,
  name: "에디션",
  description: "조회하거나 해제할 Minecraft 계정의 에디션",
  required: true,
  choices: [{ name: "Java", value: "JAVA" }, { name: "Bedrock", value: "BEDROCK" }],
};

export interface CommandContext {
  interaction: ChatInputCommandInteraction;
  services: Services;
}

export interface CommandModule {
  name: string;
  description: string;
  /** Administrator only - declared in Discord AND re-checked in the handler. */
  admin?: boolean;
  options?: ApplicationCommandOptionData[];
  /** Ephemeral reply (private to the invoker). */
  ephemeral?: boolean;
  execute(ctx: CommandContext): Promise<void>;
}

export const DEFAULT_MEMBER_PERMISSIONS_ADMIN = "8"; // PermissionFlagsBits.Administrator

export function toApplicationCommand(module: CommandModule): RESTPostAPIChatInputApplicationCommandsJSONBody {
  return {
    name: module.name,
    description: module.description,
    options: (module.options ?? []) as RESTPostAPIChatInputApplicationCommandsJSONBody["options"],
    default_member_permissions: module.admin ? DEFAULT_MEMBER_PERMISSIONS_ADMIN : null,
    dm_permission: false,
    nsfw: false,
  };
}
