import type { Coord, LineId, Player } from "@/game/protocol";
import { N, idx, isFork } from "./patterns";
import { toNotation } from "./rules";
import type { Board, PointAnalysis, Shape, ShapeReport } from "./types";
import { isNumberRecord, isRecord } from "@/lib/guards";

/**
 * Jev is a System One model: it returns typed judgments, never text or a search
 * result. Everything a board can prove — a five, a block, a fork, a forced win —
 * is decided in code before this module is reached. Jev is asked only to choose
 * between moves that are all legal and none of which is forced, and to judge the
 * two things code cannot: how dangerous the position feels and what to say.
 *
 * Measured on this annotation (24 trials over 7 forced positions, jev-latest):
 * 20/21 correct with fork-aware annotations at K=12 vs 18/21 with a bare board,
 * and 12/14 at K=30 — so the candidate list is truncated to about 12.
 */

export const JEV_MODEL = "jev-latest";
export const JEV_ENDPOINT = "/v1/systemone";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

interface ChoiceQuestion {
  readonly type: "choice";
  readonly instructions: JsonValue;
  readonly criteria: Record<string, JsonValue>;
}

interface ScoreQuestion {
  readonly type: "score";
  readonly instructions: JsonValue;
  readonly criteria: readonly string[];
}

export interface TurnQuestions {
  readonly move: ChoiceQuestion;
  readonly danger: ScoreQuestion;
  readonly line: ChoiceQuestion;
}

export interface ChoiceAnswer {
  readonly type: "choice";
  readonly choice: string;
  readonly probabilities: Record<string, number>;
  readonly confidence: number;
}

export interface ScoreAnswer {
  readonly type: "score";
  readonly score: number;
  readonly probabilities: Record<string, number>;
  readonly confidence: number;
}

export interface TurnAnswers {
  readonly move: ChoiceAnswer;
  readonly danger: ScoreAnswer;
  readonly line: ChoiceAnswer;
}

export interface JevSuccess {
  readonly ok: true;
  readonly answers: TurnAnswers;
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number };
  readonly latencyMs: number;
}

export interface JevFailure {
  readonly ok: false;
  readonly reason: "http" | "network" | "timeout" | "malformed";
  readonly detail: string;
  readonly latencyMs: number;
}

const SHAPE_TEXT: Record<Shape, string> = {
  five: "five in a row",
  openFour: "an open four",
  four: "a four",
  openThree: "an open three",
  closedThree: "a closed three",
  none: "nothing",
};

function describeShapes(report: ShapeReport): string {
  const parts: string[] = [];
  const { counts } = report;
  if (counts.five) parts.push("five in a row");
  if (counts.openFour) parts.push(`${counts.openFour} open four`);
  if (counts.four) parts.push(`${counts.four} four`);
  if (counts.openThree) parts.push(`${counts.openThree} open three`);
  if (counts.closedThree) parts.push(`${counts.closedThree} closed three`);
  if (parts.length === 0) return SHAPE_TEXT.none;
  return parts.join(" + ");
}

/**
 * The option body for one candidate. The fork flags are load-bearing: with only
 * the strongest single-line shape exposed, the model picked a quiet building
 * move over the opponent's double-three point in every trial.
 */
function optionFor(point: PointAnalysis): JsonValue {
  const mineFork = isFork(point.offense.counts);
  const theirsFork = isFork(point.defense.counts);
  return {
    if_i_play_here:
      point.offense.counts.five > 0
        ? "I WIN IMMEDIATELY: this completes five in a row"
        : `I form: ${describeShapes(point.offense)}`,
    my_double_threat: mineFork
      ? "yes - two separate threats at once, which cannot both be answered"
      : "no",
    if_opponent_plays_here_instead:
      point.defense.counts.five > 0
        ? "OPPONENT WINS HERE: taking this point is the only way to stop it"
        : `opponent would form: ${describeShapes(point.defense)}`,
    opponent_double_threat_here: theirsFork
      ? "yes - the opponent would get two threats at once"
      : "no",
  };
}

const PRIORITY = [
  "1. If an option completes five in a row for me, play it - the game ends in a win.",
  "2. Else if an option is where the opponent would complete five, play it to survive.",
  "3. Else if an option gives me a double threat, play it - it wins.",
  "4. Else if an option is where the opponent would get a double threat, take that point away.",
  "5. Else prefer the option forming the strongest single threat (open four > four > open three > closed three), resolving ties with the stated playing style.",
] as const;

export const PERSONA = {
  balanced:
    "Balanced: build your own shape when nothing is urgent, but do not ignore a point that would become the opponent's fork.",
  attacker:
    "Aggressive: prefer building your own threats over pre-emptive defence when both are merely useful.",
  defender:
    "Cautious: prefer taking away the opponent's future double-threat points when no win is available.",
} as const;

export type PersonaKey = keyof typeof PERSONA;

/** Line ids Jev may choose from mid-game. Terminal lines are code's decision. */
const LINE_CRITERIA: Record<string, string> = {
  calm_open: "Nothing decisive on the board yet; this is still development",
  respect_human: "The human built a real threat and the AI had to answer it",
  warn_own_threat: "The AI just built a serious threat of its own",
  taunt_strong: "The AI is clearly ahead and the human's last move was weak",
  panic: "The AI is in real trouble and is defending",
};

