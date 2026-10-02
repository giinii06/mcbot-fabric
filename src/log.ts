export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogSink = (line: string) => void;

export interface Logger {
  readonly level: LogLevel;
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

const SENSITIVE_KEYS = /token|secret|authorization|password|key|cookie|credential/i;

/** Masks every occurrence of the given secrets inside a string. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) {
    if (s.length >= 8) out = out.split(s).join("***");
  }
  return out;
}

function format(
  level: LogLevel,
  msg: string,
  extra: Record<string, unknown> | undefined,
  secrets: readonly string[],
): string {
  const payload: Record<string, unknown> = { ts: new Date().toISOString(), level, msg };
  if (extra) payload.data = extra;
  let line: string;
  try {
    line = JSON.stringify(payload, (_k, v) => {
      if (typeof v === "string" && v.length > 500) return `${v.slice(0, 500)}…`;
      if (v instanceof Error) return { name: v.name, message: v.message };
      return v;
    });
  } catch {
    line = JSON.stringify({ ts: new Date().toISOString(), level, msg });
  }
  return redact(line, secrets);
}

export function createLogger(
  level: LogLevel = "info",
  secrets: readonly string[] = [],
  sink: LogSink = (l) => console.log(l),
): Logger {
  const enabled = (l: LogLevel): boolean => ORDER[l] >= ORDER[level];
  const emit = (l: LogLevel, msg: string, extra?: Record<string, unknown>): void => {
    if (!enabled(l)) return;
    sink(format(l, msg, extra, secrets));
  };
  return {
    level,
    debug: (m, e) => emit("debug", m, e),
    info: (m, e) => emit("info", m, e),
    warn: (m, e) => emit("warn", m, e),
    error: (m, e) => emit("error", m, e),
  };
}

/** Logger that keeps everything in memory - used by tests. */
export function createMemoryLogger(level: LogLevel = "debug"): Logger & { lines: string[] } {
  const lines: string[] = [];
  const logger = createLogger(level, [], (l) => void lines.push(l));
  return Object.assign(logger, { lines });
}

/** Strips potentially sensitive values from an object before it is logged. */
export function safeExtra(extra: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extra)) {
    if (SENSITIVE_KEYS.test(k)) {
      out[k] = typeof v === "string" && v.length > 0 ? "***" : v;
    } else {
      out[k] = v;
    }
  }
  return out;
}
