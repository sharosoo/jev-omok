/*
 * The whole client game state. The board is applied locally the moment the
 * human clicks so the 3D scene never waits on the network; the Worker's reply
 * is then merged in. Rule knowledge lives in @/engine/rules and is never
 * reimplemented here.
 */

import { create } from "zustand";

import {
  boardFromMoves,
  checkWinner,
  createBoard,
  forbiddenPoints,
  toRows,
  validateMoves,
} from "@/engine/rules";
import { ApiFailure, type ApiFailureKind, parseCoord, parseMoveResponse, requestMove } from "@/lib/api";
import { isRecord } from "@/lib/guards";
import type {
  Cell,
  Coord,
  Difficulty,
  GameStatus,
  LineId,
  MoveResponse,
  MoveSource,
  Player,
  RuleSet,
} from "@/game/protocol";

const STORAGE_KEY = "jev-omok:game:v1";

export const HUMAN: Player = 1;
export const AI: Player = 2;

/** Selector order for the HUD controls; also the accepted set when restoring. */
export const DIFFICULTY_ORDER: readonly Difficulty[] = [
  "beginner",
  "easy",
  "medium",
  "hard",
  "master",
];
export const RULE_ORDER: readonly RuleSet[] = ["freestyle", "double_three_ban"];

export type Turn = "human" | "ai";

/**
 * `thinking` is the only phase with a request in flight, which makes it the
 * in-flight lock as well: a failed turn returns to `idle` with `turn` still on
 * the AI, so the board stays locked but the retry control is live.
 */
export type Phase = "idle" | "thinking" | "over";

export interface AiInsight {
  readonly source: MoveSource;
  readonly reason: string;
  readonly confidence: number | null;
  readonly danger: number | null;
  readonly line: { readonly id: LineId; readonly text: string } | null;
}

export interface GameState {
  board: Cell[][];
  /** Full history in play order, black first. */
  moves: Coord[];
  turn: Turn;
  phase: Phase;
  status: GameStatus;
  rule: RuleSet;
  difficulty: Difficulty;
  /** Points the human may not play under the active rule; empty on freestyle. */
  forbidden: Coord[];
  lastAi: AiInsight | null;
  error: ApiFailureKind | null;

  placeHuman: (coord: Coord) => void;
  requestAiMove: () => void;
  newGame: () => void;
  setRule: (rule: RuleSet) => void;
  setDifficulty: (difficulty: Difficulty) => void;
  undo: () => void;
  /** Called once from the page on mount; safe to call twice. */
  restore: () => void;
}

const IDLE_STATUS: GameStatus = { winner: 0, winningLine: null, boardFull: false };

const emptyRows = (): Cell[][] => toRows(createBoard());

/* Unchanged rows are shared with the previous state: nothing ever mutates a
 * board that has already been handed to React. */
const withStone = (board: readonly Cell[][], coord: Coord, player: Player): Cell[][] =>
  board.map((row, y) =>
    y === coord.y ? row.map((cell, x) => (x === coord.x ? player : cell)) : row,
  );

const isEmptyPoint = (board: readonly Cell[][], coord: Coord): boolean => {
  const row = board[coord.y];
  return row !== undefined && row[coord.x] === 0;
};

/** Replays through the engine so the store owns no rule logic of its own. */
const rowsFromMoves = (moves: readonly Coord[]): Cell[][] | null => {
  const check = validateMoves(moves);
  return check.ok ? toRows(boardFromMoves(moves)) : null;
};

const statusOf = (board: readonly Cell[][], moves: readonly Coord[]): GameStatus => {
  const last = moves.at(-1);
  return last === undefined ? IDLE_STATUS : checkWinner(board, last);
};

const insightOf = (response: MoveResponse): AiInsight => ({
  source: response.source,
  reason: response.reason,
  confidence: response.confidence,
  danger: response.danger,
  line: response.line,
});

/**
 * Stale-response guard. Bumped by anything that invalidates the position, so a
 * reply that lands after `newGame`/`undo` is discarded instead of applied to a
 * board it was never computed for.
 */
let generation = 0;

interface PersistedGame {
  readonly moves: readonly Coord[];
  readonly rule: RuleSet;
  readonly difficulty: Difficulty;
  /** Stored whole so restoring can reuse the wire parser for validation. */
  readonly lastResponse: MoveResponse | null;
}

const save = (state: GameState, lastResponse: MoveResponse | null): void => {
  const snapshot: PersistedGame = {
    moves: state.moves,
    rule: state.rule,
    difficulty: state.difficulty,
    lastResponse,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Private mode or a full quota: the game stays playable, just not resumable.
  }
};

const clearStored = (): void => {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // A snapshot we cannot delete is still one we will refuse to use.
  }
};

const loadStored = (): PersistedGame | null => {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(payload) || !Array.isArray(payload.moves)) return null;

  const moves: Coord[] = [];
  for (const entry of payload.moves) {
    const coord = parseCoord(entry);
    if (coord === null) return null;
    moves.push(coord);
  }

  return {
    moves,
    rule: RULE_ORDER.find((rule) => rule === payload.rule) ?? "freestyle",
    difficulty: DIFFICULTY_ORDER.find((level) => level === payload.difficulty) ?? "medium",
    lastResponse: parseMoveResponse(payload.lastResponse),
  };
};

