import { Hono } from "hono";
import type { Coord, MoveRequest, MoveResponse, RuleSet } from "@/game/protocol";
import { BOARD_SIZE } from "@/game/protocol";
import type { Difficulty, Player } from "@/game/protocol";
import { decideMove } from "@/engine/decide";
import { findVcf } from "@/engine/vcf";
import { boardFromMoves, nextPlayer, statusAfter, validateMoves } from "@/engine/rules";
import { idx } from "@/engine/patterns";
import { AI_LINES } from "@/lib/lines";
import { isRecord } from "@/lib/guards";
import { PROFILES } from "@/engine/difficulty";

interface Env {
  readonly ASSETS: Fetcher;
  readonly TYPESAFE_API_KEY?: string;
  readonly JEV_MODEL?: string;
  readonly JEV_BASE_URL?: string;
}

const RULES: readonly RuleSet[] = ["freestyle", "double_three_ban"];
const JEV_TIMEOUT_MS = 6_000;

/** Parses the wire request without trusting any field. */
function parseRequest(
  body: unknown,
): { ok: true; value: MoveRequest } | { ok: false; reason: string } {
  if (!isRecord(body)) return { ok: false, reason: "body must be an object" };

  const rawMoves = body.moves;
  if (!Array.isArray(rawMoves)) return { ok: false, reason: "moves must be an array" };
  if (rawMoves.length > BOARD_SIZE * BOARD_SIZE) return { ok: false, reason: "too many moves" };

  const moves: Coord[] = [];
  for (const entry of rawMoves) {
    if (!isRecord(entry) || typeof entry.x !== "number" || typeof entry.y !== "number") {
      return { ok: false, reason: "each move needs numeric x and y" };
    }
    moves.push({ x: entry.x, y: entry.y });
  }

  const rule = RULES.find((r) => r === body.rule);
  if (!rule) return { ok: false, reason: "unknown rule" };

  const difficulty = (Object.keys(PROFILES) as Difficulty[]).find((d) => d === body.difficulty);
  if (!difficulty) return { ok: false, reason: "unknown difficulty" };

  const seed = typeof body.seed === "number" && Number.isFinite(body.seed) ? body.seed : undefined;
  return { ok: true, value: { moves, rule, difficulty, ...(seed === undefined ? {} : { seed }) } };
}

const app = new Hono<{ Bindings: Env }>();

app.post("/api/move", async (c) => {
  const started = Date.now();

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const parsed = parseRequest(raw);
  if (!parsed.ok) return c.json({ error: "invalid_request", detail: parsed.reason }, 400);

  const request = parsed.value;
  const history = validateMoves(request.moves);
  if (!history.ok) return c.json({ error: "invalid_history", detail: history.reason }, 400);

  const board = boardFromMoves(request.moves);
  const lastMove = request.moves.length > 0 ? (request.moves.at(-1) as Coord) : null;
  const statusBefore = statusAfter(board, lastMove);

  // The human's move may already have ended the game; answering with a stone
  // would corrupt the record, so the AI declines and only reports the result.
  if (statusBefore.winner !== 0 || statusBefore.boardFull) {
    const lineId = statusBefore.winner === 1 ? "human_wins" : "draw";
    const variants = AI_LINES[lineId];
    const body: MoveResponse = {
      move: null,
      source: "engine_fallback",
      reason: statusBefore.winner === 1 ? "human already won" : "board is full",
      confidence: null,
      danger: null,
      line: { id: lineId, text: variants[0] as string },
      status: statusBefore,
      latencyMs: Date.now() - started,
    };
    return c.json(body);
  }

  const me: Player = nextPlayer(request.moves);
  const apiKey = c.env.TYPESAFE_API_KEY;

  const decision = await decideMove({
    board,
    moves: request.moves,
    me,
    rule: request.rule,
    difficulty: request.difficulty,
    seed: request.seed ?? (Math.random() * 2 ** 32) >>> 0,
    vcf: (b, player, rule, depth) => findVcf(b, player, rule, depth)?.move ?? null,
    ...(apiKey
      ? {
          jev: {
            apiKey,
            baseUrl: c.env.JEV_BASE_URL ?? "https://api.typesafe.ai",
            model: c.env.JEV_MODEL ?? "jev-latest",
            timeoutMs: JEV_TIMEOUT_MS,
          },
        }
      : {}),
  });

  const cell = idx(decision.move.x, decision.move.y);
  if (board[cell] !== 0) {
    return c.json({ error: "engine_error", detail: "chose an occupied point" }, 500);
  }
  board[cell] = me;

  const status = statusAfter(board, decision.move);
  const lineId = status.winner === me ? "ai_wins" : decision.lineId;
  const variants = AI_LINES[lineId];
  const text = variants[Math.floor(Math.random() * variants.length)] ?? (variants[0] as string);

  const body: MoveResponse = {
    move: decision.move,
    source: decision.source,
    reason: decision.reason,
    confidence: decision.confidence,
    danger: decision.danger,
    line: { id: lineId, text },
    status,
    latencyMs: Date.now() - started,
  };
  return c.json(body);
});

app.get("/api/health", (c) =>
  c.json({ ok: true, jev: Boolean(c.env.TYPESAFE_API_KEY), board: BOARD_SIZE }),
);

/*
 * `run_worker_first` is scoped to /api/* in wrangler.jsonc, so static requests
 * never reach the Worker in production. This catch-all keeps `wrangler dev`
 * serving the exported site when it is run without the Next dev server.
 */
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
