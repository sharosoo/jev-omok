import type { Coord, Difficulty, LineId, MoveSource, Player, RuleSet } from "@/game/protocol";
import { analyzePoints, playable } from "./candidates";
import { PROFILES, rng, sampleIndex } from "./difficulty";
import { askJev, buildQuestions, buildState, isLineId, type PersonaKey } from "./jev";
import { idx, isFork } from "./patterns";
import { fromNotation, toNotation } from "./rules";
import type { Board, DifficultyProfile, PointAnalysis } from "./types";

export interface Decision {
  readonly move: Coord;
  readonly source: MoveSource;
  readonly reason: string;
  readonly confidence: number | null;
  readonly danger: number | null;
  readonly lineId: LineId;
}

export interface DecideOptions {
  readonly board: Board;
  readonly moves: readonly Coord[];
  readonly me: Player;
  readonly rule: RuleSet;
  readonly difficulty: Difficulty;
  readonly seed: number;
  readonly persona?: PersonaKey;
  /** Omit to skip the Jev call entirely, e.g. when no key is configured. */
  readonly jev?: {
    readonly apiKey: string;
    readonly baseUrl: string;
    readonly model: string;
    readonly timeoutMs: number;
  };
  readonly vcf: (board: Board, me: Player, rule: RuleSet, depth: number) => Coord | null;
}

/**
 * Opening replies. Anything past white's second stone is ordinary play, so the
 * book stops there instead of pretending to know the 26 Renju openings.
 */
function openingMove(board: Board, moves: readonly Coord[], next: () => number): Coord | null {
  if (moves.length === 0) return { x: 7, y: 7 };
  if (moves.length !== 1) return null;

  const first = moves[0];
  if (!first) return null;
  // Taking the centre is the strongest answer whenever black did not.
  if (board[7 * 15 + 7] === 0) return { x: 7, y: 7 };

  // Black opened on the centre: answer adjacent. The diagonal (indirect) and
  // orthogonal (direct) replies split the opening tree; pick one at random so
  // repeated games do not start identically.
  const diagonal = next() < 0.5;
  const dx = next() < 0.5 ? -1 : 1;
  const dy = next() < 0.5 ? -1 : 1;
  return diagonal ? { x: first.x + dx, y: first.y + dy } : { x: first.x + dx, y: first.y };
}

/** Danger from the board alone, on the same 0-3 scale as Jev's Score question. */
function computeDanger(points: readonly PointAnalysis[]): number {
  let danger = 0;
  for (const point of points) {
    if (point.defense.counts.five > 0) danger = Math.max(danger, 3);
    else if (point.defense.counts.openFour > 0) danger = Math.max(danger, 3);
    else if (isFork(point.defense.counts)) danger = Math.max(danger, 2.5);
    else if (point.defense.counts.four > 0) danger = Math.max(danger, 2);
    else if (point.defense.counts.openThree > 0) danger = Math.max(danger, 1.5);
    else if (point.defense.counts.closedThree > 0) danger = Math.max(danger, 0.5);
  }
  return danger;
}

const lineForDanger = (danger: number, attacking: boolean): LineId => {
  if (danger >= 2.5) return "panic";
  if (danger >= 1.5) return "respect_human";
  if (attacking) return "warn_own_threat";
  return "calm_open";
};

interface Forced {
  readonly point: PointAnalysis;
  readonly source: MoveSource;
  readonly reason: string;
  readonly lineId: LineId;
}

/**
 * The forced ladder, ordered by how fast each threat resolves. Two orderings
 * matter and are easy to get wrong:
 *
 * - Own five and own open four come before any block: if the AI wins this move,
 *   the opponent's four never gets played.
 * - The opponent's four is blocked before the AI's own fork, because a fork wins
 *   in two moves and a four wins in one.
 *
 * A pure ladder without the VCF probe plays a purely reactive game: every turn
 * answers a threat and the AI never attacks. That was measured on a 61-ply
 * self-play game before `findVcf` was added.
 */
