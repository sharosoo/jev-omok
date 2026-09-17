import type { Coord, Player, RuleSet } from "@/game/protocol";
import { WIN_SCORE, evaluateBoard, localScore } from "./evaluate";
import { DIRS, idx, inBounds, makesFive } from "./patterns";
import { isForbidden } from "./rules";
import type { Board, PointAnalysis } from "./types";

const DEFAULT_BUDGET_MS = 5;

export interface SearchedMove {
  readonly coord: Coord;
  readonly score: number;
  readonly point: PointAnalysis;
}

export interface SearchResult {
  readonly moves: readonly SearchedMove[];
  readonly nodes: number;
  readonly depth: number;
  /** True when the node ceiling cut the search short. */
  readonly truncated: boolean;
}

export interface SearchLimits {
  readonly depth: number;
  readonly rootWidth: number;
  readonly innerWidth: number;
  readonly nodeLimit: number;
  /**
   * Wall-clock ceiling in milliseconds. A node cap is not enough on its own:
   * per-node cost grows with the board, and the whole request has 10 ms of CPU
   * on the free plan. Production hit `exceededResources` before this existed.
   */
  readonly budgetMs?: number;
}

interface Frame {
  nodes: number;
  readonly limit: number;
  readonly deadline: number;
  truncated: boolean;
}

/**
 * Points on the four lines through (x,y) where `player` would complete five.
 * A four can only be created by the stone just played, so scanning those lines
 * is enough to find every reply the opponent is forced to consider.
 */
function completionPoints(board: Board, x: number, y: number, player: Player): Coord[] {
  const out: Coord[] = [];
  for (const [dxRaw, dyRaw] of DIRS) {
    const dx = dxRaw as number;
    const dy = dyRaw as number;
    for (let k = -4; k <= 4; k++) {
      if (k === 0) continue;
      const px = x + dx * k;
      const py = y + dy * k;
      if (!inBounds(px, py) || board[idx(px, py)] !== 0) continue;
      const cell = idx(px, py);
      board[cell] = player;
      const five = makesFive(board, px, py, dx, dy, player);
      board[cell] = 0;
      if (five && !out.some((c) => c.x === px && c.y === py)) out.push({ x: px, y: py });
    }
  }
  return out;
}

/** Root-pool points that complete five for `player` right now. */
function winningPoints(board: Board, player: Player, pool: readonly Coord[]): Coord[] {
  const out: Coord[] = [];
  for (const c of pool) {
    const cell = idx(c.x, c.y);
    if (board[cell] !== 0) continue;
    board[cell] = player;
    const five =
      makesFive(board, c.x, c.y, 1, 0, player) ||
      makesFive(board, c.x, c.y, 0, 1, player) ||
      makesFive(board, c.x, c.y, 1, 1, player) ||
      makesFive(board, c.x, c.y, 1, -1, player);
    board[cell] = 0;
    if (five) out.push(c);
  }
  return out;
}

/**
 * Negamax with alpha-beta over the candidate set computed at the root.
 *
 * Two decisions keep this inside a Worker's CPU budget, both measured:
 * re-running the full candidate analysis at every node cost 0.59 ms per node
 * and made depth 6 take 1.4 s, so the tree reuses the root's ordered candidate
 * list and only adds forced replies; and the position value is carried
 * incrementally, since placing a stone can only change the windows through it.
 * Per-node cost is a pair of `localScore` calls plus a terminal test.
 *
 * Gomoku tolerates hard width pruning: a move that neither makes nor answers a
 * shape is essentially never best, and the root order already puts threats
 * first.
 */
