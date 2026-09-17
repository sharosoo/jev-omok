/*
 * Transport for human-vs-human play: the two WebSockets plus the two REST calls
 * that bracket them. No React here — the store owns the lifecycle, this module
 * owns the wire and is the only place that turns an untrusted frame into a
 * `ServerMessage`.
 */

import type { Coord, GameStatus, RuleSet } from "@/game/protocol";
import type {
  ClientMessage,
  Clocks,
  EndReason,
  PlayerInfo,
  QueueClientMessage,
  QueueServerMessage,
  Role,
  RoomSnapshot,
  Seat,
  ServerErrorCode,
  ServerMessage,
} from "@/game/realtime";
import { REALTIME_PROTOCOL_VERSION } from "@/game/realtime";
import { parseCoord } from "@/lib/api";
import { isRecord } from "@/lib/guards";

/* ---------- frame parsing ---------- */

/* Keyed by the union so a new member of either type fails to compile here. */
const END_REASONS: Record<EndReason, true> = {
  five: true,
  resign: true,
  timeout: true,
  abandoned: true,
  draw: true,
};

const ERROR_CODES: Record<ServerErrorCode, true> = {
  bad_message: true,
  unauthenticated: true,
  room_full: true,
  not_your_turn: true,
  illegal_move: true,
  forbidden_point: true,
  game_over: true,
  stale_ply: true,
  version_mismatch: true,
  rate_limited: true,
};

const RULE_SETS: Record<RuleSet, true> = { freestyle: true, double_three_ban: true };

const isSeat = (value: unknown): value is Seat => value === "black" || value === "white";

const isRole = (value: unknown): value is Role => isSeat(value) || value === "spectator";

export const isEndReason = (value: unknown): value is EndReason =>
  typeof value === "string" && Object.hasOwn(END_REASONS, value);

export const isServerErrorCode = (value: unknown): value is ServerErrorCode =>
  typeof value === "string" && Object.hasOwn(ERROR_CODES, value);

const isRuleSet = (value: unknown): value is RuleSet =>
  typeof value === "string" && Object.hasOwn(RULE_SETS, value);

const isEpoch = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const parseCoordList = (value: unknown): Coord[] | null => {
  if (!Array.isArray(value)) return null;
  const coords: Coord[] = [];
  for (const entry of value) {
    const coord = parseCoord(entry);
    if (coord === null) return null;
    coords.push(coord);
  }
  return coords;
};

const parseGameStatus = (value: unknown): GameStatus | null => {
  if (!isRecord(value)) return null;
  const { winner, winningLine, boardFull } = value;
  if (winner !== 0 && winner !== 1 && winner !== 2) return null;
  if (typeof boardFull !== "boolean") return null;
  if (winningLine === null || winningLine === undefined) {
    return { winner, winningLine: null, boardFull };
  }
  const line = parseCoordList(winningLine);
  if (line === null) return null;
  return { winner, winningLine: line, boardFull };
};

const parsePlayer = (value: unknown): PlayerInfo | null => {
  if (!isRecord(value)) return null;
  const { id, name, guest, connected } = value;
  if (typeof id !== "string" || typeof name !== "string") return null;
  if (typeof guest !== "boolean" || typeof connected !== "boolean") return null;
  return { id, name, guest, connected };
};

const parseSeats = (value: unknown): RoomSnapshot["players"] | null => {
  if (!isRecord(value)) return null;
  const black = value.black === null ? null : parsePlayer(value.black);
  if (black === null && value.black !== null) return null;
  const white = value.white === null ? null : parsePlayer(value.white);
  if (white === null && value.white !== null) return null;
  return { black, white };
};

const parseClocks = (value: unknown): Clocks | null => {
  if (!isRecord(value)) return null;
  const { black, white, turnStartedAt } = value;
  if (!isEpoch(black) || !isEpoch(white) || !isEpoch(turnStartedAt)) return null;
  return { black, white, turnStartedAt };
};

export const parseRoomSnapshot = (value: unknown): RoomSnapshot | null => {
  if (!isRecord(value)) return null;
  const { code, rule, moves, status, turn, players, clocks, winner, endReason, spectators } = value;

  if (typeof code !== "string" || !isRuleSet(rule)) return null;
  if (typeof spectators !== "number" || !Number.isFinite(spectators)) return null;
  if (turn !== null && !isSeat(turn)) return null;
  if (endReason !== null && !isEndReason(endReason)) return null;
  if (winner !== null && !isSeat(winner)) return null;

  const parsedMoves = parseCoordList(moves);
  const parsedStatus = parseGameStatus(status);
  const parsedPlayers = parseSeats(players);
  const parsedClocks = parseClocks(clocks);
  if (parsedMoves === null || parsedStatus === null) return null;
  if (parsedPlayers === null || parsedClocks === null) return null;

  return {
    code,
    rule,
    moves: parsedMoves,
    status: parsedStatus,
    turn,
    players: parsedPlayers,
    clocks: parsedClocks,
    winner,
    endReason,
    spectators,
  };
};