function forcedMove(
  points: readonly PointAnalysis[],
  profile: DifficultyProfile,
  next: () => number,
): Forced | null {
  const find = (predicate: (p: PointAnalysis) => boolean) => points.find(predicate);

  const ownFive = find((p) => p.offense.counts.five > 0);
  if (ownFive && next() < profile.takeFive) {
    return {
      point: ownFive,
      source: "forced_win",
      reason: "completes five in a row",
      lineId: "ai_wins",
    };
  }

  const theirFive = find((p) => p.defense.counts.five > 0);
  if (theirFive && next() < profile.blockFour) {
    return {
      point: theirFive,
      source: "forced_block",
      reason: "blocks the opponent's five",
      lineId: "panic",
    };
  }

  const ownOpenFour = find((p) => p.offense.counts.openFour > 0);
  if (ownOpenFour && next() < profile.takeFive) {
    return {
      point: ownOpenFour,
      source: "forced_win",
      reason: "creates an unanswerable open four",
      lineId: "warn_own_threat",
    };
  }

  const theirOpenFour = find((p) => p.defense.counts.openFour > 0);
  if (theirOpenFour && next() < profile.blockFour) {
    return {
      point: theirOpenFour,
      source: "forced_block",
      reason: "blocks the opponent's open four",
      lineId: "panic",
    };
  }

  const theirFour = find((p) => p.defense.counts.four > 0);
  if (theirFour && next() < profile.blockFour) {
    return {
      point: theirFour,
      source: "forced_block",
      reason: "blocks the opponent's four",
      lineId: "respect_human",
    };
  }

  const ownFork = find((p) => isFork(p.offense.counts));
  if (ownFork) {
    return {
      point: ownFork,
      source: "forced_win",
      reason: "double threat the opponent cannot answer twice",
      lineId: "warn_own_threat",
    };
  }

  const theirFork = find((p) => isFork(p.defense.counts));
  if (theirFork && next() < profile.blockThree) {
    return {
      point: theirFork,
      source: "forced_block",
      reason: "takes away the opponent's double-threat point",
      lineId: "respect_human",
    };
  }

  return null;
}

/**
 * An open three must be answered, but blocking it is only one of the legal
 * answers: a four of our own forces the opponent to defend first, and a fork
 * ends the game outright. Short-circuiting on the block made the AI purely
 * reactive — measured over an 81-ply game it played 34 blocks and 3 judged
 * moves and never once attacked. So instead of choosing here, narrow the
 * candidate set to moves that actually answer the position and let the
 * judgment layer pick among them.
 */
function answersToThreat(
  points: readonly PointAnalysis[],
  profile: DifficultyProfile,
  next: () => number,
): readonly PointAnalysis[] | null {
  const threatened = points.some((p) => p.defense.counts.openThree > 0);
  if (!threatened) return null;
  if (next() >= profile.blockThree) return null; // this level did not notice

  const answers = points.filter(
    (p) =>
      p.defense.counts.openThree > 0 ||
      isFork(p.defense.counts) ||
      p.offense.counts.four > 0 ||
      p.offense.counts.openFour > 0 ||
      isFork(p.offense.counts),
  );
  return answers.length > 0 ? answers : null;
}

/**
 * Rejects candidates that lose outright. For each candidate the position is
 * played out one ply and the opponent is asked the same tactical questions the
 * AI asks itself: can they complete five, build an open four, fork, or run a
 * forced win by continuous fours? Anything that leaves one of those standing is
 * a losing move no matter how good its shape looks.
 *
 * This is the difference between blocking an open three and blocking it on the
 * end that actually holds. Without it the engine lost half its games to a
 * club-level opponent, always to a five it had already been warned about.
 *
 * Cost is bounded deliberately: only the first `LOOKAHEAD_WIDTH` candidates are
 * checked and the refutation search is shallow, because the whole turn has to
 * fit in a Worker's CPU budget.
 */
const LOOKAHEAD_WIDTH = 8;
const REFUTATION_DEPTH = 2;

function survivingCandidates(
  board: Board,
  me: Player,
  rule: RuleSet,
  pool: readonly PointAnalysis[],
  vcf: DecideOptions["vcf"],
): readonly PointAnalysis[] {
  const opponent: Player = me === 1 ? 2 : 1;
  const safe: PointAnalysis[] = [];
  const width = Math.min(pool.length, LOOKAHEAD_WIDTH);

  for (let i = 0; i < width; i++) {
    const candidate = pool[i] as PointAnalysis;
    const cell = idx(candidate.coord.x, candidate.coord.y);
    board[cell] = me;

    const replies = analyzePoints(board, opponent, rule).filter((p) => !p.forbidden);
    const immediate = replies.some(
      (p) => p.offense.counts.five > 0 || p.offense.counts.openFour > 0 || isFork(p.offense.counts),
    );
    const forced = immediate ? null : vcf(board, opponent, rule, REFUTATION_DEPTH);

    board[cell] = 0;
    if (!immediate && !forced) safe.push(candidate);
  }

  // Every answer loses: the position is already lost, so keep the best-shaped
  // move rather than returning nothing and letting the caller pick blindly.
  return safe.length > 0 ? [...safe, ...pool.slice(width)] : pool;
}

