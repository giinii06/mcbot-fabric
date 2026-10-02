/**
 * Human readable playtime formatting.
 *
 * Rules (shared by every command / embed so the output never diverges):
 *  - exactly 0            -> "0분"
 *  - less than 60 seconds -> "1분 미만"
 *  - less than 60 minutes -> "{m}분"
 *  - less than 24 hours   -> "{h}시간 {m}분"   (zero parts omitted)
 *  - 24 hours or more     -> "{d}일 {h}시간 {m}분" (zero parts omitted)
 */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0분";
  const total = Math.floor(totalSeconds);
  if (total === 0) return "0분";
  if (total < 60) return "1분 미만";

  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  if (days === 0 && hours === 0) return `${minutes}분`;
  if (days === 0) return `${hours}시간${minutes > 0 ? ` ${minutes}분` : ""}`;

  const parts: string[] = [`${days}일`];
  if (hours > 0) parts.push(`${hours}시간`);
  if (minutes > 0) parts.push(`${minutes}분`);
  return parts.join(" ");
}

/** Minecraft statistics are stored in ticks (20 ticks = 1 second). */
export function ticksToSeconds(ticks: number): number {
  if (!Number.isFinite(ticks) || ticks <= 0) return 0;
  return Math.floor(ticks / 20);
}

export function secondsToTicks(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.floor(seconds * 20);
}
