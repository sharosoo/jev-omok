import type { Coord, Player, RuleSet } from "@/game/protocol";
import { idx, reportAt } from "./patterns";
import { isForbidden } from "./rules";
import type { Board } from "./types";
import { analyzePoints } from "./candidates";

export interface VcfResult {
  /** The move that starts the forced win. */
  readonly move: Coord;
  /** Full forcing sequence, own moves and forced replies interleaved. */
  readonly line: readonly Coord[];
  readonly nodes: number;
}

const MAX_BRANCH = 8;

/**
 * Victory by continuous four: the attacker only ever plays moves that make a
 * four or better, so the defender has exactly one legal reply each ply. That
 * keeps the branching factor near 1 on the defender's side, which is why this
 * search can run deep for a few hundred nodes instead of thousands.
 *
 * `depth` counts attacker moves, not plies. Returns null when no forced win is
 * found within the budget — never a guess.
 */
export function findVcf(
  board: Board,
  me: Player,
  rule: RuleSet,
  depth: number,
  budget = { nodes: 0, limit: 20_000 },
): VcfResult | null {
  if (depth <= 0 || budget.nodes >= budget.limit) return null;
  const opponent: Player = me === 1 ? 2 : 1;
  const points = analyzePoints(board, me, rule).filter((p) => !p.forbidden);

  const winning = points.find((p) => p.offense.counts.five > 0);
  if (winning) {
    return { move: winning.coord, line: [winning.coord], nodes: budget.nodes };
  }

  const forcing = points
    .filter((p) => p.offense.counts.openFour > 0 || p.offense.counts.four > 0)
    .slice(0, MAX_BRANCH);

  for (const attack of forcing) {
    budget.nodes++;
    if (budget.nodes >= budget.limit) return null;

    const attackCell = idx(attack.coord.x, attack.coord.y);
    board[attackCell] = me;

    // Where the attacker would complete five next; these are the points the
    // defender must cover. Two or more means the four was open and unanswerable.
    const mustCover = analyzePoints(board, opponent, rule).filter(
      (p) => p.defense.counts.five > 0,
    );

    if (mustCover.length > 1) {
      board[attackCell] = 0;
      return { move: attack.coord, line: [attack.coord], nodes: budget.nodes };
    }

    const reply = mustCover[0];
    if (reply) {
      const replyCell = idx(reply.coord.x, reply.coord.y);
      const replyLegal = !isForbidden(board, reply.coord.x, reply.coord.y, opponent, rule);
      board[replyCell] = opponent;

      // A block that also completes five for the defender refutes the whole line.
      const defenderWins =
        reportAt(board, reply.coord.x, reply.coord.y, opponent).counts.five > 0;
      const counterFive = analyzePoints(board, opponent, rule).some(
        (p) => p.offense.counts.five > 0,
      );

      if (!replyLegal) {
        // The only defence is illegal under the active rule, so the four wins.
        board[replyCell] = 0;
        board[attackCell] = 0;
        return { move: attack.coord, line: [attack.coord], nodes: budget.nodes };
      }

      const deeper =
        defenderWins || counterFive ? null : findVcf(board, me, rule, depth - 1, budget);

      board[replyCell] = 0;
      board[attackCell] = 0;

      if (deeper) {
        return {
          move: attack.coord,
          line: [attack.coord, reply.coord, ...deeper.line],
          nodes: budget.nodes,
        };
      }
      continue;
    }

    board[attackCell] = 0;
  }

  return null;
}
