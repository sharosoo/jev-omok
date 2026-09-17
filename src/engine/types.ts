import type { Cell, Coord, Difficulty, Player, RuleSet } from "@/game/protocol";

/**
 * Flat 15x15 board, index = y * 15 + x. A typed array keeps the hot loops in
 * the pattern scanner allocation-free; the 2D form only exists at the wire and
 * UI boundary.
 */
export type Board = Uint8Array;

/**
 * Shapes a single stone placement can create on one line, ordered by strength.
 * `closedThree` is a three that can only become a simple four, never an open
 * four, so it does not force an answer on its own.
 */
export type Shape = "five" | "openFour" | "four" | "openThree" | "closedThree" | "none";

export const SHAPE_RANK: Record<Shape, number> = {
  none: 0,
  closedThree: 1,
  openThree: 2,
  four: 3,
  openFour: 4,
  five: 5,
};

/** Per-direction shapes produced by one placement, plus their tally. */
export interface ShapeReport {
  readonly best: Shape;
  readonly counts: Readonly<Record<Shape, number>>;
  /** Quiet-position potential: sum over open 5-windows of (own stones)^2. */
  readonly potential: number;
}

export interface PointAnalysis {
  readonly coord: Coord;
  /** What the mover gains by playing here. */
  readonly offense: ShapeReport;
  /** What the opponent would gain here, i.e. what playing here denies. */
  readonly defense: ShapeReport;
  /** Static ranking score used for move ordering and candidate truncation. */
  readonly score: number;
  /** True when this point is forbidden for the mover under the active rule. */
  readonly forbidden: boolean;
}

export interface Position {
  readonly board: Board;
  readonly toMove: Player;
  readonly rule: RuleSet;
  readonly moves: readonly Coord[];
}

export interface DifficultyProfile {
  readonly candidateLimit: number;
  readonly vcfDepth: number;
  /** Alpha-beta depth in plies. 0 disables the search for this level. */
  readonly searchDepth: number;
  /** Candidates examined at the search root, and at deeper plies. */
  readonly rootWidth: number;
  readonly innerWidth: number;
  /** Node ceiling so a pathological position cannot blow the CPU budget. */
  readonly nodeLimit: number;
  /**
   * How far below the best search score a move may sit and still be offered to
   * the judgment layer. Larger values buy style at the cost of strength.
   */
  readonly nearBestMargin: number;
  /** Probability the AI notices and takes an immediate five. */
  readonly takeFive: number;
  /** Probability the AI blocks an opponent four or open four. */
  readonly blockFour: number;
  /** Probability the AI answers an opponent open three or fork point. */
  readonly blockThree: number;
  /** Softmax temperature applied to Jev's probability distribution. 0 = argmax. */
  readonly temperature: number;
  /** Chance of deliberately picking a mid-ranked candidate on a quiet turn. */
  readonly blunderRate: number;
  /** Whether this level consults Jev at all. */
  readonly useJev: boolean;
}

export type { Cell, Coord, Difficulty, Player, RuleSet };
