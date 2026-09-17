import { BOARD_SIZE } from "@/game/protocol";
import type { Board, Player, Shape, ShapeReport } from "./types";
import { SHAPE_RANK } from "./types";

export const N = BOARD_SIZE;
export const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

export const idx = (x: number, y: number): number => y * N + x;
export const inBounds = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < N && y < N;

/** Off-board reads return -1 so a wall never matches a stone or an empty point. */
const at = (board: Board, x: number, y: number): number =>
  inBounds(x, y) ? (board[idx(x, y)] as number) : -1;

/**
 * Whether the stone standing at (x,y) sits in a run of five or more along one
 * direction. Five-or-more wins in both supported rule sets, so a long run is a
 * win rather than an overline penalty.
 */
export function makesFive(
  board: Board,
  x: number,
  y: number,
  dx: number,
  dy: number,
  me: Player,
): boolean {
  let run = 1;
  for (let k = 1; k < 5; k++) {
    if (at(board, x + dx * k, y + dy * k) !== me) break;
    run++;
  }
  for (let k = 1; k < 5; k++) {
    if (at(board, x - dx * k, y - dy * k) !== me) break;
    run++;
  }
  return run >= 5;
}

/**
 * How many distinct empty points on this line would complete five for `me`,
 * given that `me` already occupies (x,y). Two or more such points is an open
 * four (the opponent cannot cover both); exactly one is a simple four. Counting
 * completion points instead of matching pattern strings gets broken shapes
 * (`OO_OO`, `O_OOO`) right without a hand-written table.
 */
function fivePoints(
  board: Board,
  x: number,
  y: number,
  dx: number,
  dy: number,
  me: Player,
): number {
  let found = 0;
  for (let k = -4; k <= 4; k++) {
    if (k === 0) continue;
    const px = x + dx * k;
    const py = y + dy * k;
    if (at(board, px, py) !== 0) continue;
    const i = idx(px, py);
    board[i] = me;
    const five = makesFive(board, px, py, dx, dy, me);
    board[i] = 0;
    if (five) found++;
  }
  return found;
}

/**
 * Classify the shape `me` holds along one direction through (x,y), which must
 * already carry the stone. A three is defined by what it can become: a point
 * that turns it into an open four makes it an open three, a point that turns it
 * into a simple four makes it a closed three.
 */
export function shapeOnLine(
  board: Board,
  x: number,
  y: number,
  dx: number,
  dy: number,
  me: Player,
): Shape {
  if (makesFive(board, x, y, dx, dy, me)) return "five";

  const n5 = fivePoints(board, x, y, dx, dy, me);
  if (n5 >= 2) return "openFour";
  if (n5 === 1) return "four";

  let closed = false;
  for (let k = -4; k <= 4; k++) {
    if (k === 0) continue;
    const px = x + dx * k;
    const py = y + dy * k;
    if (at(board, px, py) !== 0) continue;
    const i = idx(px, py);
    board[i] = me;
    const follow = fivePoints(board, px, py, dx, dy, me);
    board[i] = 0;
    if (follow >= 2) return "openThree";
    if (follow === 1) closed = true;
  }
  return closed ? "closedThree" : "none";
}

/**
 * Quiet-position potential along one direction: every five-window through the
 * point that the opponent has not touched contributes (own stones)^2, so a
 * stone that joins two of its own in an unobstructed line outranks a lone one.
 */
function linePotential(
  board: Board,
  x: number,
  y: number,
  dx: number,
  dy: number,
  me: Player,
): number {
  let total = 0;
  for (let s = -4; s <= 0; s++) {
    let mine = 0;
    let usable = true;
    for (let k = s; k < s + 5; k++) {
      const v = at(board, x + dx * k, y + dy * k);
      if (v === -1 || (v !== 0 && v !== me)) {
        usable = false;
        break;
      }
      if (v === me) mine++;
    }
    if (usable) total += mine * mine;
  }
  return total;
}

const EMPTY_COUNTS: Record<Shape, number> = {
  five: 0,
  openFour: 0,
  four: 0,
  openThree: 0,
  closedThree: 0,
  none: 0,
};

/**
 * Everything `me` gains by occupying an empty (x,y): the shape on each of the
 * four directions, tallied. The point is written and restored in place, so the
 * caller's board is unchanged on return.
 */
export function reportAt(board: Board, x: number, y: number, me: Player): ShapeReport {
  const i = idx(x, y);
  const previous = board[i] as number;
  board[i] = me;

  const counts: Record<Shape, number> = { ...EMPTY_COUNTS };
  let best: Shape = "none";
  let potential = 0;

  for (const [dx, dy] of DIRS) {
    const shape = shapeOnLine(board, x, y, dx as number, dy as number, me);
    counts[shape]++;
    if (SHAPE_RANK[shape] > SHAPE_RANK[best]) best = shape;
    potential += linePotential(board, x, y, dx as number, dy as number, me);
  }

  board[i] = previous;
  return { best, counts, potential };
}

/** Threats that force an answer: a four or better. */
export const forcingCount = (counts: Readonly<Record<Shape, number>>): number =>
  counts.five + counts.openFour + counts.four;

/** A move is a fork when it leaves two threats the opponent cannot both answer. */
export function isFork(counts: Readonly<Record<Shape, number>>): boolean {
  const forcing = forcingCount(counts);
  const threes = counts.openThree;
  return forcing >= 2 || (forcing >= 1 && threes >= 1) || threes >= 2;
}