export const parseServerMessage = (value: unknown): ServerMessage | null => {
  if (!isRecord(value)) return null;
  switch (value.t) {
    case "welcome": {
      const { v, role, you, resumeKey } = value;
      if (typeof v !== "number" || !isRole(role) || typeof resumeKey !== "string") return null;
      const player = parsePlayer(you);
      const snapshot = parseRoomSnapshot(value.snapshot);
      if (player === null || snapshot === null) return null;
      return { t: "welcome", v, role, you: player, resumeKey, snapshot };
    }
    case "snapshot": {
      const snapshot = parseRoomSnapshot(value.snapshot);
      return snapshot === null ? null : { t: "snapshot", snapshot };
    }
    case "move": {
      const { by, ply, turn } = value;
      const coord = parseCoord(value.coord);
      const status = parseGameStatus(value.status);
      const clocks = parseClocks(value.clocks);
      if (coord === null || status === null || clocks === null) return null;
      if (!isSeat(by) || typeof ply !== "number" || !Number.isInteger(ply)) return null;
      if (turn !== null && !isSeat(turn)) return null;
      return { t: "move", coord, by, ply, status, turn, clocks };
    }
    case "presence": {
      const players = parseSeats(value.players);
      const { spectators } = value;
      if (players === null || typeof spectators !== "number") return null;
      return { t: "presence", players, spectators };
    }
    case "over": {
      const { winner, reason, matchId } = value;
      const status = parseGameStatus(value.status);
      if (status === null || !isEndReason(reason)) return null;
      if (winner !== null && !isSeat(winner)) return null;
      if (matchId !== null && typeof matchId !== "string") return null;
      return { t: "over", winner, reason, status, matchId };
    }
    case "rematch_offer":
      return isSeat(value.by) ? { t: "rematch_offer", by: value.by } : null;
    case "rematch_start": {
      const snapshot = parseRoomSnapshot(value.snapshot);
      return snapshot === null ? null : { t: "rematch_start", snapshot };
    }
    case "error": {
      const { code, detail } = value;
      if (!isServerErrorCode(code)) return null;
      return typeof detail === "string"
        ? { t: "error", code, detail }
        : { t: "error", code };
    }
    case "pong": {
      const clocks = parseClocks(value.clocks);
      return clocks === null ? null : { t: "pong", clocks };
    }
    default:
      return null;
  }
};

export const parseQueueMessage = (value: unknown): QueueServerMessage | null => {
  if (!isRecord(value)) return null;
  switch (value.t) {
    case "waiting": {
      const { position } = value;
      if (typeof position !== "number" || !Number.isFinite(position)) return null;
      return { t: "waiting", position };
    }
    case "matched": {
      const { code, seat, ticket } = value;
      if (typeof code !== "string" || !isSeat(seat)) return null;
      if (typeof ticket !== "string") return null;
      return { t: "matched", code, seat, ticket };
    }
    case "error": {
      const { code, detail } = value;
      if (!isServerErrorCode(code)) return null;
      return typeof detail === "string"
        ? { t: "error", code, detail }
        : { t: "error", code };
    }
    default:
      return null;
  }
};

/* ---------- managed socket ---------- */

export type ConnectionState = "connecting" | "open" | "reconnecting" | "closed";

export interface CloseInfo {
  readonly code: number;
  readonly reason: string;
  /** True once the client has stopped retrying; the UI must offer a manual retry. */
  readonly permanent: boolean;
}

export interface SocketHandle<TOut> {
  send(message: TOut): void;
  close(): void;
}

/**
 * Retry schedule in milliseconds. Six attempts, capped at 8 s: long enough to
 * ride out a Durable Object being rescheduled, short enough that a player does
 * not stare at a dead board.
 */
const BACKOFF_MS: readonly number[] = [500, 1_000, 2_000, 4_000, 8_000, 8_000];
/** The room closes with this code when it refuses the hello; retrying cannot help. */
const AUTH_CLOSE_CODE = 4001;
const HEARTBEAT_MS = 25_000;
/** A player cannot usefully stack more intents than this while offline. */
const PENDING_LIMIT = 8;

