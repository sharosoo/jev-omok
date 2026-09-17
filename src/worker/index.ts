import { requireAccessToken } from "@sharosoo/auth-client/hono";
import { tokenUserId } from "@sharosoo/auth-client/verify";
import type { AccessTokenClaims } from "@sharosoo/auth-client/verify";
import { Hono } from "hono";
import type { Coord, MoveRequest, MoveResponse, RuleSet } from "@/game/protocol";
import { BOARD_SIZE } from "@/game/protocol";
import type { Difficulty, Player } from "@/game/protocol";
import type {
  EndReason,
  MatchRecord,
  PlayerInfo,
  PlayerStats,
  ProfileResponse,
  Seat,
} from "@/game/realtime";
import { ROOM_CODE_LENGTH } from "@/game/realtime";
import { decideMove } from "@/engine/decide";
import { findVcf } from "@/engine/vcf";
import { boardFromMoves, nextPlayer, statusAfter, validateMoves } from "@/engine/rules";
import { idx } from "@/engine/patterns";
import { AI_LINES } from "@/lib/lines";
import { isRecord } from "@/lib/guards";
import { PROFILES } from "@/engine/difficulty";
import { claimNamespace, fetchUserInfoName } from "./auth";
import { Lobby } from "./lobby";
import { MatchRoom } from "./room";

type WorkerVariables = { readonly accessToken?: AccessTokenClaims };

type StatsRow = {
  id: string;
  name: string;
  wins: number;
  losses: number;
  draws: number;
  played: number;
  streak: number;
  best_streak: number;
  last_played_at: number | null;
};

type MatchRow = {
  id: string;
  code: string;
  rule: string;
  black_id: string;
  black_name: string;
  white_id: string;
  white_name: string;
  winner: string | null;
  reason: string;
  plies: number;
  started_at: number;
  finished_at: number;
  moves: string;
};

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  let code = "";
  for (const value of bytes) code += ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length];
  return code;
}

function playerStats(row: StatsRow): PlayerStats {
  return {
    id: row.id,
    name: row.name,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    played: row.played,
    streak: row.streak,
    bestStreak: row.best_streak,
    lastPlayedAt: row.last_played_at,
  };
}

function matchRecord(row: MatchRow): MatchRecord {
  return {
    id: row.id,
    code: row.code,
    rule: row.rule as RuleSet,
    blackId: row.black_id,
    blackName: row.black_name,
    whiteId: row.white_id,
    whiteName: row.white_name,
    winner: row.winner as Seat | null,
    reason: row.reason as EndReason,
    plies: row.plies,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    moves: row.moves,
  };
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

async function recentMatches(env: CloudflareEnv, id: string): Promise<MatchRecord[]> {
  const result = await env.DB.prepare(
    `SELECT * FROM matches
     WHERE black_id = ? OR white_id = ?
     ORDER BY finished_at DESC
     LIMIT 20`,
  )
    .bind(id, id)
    .all<MatchRow>();
  return result.results.map(matchRecord);
}

function profilePlayer(id: string, name: string): PlayerInfo {
  return { id, name, guest: false, connected: false };
}

const app = new Hono<{ Bindings: CloudflareEnv; Variables: WorkerVariables }>();

app.use(
  "/api/*",
  requireAccessToken({
    authBaseUrl: "https://auth.sharosoo.com",
    audience: "https://omok.sharosoo.com",
    optional: true,
  }),
);

app.post("/api/rooms", async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  if (!isRecord(raw) || !RULES.includes(raw.rule as RuleSet)) {
    return c.json({ error: "invalid_request" }, 400);
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = createRoomCode();
    const stub = c.env.ROOM.get(c.env.ROOM.idFromName(code));
    const response = await stub.fetch("https://room/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, rule: raw.rule }),
    });
    if (response.ok) return c.json({ code });
    if (response.status !== 409) break;
  }
  return c.json({ error: "room_create_failed" }, 500);
});

app.get("/api/rooms/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return c.json({ error: "room_not_found" }, 404);
  const stub = c.env.ROOM.get(c.env.ROOM.idFromName(code));
  const response = await stub.fetch("https://room/snapshot");
  if (response.status === 404) return c.json({ error: "room_not_found" }, 404);
  return response;
});

app.get("/api/rooms/:code/ws", async (c) => {
  const code = c.req.param("code").toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return c.text("Room not found", 404);
  const stub = c.env.ROOM.get(c.env.ROOM.idFromName(code));
  return stub.fetch(c.req.raw);
});

app.get("/api/queue/ws", (c) => {
  const stub = c.env.LOBBY.get(c.env.LOBBY.idFromName("global"));
  return stub.fetch(c.req.raw);
});

app.get("/api/me", async (c) => {
  const claims = c.get("accessToken");
  const id = claims ? tokenUserId(claims, claimNamespace) : null;
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const token = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const statsRow = await c.env.DB.prepare("SELECT * FROM player_stats WHERE id = ?")
    .bind(id)
    .first<StatsRow>();
  const name = token
    ? await fetchUserInfoName(c.env, token, statsRow?.name ?? id)
    : (statsRow?.name ?? id);
  if (statsRow && name !== statsRow.name) {
    await c.env.DB.prepare("UPDATE player_stats SET name = ? WHERE id = ?").bind(name, id).run();
    statsRow.name = name;
  }
  const body: ProfileResponse = {
    player: profilePlayer(id, name),
    stats: statsRow ? playerStats(statsRow) : null,
    recent: await recentMatches(c.env, id),
  };
  return c.json(body);
});

app.get("/api/players/:id", async (c) => {
  const id = c.req.param("id");
  if (id.startsWith("guest:")) return c.json({ error: "player_not_found" }, 404);
  const row = await c.env.DB.prepare("SELECT * FROM player_stats WHERE id = ?")
    .bind(id)
    .first<StatsRow>();
  if (!row) return c.json({ error: "player_not_found" }, 404);
  const body: ProfileResponse = {
    player: profilePlayer(row.id, row.name),
    stats: playerStats(row),
    recent: await recentMatches(c.env, id),
  };
  return c.json(body);
});

export { Lobby, MatchRoom };

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
  c.json({
    ok: true,
    jev: Boolean(c.env.TYPESAFE_API_KEY),
    board: BOARD_SIZE,
    db: Boolean(c.env.DB),
    room: Boolean(c.env.ROOM),
    lobby: Boolean(c.env.LOBBY),
  }),
);

/*
 * Dynamic PvP codes share one exported shell. The code stays in the URL and is
 * read client-side, so every real room can use the build-time `/pvp/room` page.
 */
app.get("/pvp/:code", (c) => {
  const url = new URL(c.req.url);
  url.pathname = "/pvp/room";
  return c.env.ASSETS.fetch(new Request(url, c.req.raw));
});

/*
 * `run_worker_first` is scoped to API and dynamic PvP paths in wrangler.jsonc.
 * This catch-all also keeps `wrangler dev` serving the exported site.
 */
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