function negamax(
  board: Board,
  me: Player,
  rule: RuleSet,
  depth: number,
  alpha: number,
  beta: number,
  absScore: number,
  rootPool: readonly Coord[],
  forced: readonly Coord[],
  limits: SearchLimits,
  frame: Frame,
): number {
  frame.nodes++;
  // The clock is only read every 64th node, so Date.now() stays off the hot path.
  const outOfTime = (frame.nodes & 63) === 0 && Date.now() > frame.deadline;
  if (frame.nodes >= frame.limit || outOfTime) {
    frame.truncated = true;
    return me === 1 ? absScore : -absScore;
  }
  if (depth <= 0) return me === 1 ? absScore : -absScore;

  const opponent: Player = me === 1 ? 2 : 1;
  /*
   * A non-empty `forced` set means the opponent just made a four, so the only
   * moves worth searching are the covering points — plus any point that wins
   * outright for us, because completing five beats answering a four. Omitting
   * those counter-wins made the search score winnable positions as losses, and
   * the error compounded with depth: at depth 8 the engine went 0-4 against a
   * baseline it beat 3-0 at depth 6.
   */
  const pool =
    forced.length > 0
      ? [...winningPoints(board, me, rootPool), ...forced]
      : rootPool.filter((c) => board[idx(c.x, c.y)] === 0).slice(0, limits.innerWidth);
  if (pool.length === 0) return me === 1 ? absScore : -absScore;

  let best = -Infinity;
  for (const move of pool) {
    // Unwind immediately once the ceiling trips, so the overshoot is bounded by
    // the depth rather than by the width of every level still on the stack.
    if (frame.truncated) break;
    const cell = idx(move.x, move.y);
    if (board[cell] !== 0) continue;
    if (isForbidden(board, move.x, move.y, me, rule)) continue;

    const before = localScore(board, move.x, move.y);
    board[cell] = me;
    const after = localScore(board, move.x, move.y);
    const nextAbs = absScore - before + after;

    let value: number;
    if (
      makesFive(board, move.x, move.y, 1, 0, me) ||
      makesFive(board, move.x, move.y, 0, 1, me) ||
      makesFive(board, move.x, move.y, 1, 1, me) ||
      makesFive(board, move.x, move.y, 1, -1, me)
    ) {
      value = WIN_SCORE + depth;
    } else {
      const replies = completionPoints(board, move.x, move.y, me);
      value = -negamax(
        board,
        opponent,
        rule,
        depth - 1,
        -beta,
        -Math.max(alpha, best),
        nextAbs,
        rootPool,
        // Two completion points is an open four: the opponent cannot cover both,
        // so it is already a win and there is nothing to search.
        replies.length > 1 ? [] : replies,
        limits,
        frame,
      );
      if (replies.length > 1) value = WIN_SCORE + depth - 1;
    }

    board[cell] = 0;
    if (value > best) best = value;
    if (best >= beta) break;
  }

  return best === -Infinity ? (me === 1 ? absScore : -absScore) : best;
}

export function searchMoves(
  board: Board,
  me: Player,
  rule: RuleSet,
  candidates: readonly PointAnalysis[],
  limits: SearchLimits,
): SearchResult {
  const frame: Frame = {
    nodes: 0,
    limit: limits.nodeLimit,
    deadline: Date.now() + (limits.budgetMs ?? DEFAULT_BUDGET_MS),
    truncated: false,
  };
  const opponent: Player = me === 1 ? 2 : 1;
  const rootPool = candidates.map((c) => c.coord);
  const absScore = evaluateBoard(board);
  const scored: SearchedMove[] = [];

  let alpha = -Infinity;
  for (const candidate of candidates.slice(0, limits.rootWidth)) {
    const { x, y } = candidate.coord;
    const cell = idx(x, y);
    if (board[cell] !== 0) continue;
    // Once the ceiling is hit the remaining roots would be scored by a static
    // evaluation and would outrank properly searched moves, so stop instead.
    if (frame.truncated) break;

    const before = localScore(board, x, y);
    board[cell] = me;
    const after = localScore(board, x, y);
    const nextAbs = absScore - before + after;

    let score: number;
    if (
      makesFive(board, x, y, 1, 0, me) ||
      makesFive(board, x, y, 0, 1, me) ||
      makesFive(board, x, y, 1, 1, me) ||
      makesFive(board, x, y, 1, -1, me)
    ) {
      score = WIN_SCORE + limits.depth;
    } else {
      const replies = completionPoints(board, x, y, me);
      score =
        replies.length > 1
          ? WIN_SCORE + limits.depth - 1
          : -negamax(
              board,
              opponent,
              rule,
              limits.depth - 1,
              -Infinity,
              -alpha,
              nextAbs,
              rootPool,
              replies,
              limits,
              frame,
            );
    }
    board[cell] = 0;

    scored.push({ coord: candidate.coord, score, point: candidate });
    if (score > alpha) alpha = score;
  }

  scored.sort((a, b) => b.score - a.score);
  return { moves: scored, nodes: frame.nodes, depth: limits.depth, truncated: frame.truncated };
}

/**
 * Moves the search rates within `margin` of the best. A margin in evaluation
 * units rather than a fixed count leaves a single clearly-best move alone in
 * the set, while an open position still offers the judgment layer real choices.
 *
 * Mate scores are compared exactly. They are only a few points apart — a win
 * now versus a win three plies later — so any evaluation-sized margin would
 * call them equal and let the style pick delay a win it already had.
 */
export function nearBest(
  result: SearchResult,
  margin: number,
  max: number,
): readonly SearchedMove[] {
  const top = result.moves[0];
  if (!top) return [];
  const decided = Math.abs(top.score) >= WIN_SCORE;
  const cut = decided ? top.score : top.score - margin;
  return result.moves.filter((m) => m.score >= cut).slice(0, max);
}