/*
 * Always same-origin: the Worker serves both the assets and `/api/*` in
 * production, and `next dev` forwards the upgrade through the `/api/*` rewrite
 * to `wrangler dev`.
 */
const socketUrl = (path: string): string => {
  const url = new URL(path, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

interface SocketSpec<TIn, TOut> {
  readonly path: string;
  /** Rebuilt per attempt so a refreshed resume key reaches the room. */
  readonly hello: () => TOut;
  readonly parse: (value: unknown) => TIn | null;
  /**
   * Frame that unlocks the send queue. Null for a socket whose first client
   * frame needs no server answer, which releases the queue right after hello.
   */
  readonly ready: ((message: TIn) => boolean) | null;
  readonly heartbeat: TOut | null;
  readonly onMessage: (message: TIn) => void;
  readonly onState?: (state: ConnectionState) => void;
  readonly onClose?: (info: CloseInfo) => void;
}

const decode = <T>(data: unknown, parse: (value: unknown) => T | null): T | null => {
  if (typeof data !== "string") return null;
  try {
    return parse(JSON.parse(data) as unknown);
  } catch {
    return null;
  }
};

function openManaged<TIn, TOut>(spec: SocketSpec<TIn, TOut>): SocketHandle<TOut> {
  let socket: WebSocket | null = null;
  let live = false;
  let state: ConnectionState = "connecting";
  let attempt = 0;
  let gated = spec.ready !== null;
  let pending: TOut[] = [];
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let lastPingAt = 0;
  let disposed = false;

  const setState = (next: ConnectionState): void => {
    if (state === next) return;
    state = next;
    spec.onState?.(next);
  };

  const write = (message: TOut): void => {
    if (socket === null || !live) return;
    socket.send(JSON.stringify(message));
  };

  const flush = (): void => {
    const queued = pending;
    pending = [];
    for (const message of queued) write(message);
  };

  /*
   * Every inbound frame wakes the Durable Object, so the heartbeat is the
   * cheapest thing that still proves the socket is alive: one frame per 25 s,
   * and none at all while the tab is in the background.
   */
  const ping = (): void => {
    if (spec.heartbeat === null || !live || gated) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    const now = Date.now();
    if (now - lastPingAt < HEARTBEAT_MS) return;
    lastPingAt = now;
    write(spec.heartbeat);
  };

  const onVisible = (): void => {
    if (document.visibilityState === "visible") ping();
  };

  const stopTimers = (): void => {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const retry = (info: CloseInfo): void => {
    if (disposed) return;
    const delay = BACKOFF_MS[attempt];
    if (info.code === AUTH_CLOSE_CODE || delay === undefined) {
      setState("closed");
      spec.onClose?.({ ...info, permanent: true });
      return;
    }
    attempt += 1;
    setState("reconnecting");
    spec.onClose?.(info);
    // Jitter keeps two tabs of the same match from retrying in lockstep.
    retryTimer = setTimeout(connect, delay + Math.random() * 250);
  };

  function connect(): void {
    if (disposed) return;
    retryTimer = null;
    gated = spec.ready !== null;

    let ws: WebSocket;
    try {
      ws = new WebSocket(socketUrl(spec.path));
    } catch {
      retry({ code: 1006, reason: "open failed", permanent: false });
      return;
    }
    socket = ws;

    ws.addEventListener("open", () => {
      if (ws !== socket) return;
      live = true;
      attempt = 0;
      lastPingAt = Date.now();
      write(spec.hello());
      if (spec.ready === null) {
        setState("open");
        flush();
      }
    });

    ws.addEventListener("message", (event: MessageEvent) => {
      if (ws !== socket) return;
      const message = decode(event.data, spec.parse);
      // An off-contract frame is dropped, never cast: the store only ever sees
      // a value that matched the contract field by field.
      if (message === null) return;
      if (gated && spec.ready !== null && spec.ready(message)) {
        gated = false;
        setState("open");
        flush();
      }
      spec.onMessage(message);
    });

    ws.addEventListener("close", (event: CloseEvent) => {
      if (ws !== socket) return;
      socket = null;
      live = false;
      retry({ code: event.code, reason: event.reason, permanent: false });
    });

    ws.addEventListener("error", () => {
      // `error` is always followed by `close`, which owns the retry.
      if (ws === socket && !live) setState(attempt === 0 ? "connecting" : "reconnecting");
    });
  }

  if (spec.heartbeat !== null && typeof document !== "undefined") {
    heartbeatTimer = setInterval(ping, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", onVisible);
  }
  connect();

  return {
    send: (message) => {
      if (disposed) return;
      if (gated || !live) {
        if (pending.length < PENDING_LIMIT) pending.push(message);
        return;
      }
      write(message);
    },
    close: () => {
      disposed = true;
      stopTimers();
      if (spec.heartbeat !== null && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
      pending = [];
      const ws = socket;
      socket = null;
      live = false;
      ws?.close(1000, "client");
      setState("closed");
    },
  };
}

/* ---------- public API ---------- */

export interface RoomOptions {
  readonly code: string;
  /** Bearer token for a signed-in player; null for a guest. */
  readonly token: string | null;
  readonly guestName?: string | null;
  /** Seat claim from a previous `welcome`, so a reload keeps the stones. */
  readonly resumeKey?: string | null;
  readonly onMessage: (message: ServerMessage) => void;
  readonly onState?: (state: ConnectionState) => void;
  readonly onClose?: (info: CloseInfo) => void;
}

export interface QueueOptions {
  readonly token: string | null;
  readonly guestName?: string | null;
  readonly onMessage: (message: QueueServerMessage) => void;
  readonly onState?: (state: ConnectionState) => void;
  readonly onClose?: (info: CloseInfo) => void;
}

const identityFields = (
  token: string | null,
  guestName: string | null | undefined,
): { token?: string; guestName?: string } => ({
  ...(token === null ? {} : { token }),
  ...(token !== null || !guestName ? {} : { guestName }),
});

export function connectRoom(options: RoomOptions): SocketHandle<ClientMessage> {
  // The room hands back a fresh key on every welcome; a later reconnect in this
  // same session must present the newest one.
  let resumeKey = options.resumeKey ?? null;

  return openManaged<ServerMessage, ClientMessage>({
    path: `/api/rooms/${encodeURIComponent(options.code)}/ws`,
    hello: () => ({
      t: "hello",
      v: REALTIME_PROTOCOL_VERSION,
      ...identityFields(options.token, options.guestName),
      ...(resumeKey === null ? {} : { resumeKey }),
    }),
    parse: parseServerMessage,
    ready: (message) => message.t === "welcome",
    heartbeat: { t: "ping" },
    onMessage: (message) => {
      if (message.t === "welcome") resumeKey = message.resumeKey;
      options.onMessage(message);
    },
    ...(options.onState === undefined ? {} : { onState: options.onState }),
    ...(options.onClose === undefined ? {} : { onClose: options.onClose }),
  });
}

export function connectQueue(options: QueueOptions): SocketHandle<QueueClientMessage> {
  return openManaged<QueueServerMessage, QueueClientMessage>({
    path: "/api/queue/ws",
    hello: () => ({
      t: "hello",
      v: REALTIME_PROTOCOL_VERSION,
      ...identityFields(options.token, options.guestName),
    }),
    parse: parseQueueMessage,
    // A cancel sent straight after hello still arrives second, so nothing gates.
    ready: null,
    heartbeat: null,
    onMessage: options.onMessage,
    ...(options.onState === undefined ? {} : { onState: options.onState }),
    ...(options.onClose === undefined ? {} : { onClose: options.onClose }),
  });
}

/* ---------- REST calls around the sockets ---------- */

export class RoomRequestError extends Error {
  readonly missing: boolean;

  constructor(message: string, missing: boolean) {
    super(message);
    this.name = "RoomRequestError";
    this.missing = missing;
  }
}

const authHeaders = (token: string | null): HeadersInit =>
  token === null
    ? { "content-type": "application/json" }
    : { "content-type": "application/json", authorization: `Bearer ${token}` };

/** Creates a private room and returns its code. Throws `RoomRequestError`. */
export async function createRoom(rule: RuleSet, token: string | null): Promise<string> {
  const response = await fetch("/api/rooms", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ rule }),
  });
  if (!response.ok) throw new RoomRequestError(`rooms ${String(response.status)}`, false);

  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body) || typeof body.code !== "string") {
    throw new RoomRequestError("malformed room response", false);
  }
  return body.code;
}

/** Reads a room before joining it, so an unknown code is a state and not a hang. */
export async function fetchRoom(code: string, token: string | null): Promise<RoomSnapshot> {
  const response = await fetch(`/api/rooms/${encodeURIComponent(code)}`, {
    headers: authHeaders(token),
  });
  if (response.status === 404) throw new RoomRequestError("no such room", true);
  if (!response.ok) throw new RoomRequestError(`room ${String(response.status)}`, false);

  const snapshot = parseRoomSnapshot(await response.json().catch(() => null));
  if (snapshot === null) throw new RoomRequestError("malformed snapshot", false);
  return snapshot;
}
