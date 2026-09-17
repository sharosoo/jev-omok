/*
 * Wire contract between the browser and the Worker. Both sides import this file;
 * it must stay free of engine internals and of any React or Worker API.
 */

export const BOARD_SIZE = 15;

/** 1 = black, who always moves first and is the human. 2 = white, the AI. */
export type Player = 1 | 2;
export type Cell = 0 | Player;

export interface Coord {
  readonly x: number; // column, 0 = leftmost
  readonly y: number; // row, 0 = top
}

/**
 * Rule presets. `freestyle` is the default: five or more in a row wins and no
 * point is forbidden. `double_three_ban` is the Korean casual 33 금수 rule,
 * applied symmetrically to both players so the human is never surprised by an
 * asymmetric Renju restriction.
 */
export type RuleSet = "freestyle" | "double_three_ban";

export type Difficulty = "beginner" | "easy" | "medium" | "hard" | "master";

/** Why the AI played where it played. Drives the UI explanation, not styling. */
export type MoveSource =
  | "opening_book"
  | "forced_win"
  | "forced_block"
  | "vcf"
  | "jev"
  | "engine_fallback";

export type LineId =
  | "calm_open"
  | "respect_human"
  | "warn_own_threat"
  | "taunt_strong"
  | "panic"
  | "ai_wins"
  | "human_wins"
  | "draw";

export interface MoveRequest {
  /** Full history from move 1 in play order, black first, alternating. */
  readonly moves: readonly Coord[];
  readonly rule: RuleSet;
  readonly difficulty: Difficulty;
  /** Optional deterministic seed; omit for a fresh random stream per request. */
  readonly seed?: number;
}

export interface GameStatus {
  /** 0 while the game is still running. */
  readonly winner: 0 | Player;
  /** The five stones that ended the game, for the win highlight. */
  readonly winningLine: readonly Coord[] | null;
  readonly boardFull: boolean;
}

export interface MoveResponse {
  /** null only when the position was already decided before the AI could move. */
  readonly move: Coord | null;
  readonly source: MoveSource;
  /** Short English key describing the decision, for logs and the debug panel. */
  readonly reason: string;
  /** Jev's confidence in its pick, 0-1. null when code decided the move. */
  readonly confidence: number | null;
  /**
   * How much danger the AI thinks it is in, 0 (safe) to 3 (losing), from Jev's
   * Score question. null when the Jev call was skipped or failed.
   */
  readonly danger: number | null;
  readonly line: { readonly id: LineId; readonly text: string } | null;
  readonly status: GameStatus;
  /** Total server time for the turn, including the Jev round trip. */
  readonly latencyMs: number;
}

export interface ErrorResponse {
  readonly error: string;
  readonly detail?: string;
}

export const isErrorResponse = (v: MoveResponse | ErrorResponse): v is ErrorResponse =>
  "error" in v;
