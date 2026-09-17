import type { Coord, Player, RuleSet } from "@/game/protocol";
import { N, idx, inBounds, isFork, reportAt } from "./patterns";
import { isForbidden } from "./rules";
import type { Board, PointAnalysis, Shape } from "./types";

/**
 * Static shape weights. The gaps are wide on purpose: a four must always outrank
 * any number of threes so move ordering never buries a forcing move, and the
 * quiet `potential` term can only break ties between shapeless moves.
 */
const WEIGHT: Record<Shape, number> = {
  five: 1_000_000,
  openFour: 100_000,
  four: 10_000,
  openThree: 8_000,
  closedThree: 1_000,
  none: 0,
};

/** Own threats count slightly more than the opponent's, which buys initiative. */
const OFFENSE_BIAS = 1.1;

const shapeValue = (counts: Readonly<Record<Shape, number>>): number =>
  counts.five * WEIGHT.five +
  counts.openFour * WEIGHT.openFour +
  counts.four * WEIGHT.four +
  counts.openThree * WEIGHT.openThree +
  counts.closedThree * WEIGHT.closedThree;

const centerBonus = (x: number, y: number): number =>
  20 - 2 * Math.max(Math.abs(x - 7), Math.abs(y - 7));

/**
 * Empty points within Chebyshev distance 2 of a stone. A radius of 2 is what
 * competitive engines use: it keeps the set at roughly 20-40 points in the
 * midgame while still containing the flanking answers to a split three.
 */
export function neighbourhood(board: Board, radius = 2): Coord[] {
  const out: Coord[] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (board[idx(x, y)] !== 0) continue;
      let near = false;
      for (let dy = -radius; dy <= radius && !near; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inBounds(nx, ny)) continue;
          if (board[idx(nx, ny)] !== 0) {
            near = true;
            break;
          }
        }
      }
      if (near) out.push({ x, y });
    }
  }
  return out;
}

/**
 * Scores every neighbourhood point from `me`'s perspective, best first. The
 * defensive report doubles as "what this point denies the opponent", which is
 * also what the Jev annotation shows the model.
 */
export function analyzePoints(board: Board, me: Player, rule: RuleSet): PointAnalysis[] {
  const opponent: Player = me === 1 ? 2 : 1;
  const points = neighbourhood(board);
  const analyzed = points.map((coord) => {
    const offense = reportAt(board, coord.x, coord.y, me);
    const defense = reportAt(board, coord.x, coord.y, opponent);
    const forbidden = isForbidden(board, coord.x, coord.y, me, rule);
    const score =
      OFFENSE_BIAS * shapeValue(offense.counts) +
      shapeValue(defense.counts) +
      (isFork(offense.counts) ? WEIGHT.openFour : 0) +
      (isFork(defense.counts) ? WEIGHT.four : 0) +
      offense.potential * 6 +
      defense.potential * 2 +
      centerBonus(coord.x, coord.y);
    return { coord, offense, defense, score, forbidden };
  });

  // A forbidden point is unplayable, so it must never win move ordering; it is
  // kept in the list because the caller still needs it for the UI overlay.
  return analyzed.sort((a, b) => {
    if (a.forbidden !== b.forbidden) return a.forbidden ? 1 : -1;
    return b.score - a.score;
  });
}

export const playable = (points: readonly PointAnalysis[]): PointAnalysis[] =>
  points.filter((p) => !p.forbidden);
