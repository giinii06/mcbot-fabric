import { newId } from "../core/ids";
import { withTimeout } from "../core/rate-limit";
import type { Logger } from "../log";
import {
  onlinePlayersResponseSchema,
  pluginHealthSchema,
  playtimeResponseSchema,
  statusResponseSchema,
  whitelistResponseSchema,
  mutateResponseSchema,
  type MutateResponse,
  type OpsRequest,
  type PlayerRef,
  type PlaytimeResponse,
  type StatusResponse,
  type WhitelistEntry,
} from "./protocol";

export const OP_PATH = "/ops";
export const PLUGIN_HEALTH_PATH = "/health";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class BridgeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly op?: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

export interface BridgeClientOptions {
  baseUrl: string;
  secret: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  log?: Logger;
  now?: () => number;
}

export interface BridgeOps {
  isHealthy(maxAgeMs?: number): boolean;
  health(): Promise<boolean>;
  getWhitelist(): Promise<WhitelistEntry[]>;
  addJava(uuid: string, username: string): Promise<MutateResponse>;
  removeJava(uuid: string, username: string): Promise<MutateResponse>;
  addBedrock(gamertag: string, xuid?: string): Promise<MutateResponse>;
  removeBedrock(gamertag: string, xuid?: string): Promise<MutateResponse>;
  getPlaytime(uuid: string): Promise<PlaytimeResponse>;
  getOnlinePlayers(): Promise<PlayerRef[]>;
  getStatus(): Promise<StatusResponse>;
  readonly lastError: string | null;
}

/**
 * The only way the Discord bot talks to Minecraft. Every call is a typed
 * operation over a private network - never an arbitrary command.
 */
export class BridgeClient implements BridgeOps {
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly log: Logger | undefined;
  private readonly now: () => number;
  private lastOkAt = 0;
  private lastFailureAt = 0;
  private lastProbeOk = false;
  private lastErrorMessage: string | null = null;

  constructor(options: BridgeClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.secret = options.secret;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.log = options.log;
    this.now = options.now ?? Date.now;
  }

  get lastError(): string | null {
    return this.lastErrorMessage;
  }

  isHealthy(maxAgeMs = 15_000): boolean {
    if (!this.lastProbeOk || this.lastOkAt === 0) return false;
    return this.now() - this.lastOkAt <= maxAgeMs;
  }

  private async post(body: OpsRequest): Promise<unknown> {
    const url = `${this.baseUrl}${OP_PATH}`;
    let response: Response;
    try {
      response = await withTimeout(
        this.fetchImpl(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.secret}`,
          },
          body: JSON.stringify(body),
        }),
        this.timeoutMs,
        `bridge ${body.op}`,
      );
    } catch (err) {
      this.lastFailureAt = this.now();
      this.lastProbeOk = false;
      this.lastErrorMessage = err instanceof Error ? err.message : String(err);
      this.log?.warn("bridge request failed", { op: body.op, error: this.lastErrorMessage });
      throw new BridgeError(this.lastErrorMessage, undefined, body.op);
    }

    const text = await response.text();
    if (!response.ok) {
      this.lastFailureAt = this.now();
      this.lastProbeOk = false;
      let message = `HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(text) as { error?: string; reason?: string };
        if (parsed.error) message = `${parsed.error} (HTTP ${response.status})`;
        else if (parsed.reason) message = `${parsed.reason} (HTTP ${response.status})`;
      } catch {
        /* keep the status message */
      }
      this.lastErrorMessage = `${body.op}: ${message}`;
      throw new BridgeError(this.lastErrorMessage, response.status, body.op);
    }

    this.lastOkAt = this.now();
    this.lastProbeOk = true;
    this.lastErrorMessage = null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new BridgeError(`bridge ${body.op} returned invalid json`, response.status, body.op);
    }
  }

  private async op<T>(
    body: OpsRequest,
    parse: (value: unknown) => { success: true; data: T } | { success: false },
  ): Promise<T> {
    const raw = await this.post(body);
    const parsed = parse(raw);
    if (!parsed.success) {
      throw new BridgeError(`bridge ${body.op} returned an unexpected payload`, 200, body.op);
    }
    return parsed.data;
  }

  async health(): Promise<boolean> {
    try {
      const response = await withTimeout(
        this.fetchImpl(`${this.baseUrl}${PLUGIN_HEALTH_PATH}`, { method: "GET" }),
        Math.min(this.timeoutMs, 3000),
        "bridge health",
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw: unknown = await response.json();
      const parsed = pluginHealthSchema.safeParse(raw);
      this.lastOkAt = this.now();
      this.lastProbeOk = parsed.success && parsed.data.ok === true;
      if (!this.lastProbeOk) this.lastErrorMessage = "plugin reported an unhealthy state";
      else this.lastErrorMessage = null;
      return this.lastProbeOk;
    } catch (err) {
      this.lastFailureAt = this.now();
      this.lastProbeOk = false;
      this.lastErrorMessage = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  async getWhitelist(): Promise<WhitelistEntry[]> {
    const body = { op: "getWhitelist", requestId: newId() } as const;
    const data = await this.op(body, (v) => whitelistResponseSchema.safeParse(v));
    return data.entries;
  }

  async addJava(uuid: string, username: string): Promise<MutateResponse> {
    const body = { op: "whitelistAddJava", requestId: newId(), uuid, username } as const;
    return this.op(body, (v) => mutateResponseSchema.safeParse(v));
  }

  async removeJava(uuid: string, username: string): Promise<MutateResponse> {
    const body = { op: "whitelistRemoveJava", requestId: newId(), uuid, username } as const;
    return this.op(body, (v) => mutateResponseSchema.safeParse(v));
  }

  async addBedrock(gamertag: string, xuid?: string): Promise<MutateResponse> {
    const body = { op: "whitelistAddBedrock", requestId: newId(), gamertag, ...(xuid ? { xuid } : {}) } as const;
    return this.op(body, (v) => mutateResponseSchema.safeParse(v));
  }

  async removeBedrock(gamertag: string, xuid?: string): Promise<MutateResponse> {
    const body = {
      op: "whitelistRemoveBedrock",
      requestId: newId(),
      gamertag,
      ...(xuid ? { xuid } : {}),
    } as const;
    return this.op(body, (v) => mutateResponseSchema.safeParse(v));
  }

  async getPlaytime(uuid: string): Promise<PlaytimeResponse> {
    const body = { op: "getPlaytime", requestId: newId(), uuid } as const;
    return this.op(body, (v) => playtimeResponseSchema.safeParse(v));
  }

  async getOnlinePlayers(): Promise<PlayerRef[]> {
    const body = { op: "getOnlinePlayers", requestId: newId() } as const;
    const data = await this.op(body, (v) => onlinePlayersResponseSchema.safeParse(v));
    return data.players;
  }

  async getStatus(): Promise<StatusResponse> {
    const body = { op: "getStatus", requestId: newId() } as const;
    return this.op(body, (v) => statusResponseSchema.safeParse(v));
  }
}