export const useGameStore = create<GameState>()((set, get) => ({
  board: emptyRows(),
  moves: [],
  turn: "human",
  phase: "idle",
  status: IDLE_STATUS,
  rule: "freestyle",
  difficulty: "medium",
  forbidden: [],
  lastAi: null,
  error: null,

  placeHuman: (coord) => {
    const state = get();
    if (state.phase !== "idle" || state.turn !== "human") return;
    if (!isEmptyPoint(state.board, coord)) return;
    if (state.forbidden.some((point) => point.x === coord.x && point.y === coord.y)) return;

    const board = withStone(state.board, coord, HUMAN);
    const moves = [...state.moves, coord];
    const status = checkWinner(board, coord);
    const decided = status.winner !== 0 || status.boardFull;

    set({
      board,
      moves,
      status,
      error: null,
      // Handing the turn over before the request means a second click in the
      // synchronous gap is rejected on `turn`, not on `phase`.
      turn: decided ? "human" : "ai",
      phase: decided ? "over" : "idle",
      forbidden: decided ? [] : forbiddenPoints(board, HUMAN, state.rule),
    });
    save(get(), null);
    if (!decided) get().requestAiMove();
  },

  requestAiMove: () => {
    if (get().phase !== "idle") return;

    const ticket = ++generation;
    set({ phase: "thinking", turn: "ai", error: null });

    void (async () => {
      try {
        const pending = get();
        const response = await requestMove({
          moves: pending.moves,
          // Read at request time so a setting changed mid-turn applies next turn.
          rule: pending.rule,
          difficulty: pending.difficulty,
        });
        if (ticket !== generation) return;

        const fresh = get();
        const { move } = response;
        const decided = response.status.winner !== 0 || response.status.boardFull;
        const unusable =
          move === null ? !decided : !isEmptyPoint(fresh.board, move);
        if (unusable) {
          set({ phase: "idle", error: "protocol" });
          return;
        }

        const board = move === null ? fresh.board : withStone(fresh.board, move, AI);
        const moves = move === null ? fresh.moves : [...fresh.moves, move];

        set({
          board,
          moves,
          status: response.status,
          lastAi: insightOf(response),
          turn: "human",
          phase: decided ? "over" : "idle",
          forbidden: decided ? [] : forbiddenPoints(board, HUMAN, fresh.rule),
          error: null,
        });
        save(get(), response);
      } catch (failure) {
        if (ticket !== generation) return;
        // `turn` stays on the AI: the human's stone is kept and the board stays
        // locked, but the HUD's retry control can re-issue the same turn.
        set({
          phase: "idle",
          error: failure instanceof ApiFailure ? failure.kind : "protocol",
        });
      }
    })();
  },

  newGame: () => {
    generation += 1;
    set({
      board: emptyRows(),
      moves: [],
      turn: "human",
      phase: "idle",
      status: IDLE_STATUS,
      forbidden: [],
      lastAi: null,
      error: null,
    });
    clearStored();
  },

  setRule: (rule) => {
    const state = get();
    // Applies from the next move on; the existing record is never re-validated.
    set({
      rule,
      forbidden: state.phase === "over" ? [] : forbiddenPoints(state.board, HUMAN, rule),
    });
    save(get(), null);
  },

  setDifficulty: (difficulty) => {
    set({ difficulty });
    save(get(), null);
  },

  undo: () => {
    const state = get();
    if (state.moves.length === 0) return;

    // An odd history means the AI never answered, so only the human stone goes.
    const drop = state.moves.length % 2 === 1 ? 1 : 2;
    const moves = state.moves.slice(0, state.moves.length - drop);
    const board = rowsFromMoves(moves);
    if (board === null) return;

    generation += 1;
    set({
      board,
      moves,
      turn: "human",
      phase: "idle",
      status: statusOf(board, moves),
      forbidden: forbiddenPoints(board, HUMAN, state.rule),
      lastAi: null,
      error: null,
    });
    save(get(), null);
  },

  restore: () => {
    // A StrictMode remount calls this twice; the second call must not replay
    // the snapshot and fire a duplicate turn request.
    if (get().moves.length > 0 || get().phase !== "idle") return;

    const stored = loadStored();
    if (stored === null) return;

    const moves = [...stored.moves];
    const board = rowsFromMoves(moves);
    if (board === null) {
      clearStored();
      return;
    }

    const status = statusOf(board, moves);
    const decided = status.winner !== 0 || status.boardFull;
    const owesReply = !decided && moves.length % 2 === 1;

    generation += 1;
    set({
      board,
      moves,
      status,
      rule: stored.rule,
      difficulty: stored.difficulty,
      turn: decided || !owesReply ? "human" : "ai",
      phase: decided ? "over" : "idle",
      forbidden: decided ? [] : forbiddenPoints(board, HUMAN, stored.rule),
      lastAi: stored.lastResponse === null ? null : insightOf(stored.lastResponse),
      error: null,
    });

    // Reload during the AI's turn: resume it rather than leave the board locked.
    if (owesReply) get().requestAiMove();
  },
}));