/** Static pick, used for the weakest level and whenever Jev is unavailable. */
function staticPick(
  candidates: readonly PointAnalysis[],
  profile: DifficultyProfile,
  next: () => number,
): PointAnalysis {
  const pool = candidates.slice(0, Math.max(profile.candidateLimit, 1));
  const first = pool[0] as PointAnalysis;
  if (pool.length === 1) return first;

  if (profile.blunderRate > 0 && next() < profile.blunderRate && pool.length > 2) {
    const start = Math.min(2, pool.length - 1);
    const offset = Math.floor(next() * (pool.length - start));
    return pool[start + offset] ?? first;
  }

  const index = sampleIndex(
    pool.map((p) => p.score),
    profile.temperature,
    next,
  );
  return pool[index] ?? first;
}

export async function decideMove(options: DecideOptions): Promise<Decision> {
  const { board, moves, me, rule, difficulty, seed } = options;
  const profile = PROFILES[difficulty];
  const next = rng(seed);

  const book = openingMove(board, moves, next);
  if (book) {
    return {
      move: book,
      source: "opening_book",
      reason: moves.length === 0 ? "opens on the centre" : "standard opening reply",
      confidence: null,
      danger: 0,
      lineId: "calm_open",
    };
  }

  const points = analyzePoints(board, me, rule);
  const legal = playable(points);
  if (legal.length === 0) {
    // Board full or every point forbidden; the caller checks the status first,
    // so this only guards against a malformed request.
    const fallback = points[0]?.coord ?? { x: 7, y: 7 };
    return {
      move: fallback,
      source: "engine_fallback",
      reason: "no legal point available",
      confidence: null,
      danger: null,
      lineId: "calm_open",
    };
  }

  const danger = computeDanger(legal);

  const forced = forcedMove(legal, profile, next);
  if (forced) {
    return {
      move: forced.point.coord,
      source: forced.source,
      reason: forced.reason,
      confidence: null,
      danger,
      lineId: forced.lineId,
    };
  }

  if (profile.vcfDepth > 0) {
    const winning = options.vcf(board, me, rule, profile.vcfDepth);
    if (winning) {
      return {
        move: winning,
        source: "vcf",
        reason: "forced win by continuous fours",
        confidence: null,
        danger,
        lineId: "warn_own_threat",
      };
    }
  }

  // When the opponent has an open three the pool shrinks to real answers, so
  // the judgment layer can still choose between blocking and counter-attacking.
  const answers = answersToThreat(legal, profile, next) ?? legal;

  // Only the levels that are meant to read ahead pay for the refutation search;
  // beginner and easy are supposed to miss things.
  const pool =
    profile.vcfDepth > 0
      ? survivingCandidates(board, me, rule, answers, options.vcf)
      : answers;
  const candidates = pool.slice(0, profile.candidateLimit);

  if (profile.useJev && options.jev) {
    const state = buildState(board, me, moves, candidates);
    const questions = buildQuestions(candidates, options.persona ?? "balanced");
    const result = await askJev(options.jev, state, questions);

    if (result.ok) {
      const { move, danger: dangerAnswer, line } = result.answers;
      const ranked = candidates.map((c) => ({
        point: c,
        weight: move.probabilities[toNotation(c.coord)] ?? 0,
      }));
      const index = sampleIndex(
        ranked.map((r) => r.weight),
        profile.temperature,
        next,
      );
      const sampled = ranked[index]?.point;
      const direct = fromNotation(move.choice);
      const chosen =
        sampled ??
        candidates.find((c) => direct && c.coord.x === direct.x && c.coord.y === direct.y) ??
        (candidates[0] as PointAnalysis);

      return {
        move: chosen.coord,
        source: "jev",
        reason: `judged the position (${move.choice} at confidence ${move.confidence.toFixed(2)})`,
        confidence: move.confidence,
        danger: dangerAnswer.score,
        lineId: isLineId(line.choice) ? line.choice : lineForDanger(dangerAnswer.score, false),
      };
    }

    const pick = staticPick(candidates, profile, next);
    return {
      move: pick.coord,
      source: "engine_fallback",
      reason: `jev unavailable (${result.reason}: ${result.detail})`,
      confidence: null,
      danger,
      lineId: lineForDanger(danger, pick.offense.counts.openThree > 0),
    };
  }

  const pick = staticPick(candidates, profile, next);
  return {
    move: pick.coord,
    source: "engine_fallback",
    reason: profile.useJev ? "no judgment service configured" : "own evaluation",
    confidence: null,
    danger,
    lineId: lineForDanger(danger, pick.offense.counts.openThree > 0),
  };
}
