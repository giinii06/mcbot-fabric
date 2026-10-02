/**
 * Canonical display helper: `<Discord display name> (<Minecraft username>)`.
 *
 * Every embed that shows a player must go through this function so the
 * format never drifts between commands, events and the leaderboard.
 */
export function formatMinecraftUser(discordName: string | null | undefined, minecraftUsername: string): string {
  const mc = (minecraftUsername ?? "").trim();
  const discord = (discordName ?? "").trim();
  if (!discord) return mc;
  if (!mc) return discord;
  if (discord === mc) return mc;
  return `${discord} (${mc})`;
}

export interface DiscordDisplaySource {
  displayName?: string | null;
  globalName?: string | null;
  user?: { username?: string | null } | null;
}

/**
 * Resolution order: GuildMember.displayName -> global display name -> username.
 * Returns null when the source is missing (member left the guild).
 */
export function discordDisplayName(member: DiscordDisplaySource | null | undefined): string | null {
  if (!member) return null;
  const displayName = member.displayName?.trim();
  if (displayName) return displayName;
  const global = member.globalName?.trim();
  if (global) return global;
  const username = member.user?.username?.trim();
  if (username) return username;
  return null;
}

/** Final label = resolved Discord name, falling back to the Minecraft username. */
export function displayLabel(member: DiscordDisplaySource | null | undefined, minecraftUsername: string): string {
  return formatMinecraftUser(discordDisplayName(member), minecraftUsername);
}

/** Shortens a string to `max` characters, appending an ellipsis when cut. */
export function truncate(text: string, max: number): string {
  const value = text.replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}
