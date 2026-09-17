import type { Coord, Player, RuleSet } from "@/game/protocol";
import { DIRS, idx, inBounds, makesFive, reportAt } from "./patterns";
import { neighbourhood } from "./candidates";
import type { Board, ShapeReport } from "./types";

export interface VcfResult {
  /** The move that starts the forced win. */
  readonly move: Coord;
  /** Full forcing sequence, own moves and forced replies interleaved. */
  readonly line: readonly Coord[];
  readonly nodes: number;
}

const MAX_BRANCH = 6;
const NODE_LIMIT = 1_200;

/**
 * Wall-clock ceiling for one search. A node cap alone is not enough: the cost
 * of a node depends on how crowded the board is, and a Worker on the free plan
 * gets 10 ms of CPU for the whole request. Production showed 15
 * `exceededResources` failures at a p99 of 514 ms CPU before this existed.
 */
const DEFAULT_BUDGET_MS = 6;

interface Budget {
  nodes: number;
  readonly nodeLimit: number;
  readonly deadline: number;
}

const isForbiddenShape = (report: ShapeReport, rule: RuleSet): boolean =>
  rule === "double_three_ban" &&
  report.counts.openThree >= 2 &&
  report.counts.five === 0 &&
  report.counts.openFour === 0 &&
  report.counts.four === 0;

/**
 * Empty points where `player` creates a four or better, best first.
 *
 * This deliberately avoids `analyzePoints`: that classifies every candidate for
 * both colours and computes potentials, which costs 0.59 ms and is wasted here
 * — a VCF node only cares whether the mover makes a four. `reportAt` on one
 * colour is 0.0026 ms, and the whole generation stays around 0.1 ms.
 */
function forcingMoves(board: Board, player: Player, rule: RuleSet): Coord[] {
  const scored: { coord: Coord; rank: number }[] = [];
  for (const coord of neighbourhood(board, 1)) {
    const report = reportAt(board, coord.x, coord.y, player);
    const { counts } = report;
    if (counts.five > 0) return [coord];
    const rank = counts.openFour * 2 + counts.four;
    if (rank === 0) continue;
    if (isForbiddenShape(report, rule)) continue;
    scored.push({ coord, rank });
  }
  scored.sort((a, b) => b.rank - a.rank);
  return scored.slice(0, MAX_BRANCH).map((entry) => entry.coord);
}

/** Points on the lines through (x,y) where `player` would complete five. */
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

function search(
  board: Board,
  me: Player,
  rule: RuleSet,
  depth: number,
  budget: Budget,
): readonly Coord[] | null {
  if (depth <= 0 || budget.nodes >= budget.nodeLimit || Date.now() > budget.deadline) return null;
  const opponent: Player = me === 1 ? 2 : 1;

  for (const attack of forcingMoves(board, me, rule)) {
    budget.nodes++;
    if (budget.nodes >= budget.nodeLimit || Date.now() > budget.deadline) return null;

    const attackCell = idx(attack.x, attack.y);
    board[attackCell] = me;

    // Five already on the board: the sequence is over.
    if (reportAt(board, attack.x, attack.y, me).counts.five > 0) {
      board[attackCell] = 0;
      return [attack];
    }

    const replies = completionPoints(board, attack.x, attack.y, me);
    if (replies.length > 1) {
      // An open four: the defender cannot cover both completion points.
      board[attackCell] = 0;
      return [attack];
    }

    const reply = replies[0];
    if (reply === undefined) {
      board[attackCell] = 0;
      continue;
    }

    const replyCell = idx(reply.x, reply.y);
    board[replyCell] = opponent;

    // The forced block may itself win, or hand the defender a counter-four that
    // refutes the whole line.
    const defence = reportAt(board, reply.x, reply.y, opponent);
    const defenderWins = defence.counts.five > 0;
    const counterFour = defence.counts.openFour > 0 || defence.counts.four > 0;
    const blockLegal = !isForbiddenShape(defence, rule);

    let line: readonly Coord[] | null = null;
    if (!blockLegal) {
      line = [attack];
    } else if (!defenderWins && !counterFour) {
      const deeper = search(board, me, rule, depth - 1, budget);
      if (deeper) line = [attack, reply, ...deeper];
    }

    board[replyCell] = 0;
    board[attackCell] = 0;
    if (line) return line;
  }

  return null;
}

/**
 * Victory by continuous four: the attacker only plays moves that make a four or
 * better, so the defender has exactly one legal reply each ply. That keeps the
 * defender's branching factor at one, which is why this can look deep for a few
 * hundred nodes.
 *
 * `depth` counts attacker moves, not plies. Returns null when no forced win is
 * found inside the node and time budget — never a guess.
 */
export function findVcf(
  board: Board,
  me: Player,
  rule: RuleSet,
  depth: number,
  budgetMs = DEFAULT_BUDGET_MS,
): VcfResult | null {
  const budget: Budget = {
    nodes: 0,
    nodeLimit: NODE_LIMIT,
    deadline: Date.now() + budgetMs,
  };
  const line = search(board, me, rule, depth, budget);
  if (line === null) return null;
  const first = line[0];
  if (first === undefined) return null;
  return { move: first, line, nodes: budget.nodes };
}
