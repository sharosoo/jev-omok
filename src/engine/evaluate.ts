import type { Player } from "@/game/protocol";
import { DIRS, N, idx, inBounds } from "./patterns";
import type { Board } from "./types";

/**
 * Position evaluation, always from black's point of view so the number can be
 * kept incrementally and negated per side inside the search.
 *
 * Every five-window is classified by how many stones each side has in it. A
 * window both sides occupy is dead and scores nothing, so open shapes are
 * rewarded and blocked ones are not, without a pattern table. Weights grow
 * superlinearly so a four dominates any number of twos, and open ends count
 * separately because `_OOO_` is not `XOOO_`.
 */
const RUN_SCORE = [0, 1, 18, 180, 2_400, 120_000] as const;
const OPEN_END_BONUS = [0, 1, 12, 160, 3_000, 0] as const;

export const WIN_SCORE = 10_000_000;

/** Contribution of one five-window, black-positive. */
function windowScore(black: number, white: number, openEnds: number): number {
  if (black > 0 && white > 0) return 0;
  if (black > 0) {
    return (RUN_SCORE[black] as number) + openEnds * (OPEN_END_BONUS[black] as number);
  }
  if (white > 0) {
    return -((RUN_SCORE[white] as number) + openEnds * (OPEN_END_BONUS[white] as number));
  }
  return 0;
}

function scoreWindow(
  board: Board,
  x: number,
  y: number,
  dx: number,
  dy: number,
  start: number,
): number {
  let black = 0;
  let white = 0;
  for (let k = 0; k < 5; k++) {
    const v = board[idx(x + dx * (start + k), y + dy * (start + k))];
    if (v === 1) black++;
    else if (v === 2) white++;
  }
  const beforeX = x + dx * (start - 1);
  const beforeY = y + dy * (start - 1);
  const afterX = x + dx * (start + 5);
  const afterY = y + dy * (start + 5);
  const openEnds =
    (inBounds(beforeX, beforeY) && board[idx(beforeX, beforeY)] === 0 ? 1 : 0) +
    (inBounds(afterX, afterY) && board[idx(afterX, afterY)] === 0 ? 1 : 0);
  return windowScore(black, white, openEnds);
}

/** Full-board score. Used once per turn to seed the incremental value. */
export function evaluateBoard(board: Board): number {
  let total = 0;
  for (const [dxRaw, dyRaw] of DIRS) {
    const dx = dxRaw as number;
    const dy = dyRaw as number;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        // Start only where the line begins, so each window is counted once.
        if (inBounds(x - dx, y - dy)) continue;
        for (let start = 0; ; start++) {
          if (!inBounds(x + dx * (start + 4), y + dy * (start + 4))) break;
          total += scoreWindow(board, x, y, dx, dy, start);
        }
      }
    }
  }
  return total;
}

/**
 * Score of every window passing through (x,y). Placing or lifting a stone can
 * only change these windows, so the search keeps a running total by
 * subtracting this before a placement and adding it back after — two cheap
 * calls instead of a full-board sweep per node.
 */
export function localScore(board: Board, x: number, y: number): number {
  let total = 0;
  for (const [dxRaw, dyRaw] of DIRS) {
    const dx = dxRaw as number;
    const dy = dyRaw as number;
    for (let offset = -4; offset <= 0; offset++) {
      const startX = x + dx * offset;
      const startY = y + dy * offset;
      const endX = x + dx * (offset + 4);
      const endY = y + dy * (offset + 4);
      if (!inBounds(startX, startY) || !inBounds(endX, endY)) continue;
      total += scoreWindow(board, startX, startY, dx, dy, 0);
    }
  }
  return total;
}

export const perspective = (player: Player): number => (player === 1 ? 1 : -1);
