/*
 * Client for the Hono Worker's /api/move. The response crosses a network
 * boundary, so it is parsed once here into the protocol types; the store only
 * ever sees a validated `MoveResponse` or an `ApiFailure`.
 */

import {
  BOARD_SIZE,
  type Coord,
  type GameStatus,
  type LineId,
  type MoveRequest,
  type MoveResponse,
  type MoveSource,
} from "@/game/protocol";
import { isRecord } from "@/lib/guards";

/** Relative so the Worker serves it in production and the dev rewrite proxies it. */
const MOVE_ENDPOINT = "/api/move";

const TIMEOUT_MS = 12_000;
const RETRY_DELAY_MS = 400;

/**
 * `protocol` covers both a 4xx and a malformed body: retrying either cannot
 * help, and the HUD explains it differently than a transient server fault.
 */
export type ApiFailureKind = "timeout" | "network" | "server" | "protocol";

export class ApiFailure extends Error {
  readonly kind: ApiFailureKind;
  /** Raw server text, kept for logs and out of user-facing copy. */
  readonly detail: string | undefined;
  readonly retryable: boolean;

  constructor(
    kind: ApiFailureKind,
    message: string,
    options: { retryable?: boolean; detail?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ApiFailure";
    this.kind = kind;
    this.detail = options.detail;
    this.retryable = options.retryable ?? false;
  }
}

/* Keyed by the union so a new MoveSource or LineId fails to compile here. */
const MOVE_SOURCES: Record<MoveSource, true> = {
  opening_book: true,
  forced_win: true,
  forced_block: true,
  vcf: true,
  jev: true,
  engine_fallback: true,
};

const LINE_IDS: Record<LineId, true> = {
  calm_open: true,
  respect_human: true,
  warn_own_threat: true,
  taunt_strong: true,
  panic: true,
  ai_wins: true,
  human_wins: true,
  draw: true,
};

const isMoveSource = (value: unknown): value is MoveSource =>
  typeof value === "string" && Object.hasOwn(MOVE_SOURCES, value);

const isLineId = (value: unknown): value is LineId =>
  typeof value === "string" && Object.hasOwn(LINE_IDS, value);

export const parseCoord = (value: unknown): Coord | null => {
  if (!isRecord(value)) return null;
  const { x, y } = value;
  if (typeof x !== "number" || !Number.isInteger(x) || x < 0 || x >= BOARD_SIZE) return null;
  if (typeof y !== "number" || !Number.isInteger(y) || y < 0 || y >= BOARD_SIZE) return null;
  return { x, y };
};

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
  if (winningLine === null) return { winner, winningLine: null, boardFull };
  const line = parseCoordList(winningLine);
  if (line === null) return null;
  return { winner, winningLine: line, boardFull };
};

const parseSpokenLine = (value: unknown): MoveResponse["line"] | null => {
  if (!isRecord(value)) return null;
  const { id, text } = value;
  if (!isLineId(id) || typeof text !== "string") return null;
  return { id, text };
};

const isFiniteOrNull = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value));

export const parseMoveResponse = (value: unknown): MoveResponse | null => {
  if (!isRecord(value)) return null;
  const { move, source, reason, confidence, danger, line, status, latencyMs } = value;

  if (!isMoveSource(source)) return null;
  if (typeof reason !== "string") return null;
  if (typeof latencyMs !== "number" || !Number.isFinite(latencyMs)) return null;
  if (!isFiniteOrNull(confidence) || !isFiniteOrNull(danger)) return null;

  const parsedMove = move === null ? null : parseCoord(move);
  if (parsedMove === null && move !== null) return null;

  const parsedLine = line === null ? null : parseSpokenLine(line);
  if (parsedLine === null && line !== null) return null;

  const parsedStatus = parseGameStatus(status);
  if (parsedStatus === null) return null;

  return {
    move: parsedMove,
    source,
    reason,
    confidence,
    danger,
    line: parsedLine,
    status: parsedStatus,
    latencyMs,
  };
};

const interpret = (status: number, ok: boolean, body: string): MoveResponse => {
  let payload: unknown;
  try {
    payload = JSON.parse(body) as unknown;
  } catch {
    payload = undefined;
  }

  // An ErrorResponse may ride on any status, so read it before branching.
  let serverError: string | undefined;
  if (isRecord(payload) && typeof payload.error === "string") {
    serverError = typeof payload.detail === "string" ? payload.detail : payload.error;
  }

  if (!ok) {
    const serverFault = status >= 500;
    throw new ApiFailure(
      serverFault ? "server" : "protocol",
      `move request failed with HTTP ${status}`,
      { retryable: serverFault, detail: serverError },
    );
  }

  // A 200 carrying an ErrorResponse is a refusal by the Worker, not a transport fault.
  if (serverError !== undefined) {
    throw new ApiFailure("server", "worker refused the move", { detail: serverError });
  }

  const parsed = parseMoveResponse(payload);
  if (parsed === null) {
    throw new ApiFailure("protocol", "move response did not match the wire contract");
  }
  return parsed;
};

const attempt = async (request: MoveRequest): Promise<MoveResponse> => {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, TIMEOUT_MS);

  try {
    const response = await fetch(MOVE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    return interpret(response.status, response.ok, await response.text());
  } catch (cause) {
    if (cause instanceof ApiFailure) throw cause;
    // The deadline already spent the whole budget, so a timeout is not retried.
    if (controller.signal.aborted) {
      throw new ApiFailure("timeout", `move request exceeded ${TIMEOUT_MS}ms`, { cause });
    }
    throw new ApiFailure("network", "move request could not reach the worker", {
      retryable: true,
      cause,
    });
  } finally {
    clearTimeout(timer);
  }
};

/** Asks the Worker for white's reply. Throws `ApiFailure` and nothing else. */
export const requestMove = async (request: MoveRequest): Promise<MoveResponse> => {
  try {
    return await attempt(request);
  } catch (failure) {
    if (!(failure instanceof ApiFailure) || !failure.retryable) throw failure;
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, RETRY_DELAY_MS);
    await promise;
    return attempt(request);
  }
};