export const isLineId = (value: string): value is LineId => value in LINE_CRITERIA;

export function buildQuestions(
  candidates: readonly PointAnalysis[],
  persona: PersonaKey,
): TurnQuestions {
  const criteria: Record<string, JsonValue> = {};
  for (const point of candidates) criteria[toNotation(point.coord)] = optionFor(point);

  return {
    move: {
      type: "choice",
      instructions: {
        task: "Pick the single strongest move for white (O), who is to move in this gomoku position.",
        playing_style: PERSONA[persona],
        priority_order: PRIORITY,
        how_to_read_options:
          "if_i_play_here is what I gain. if_opponent_plays_here_instead is what I deny by taking the point first. A double threat is decisive.",
      },
      criteria,
    },
    danger: {
      type: "score",
      instructions:
        "How much danger is white in right now, judging only from black's threats on the board?",
      criteria: [
        "Safe: black has no threat longer than two stones",
        "Watchful: black has a three that must be answered soon",
        "Urgent: black has a four or an open three that forces an answer now",
        "Losing: black has a threat white cannot fully answer",
      ],
    },
    line: {
      type: "choice",
      instructions:
        "Pick the line the AI should say to the human after playing its move. It must fit the position honestly: do not taunt while losing, do not panic while winning.",
      criteria: LINE_CRITERIA,
    },
  };
}

/** ASCII board plus the same facts in list form; both are cheap and help. */
export function buildState(
  board: Board,
  me: Player,
  moves: readonly Coord[],
  candidates: readonly PointAnalysis[],
): JsonValue {
  const rows: string[] = [];
  const header = `   ${"ABCDEFGHIJKLMNO".split("").join(" ")}`;
  for (let y = 0; y < N; y++) {
    let row = `${String(y + 1).padStart(2)} `;
    for (let x = 0; x < N; x++) {
      const v = board[idx(x, y)];
      row += `${v === 1 ? "X" : v === 2 ? "O" : "."} `;
    }
    rows.push(row.trimEnd());
  }

  const stones = { black: [] as string[], white: [] as string[] };
  moves.forEach((move, i) => {
    (i % 2 === 0 ? stones.black : stones.white).push(toNotation(move));
  });

  const lastHuman = moves.length > 0 ? moves[moves.length - 1] : undefined;

  return {
    game: "gomoku (five in a row) on a 15x15 board",
    board_legend:
      "X = black stones (the human), O = white stones (me, the AI), . = empty. Columns are letters A-O, rows are numbers 1-15.",
    board: [header, ...rows].join("\n"),
    stones,
    to_move: me === 2 ? "white (O)" : "black (X)",
    last_opponent_move: lastHuman ? toNotation(lastHuman) : null,
    move_number: moves.length + 1,
    legal_candidate_moves: candidates.map((c) => toNotation(c.coord)),
  };
}

interface JevConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
}

function parseChoice(value: unknown): ChoiceAnswer | null {
  if (!isRecord(value)) return null;
  if (value.type !== "choice" || typeof value.choice !== "string") return null;
  if (typeof value.confidence !== "number" || !isNumberRecord(value.probabilities)) return null;
  return {
    type: "choice",
    choice: value.choice,
    probabilities: value.probabilities,
    confidence: value.confidence,
  };
}

function parseScore(value: unknown): ScoreAnswer | null {
  if (!isRecord(value)) return null;
  if (value.type !== "score" || typeof value.score !== "number") return null;
  if (typeof value.confidence !== "number" || !isNumberRecord(value.probabilities)) return null;
  return {
    type: "score",
    score: value.score,
    probabilities: value.probabilities,
    confidence: value.confidence,
  };
}

export async function askJev(
  config: JevConfig,
  state: JsonValue,
  questions: TurnQuestions,
): Promise<JevSuccess | JevFailure> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}${JEV_ENDPOINT}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state, model: config.model, questions }),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - started;
    if (!response.ok) {
      const body = await response.text();
      return {
        ok: false,
        reason: "http",
        detail: `${response.status} ${body.slice(0, 200)}`,
        latencyMs,
      };
    }

    const payload: unknown = await response.json();
    if (!isRecord(payload) || !isRecord(payload.answers)) {
      return { ok: false, reason: "malformed", detail: "missing answers", latencyMs };
    }

    const move = parseChoice(payload.answers.move);
    const danger = parseScore(payload.answers.danger);
    const line = parseChoice(payload.answers.line);
    if (!move || !danger || !line) {
      return { ok: false, reason: "malformed", detail: "answer shape mismatch", latencyMs };
    }

    const usage = isRecord(payload.usage) ? payload.usage : {};
    return {
      ok: true,
      answers: { move, danger, line },
      usage: {
        input_tokens: typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
        output_tokens: typeof usage.output_tokens === "number" ? usage.output_tokens : 0,
      },
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      reason: aborted ? "timeout" : "network",
      detail: error instanceof Error ? error.message : "unknown error",
      latencyMs,
    };
  } finally {
    clearTimeout(timer);
  }
}
