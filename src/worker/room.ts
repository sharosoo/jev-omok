import { DurableObject } from "cloudflare:workers";
import type {
  Clocks,
  EndReason,
  PlayerInfo,
  Role,
  RoomSnapshot,
  Seat,
  ServerErrorCode,
  ServerMessage,
} from "@/game/realtime";
import {
  ABANDON_MS,
  REALTIME_PROTOCOL_VERSION,
  TURN_MS,
} from "@/game/realtime";
import { BOARD_SIZE } from "@/game/protocol";
import type { Coord, GameStatus, Player, RuleSet } from "@/game/protocol";
import { boardFromMoves, isForbidden, statusAfter, toNotation } from "@/engine/rules";
import { idx } from "@/engine/patterns";
import {
  createGuestIdentity,
  resolveAuthenticatedPlayer,
  verifyPlayerId,
} from "./auth";
import type { PlayerIdentity } from "./auth";

const RULES: readonly RuleSet[] = ["freestyle", "double_three_ban"];
const RESERVATION_MS = 120_000;

type RoomRow = {
  singleton: number;
  code: string | null;
  rule: string;
  black_id: string | null;
  black_name: string | null;
  black_guest: number | null;
  black_resume: string | null;
  black_connected: number;
  black_ticket: string | null;
  black_ticket_expires: number | null;
  white_id: string | null;
  white_name: string | null;
  white_guest: number | null;
  white_resume: string | null;
  white_connected: number;
  white_ticket: string | null;
  white_ticket_expires: number | null;
  started_at: number | null;
  end_reason: string | null;
  winner: string | null;
  black_clock: number;
  white_clock: number;
  turn_started_at: number;
  absence_since: number | null;
  finalised: number;
  match_seq: number;
  black_offer: number;
  white_offer: number;
};

type MoveRow = { ply: number; x: number; y: number };

type SocketAttachment = {
  readonly authenticated: boolean;
  readonly role?: Role;
  readonly playerId?: string;
  readonly name?: string;
  readonly guest?: boolean;
  readonly resumeKey?: string;
};

type Reservation = PlayerIdentity & {
  readonly seat: Seat;
  readonly ticket: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseAttachment(socket: WebSocket): SocketAttachment {
  const raw: unknown = socket.deserializeAttachment();
  if (!isRecord(raw) || typeof raw.authenticated !== "boolean") return { authenticated: false };
  if (!raw.authenticated) return { authenticated: false };
  if (
    (raw.role !== "black" && raw.role !== "white" && raw.role !== "spectator") ||
    typeof raw.playerId !== "string" ||
    typeof raw.name !== "string" ||
    typeof raw.guest !== "boolean" ||
    typeof raw.resumeKey !== "string"
  ) {
    return { authenticated: false };
  }
  return {
    authenticated: true,
    role: raw.role,
    playerId: raw.playerId,
    name: raw.name,
    guest: raw.guest,
    resumeKey: raw.resumeKey,
  };
}

function opposite(seat: Seat): Seat {
  return seat === "black" ? "white" : "black";
}

function seatPlayer(row: RoomRow, seat: Seat): PlayerInfo | null {
  const id = seat === "black" ? row.black_id : row.white_id;
  const name = seat === "black" ? row.black_name : row.white_name;
  const guest = seat === "black" ? row.black_guest : row.white_guest;
  if (id === null || name === null || guest === null) return null;
  return {
    id,
    name,
    guest: guest === 1,
    connected: (seat === "black" ? row.black_connected : row.white_connected) === 1,
  };
}

export class MatchRoom extends DurableObject<CloudflareEnv> {
  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS room_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        code TEXT,
        rule TEXT NOT NULL DEFAULT 'freestyle',
        black_id TEXT,
        black_name TEXT,
        black_guest INTEGER,
        black_resume TEXT,
        black_connected INTEGER NOT NULL DEFAULT 0,
        black_ticket TEXT,
        black_ticket_expires INTEGER,
        white_id TEXT,
        white_name TEXT,
        white_guest INTEGER,
        white_resume TEXT,
        white_connected INTEGER NOT NULL DEFAULT 0,
        white_ticket TEXT,
        white_ticket_expires INTEGER,
        started_at INTEGER,
        end_reason TEXT,
        winner TEXT,
        black_clock INTEGER NOT NULL DEFAULT ${TURN_MS},
        white_clock INTEGER NOT NULL DEFAULT ${TURN_MS},
        turn_started_at INTEGER NOT NULL DEFAULT 0,
        absence_since INTEGER,
        finalised INTEGER NOT NULL DEFAULT 0,
        match_seq INTEGER NOT NULL DEFAULT 0,
        black_offer INTEGER NOT NULL DEFAULT 0,
        white_offer INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS moves (
        ply INTEGER PRIMARY KEY,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO room_state (singleton) VALUES (1);
    `);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/init") return this.initialise(request);
    if (request.method === "POST" && url.pathname === "/reserve") return this.reserve(request);
    if (request.method === "GET" && url.pathname === "/snapshot") {
      const row = this.room();
      if (row.code === null) return new Response("Room not found", { status: 404 });
      return Response.json(this.snapshot(row));
    }
    if (request.method === "GET" && url.pathname.endsWith("/ws")) return this.upgrade(request);
    return new Response("Not found", { status: 404 });
  }

  private room(): RoomRow {
    return this.ctx.storage.sql.exec<RoomRow>("SELECT * FROM room_state WHERE singleton = 1").one();
  }

  private moves(): Coord[] {
    return this.ctx.storage.sql
      .exec<MoveRow>("SELECT ply, x, y FROM moves ORDER BY ply")
      .toArray()
      .map(({ x, y }) => ({ x, y }));
  }

  private async initialise(request: Request): Promise<Response> {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (!isRecord(raw) || typeof raw.code !== "string" || !RULES.includes(raw.rule as RuleSet)) {
      return new Response("Invalid room", { status: 400 });
    }

    const existing = this.room();
    if (existing.code !== null) {
      return new Response("Room already initialised", { status: 409 });
    }
    this.ctx.storage.sql.exec(
      "UPDATE room_state SET code = ?, rule = ? WHERE singleton = 1 AND code IS NULL",
      raw.code,
      raw.rule as string,
    );
    return Response.json({ code: raw.code });
  }

  private async reserve(request: Request): Promise<Response> {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (
      !isRecord(raw) ||
      (raw.seat !== "black" && raw.seat !== "white") ||
      typeof raw.playerId !== "string" ||
      typeof raw.name !== "string" ||
      typeof raw.guest !== "boolean" ||
      typeof raw.ticket !== "string"
    ) {
      return new Response("Invalid reservation", { status: 400 });
    }
    const row = this.room();
    if (row.code === null) return new Response("Room not found", { status: 404 });

    const reservation: Reservation = {
      seat: raw.seat,
      id: raw.playerId,
      name: raw.name,
      guest: raw.guest,
      ticket: raw.ticket,
    };
    const prefix = reservation.seat === "black" ? "black" : "white";
    const changed = this.ctx.storage.sql.exec(
      `UPDATE room_state SET
         ${prefix}_id = ?, ${prefix}_name = ?, ${prefix}_guest = ?,
         ${prefix}_ticket = ?, ${prefix}_ticket_expires = ?
       WHERE singleton = 1 AND ${prefix}_id IS NULL`,
      reservation.id,
      reservation.name,
      reservation.guest ? 1 : 0,
      reservation.ticket,
      Date.now() + RESERVATION_MS,
    );
    if (changed.rowsWritten === 0) return new Response("Seat already reserved", { status: 409 });
    return new Response(null, { status: 204 });
  }

  private upgrade(request: Request): Response {
    const row = this.room();
    if (row.code === null) return new Response("Room not found", { status: 404 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ authenticated: false } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server, ["pending"]);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") {
      this.sendError(socket, "bad_message");
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(message);
    } catch {
      this.sendError(socket, "bad_message");
      return;
    }
    if (!isRecord(raw) || typeof raw.t !== "string") {
      this.sendError(socket, "bad_message");
      return;
    }

    const attachment = parseAttachment(socket);
    if (!attachment.authenticated) {
      if (raw.t !== "hello") {
        this.sendError(socket, "unauthenticated");
        return;
      }
      await this.handleHello(socket, raw);
      return;
    }

    switch (raw.t) {
      case "move":
        await this.handleMove(socket, attachment, raw);
        break;
      case "resign":
        await this.handleResign(attachment);
        break;
      case "rematch":
        await this.handleRematch(attachment);
        break;
      case "ping":
        this.send(socket, { t: "pong", clocks: this.clocks(this.room()) });
        break;
      default:
        this.sendError(socket, "bad_message");
    }
  }

  private async handleHello(socket: WebSocket, raw: Record<string, unknown>): Promise<void> {
    if (raw.v !== REALTIME_PROTOCOL_VERSION) {
      this.sendError(socket, "version_mismatch");
      return;
    }

    const row = this.room();
    const resumeKey = typeof raw.resumeKey === "string" ? raw.resumeKey : null;
    let identity: PlayerIdentity;
    let claimedSeat: Seat | null = null;

    if (typeof raw.token === "string") {
      let id: string;
      try {
        id = await verifyPlayerId(this.env, raw.token);
      } catch {
        this.sendError(socket, "unauthenticated");
        return;
      }
      if (row.black_id === id) claimedSeat = "black";
      else if (row.white_id === id) claimedSeat = "white";
      const current = claimedSeat === null ? null : seatPlayer(row, claimedSeat);
      identity =
        current === null
          ? await resolveAuthenticatedPlayer(this.env, raw.token, id)
          : { id: current.id, name: current.name, guest: false };
    } else {
      const reservationSeat = this.reservationSeat(row, resumeKey);
      const returningSeat =
        reservationSeat ??
        (resumeKey !== null && row.black_resume === resumeKey
          ? "black"
          : resumeKey !== null && row.white_resume === resumeKey
            ? "white"
            : null);
      if (returningSeat !== null) {
        const returning = seatPlayer(row, returningSeat);
        if (returning === null) {
          this.sendError(socket, "bad_message");
          return;
        }
        identity = { id: returning.id, name: returning.name, guest: returning.guest };
        claimedSeat = returningSeat;
      } else {
        identity = createGuestIdentity(raw.guestName);
      }
    }

    if (claimedSeat === null && typeof raw.token === "string" && resumeKey !== null) {
      if (row.black_resume === resumeKey) claimedSeat = "black";
      else if (row.white_resume === resumeKey) claimedSeat = "white";
    }
    if (claimedSeat === null) {
      if (row.black_id === null) claimedSeat = "black";
      else if (row.white_id === null) claimedSeat = "white";
    }

    const role: Role = claimedSeat ?? "spectator";
    const assignedResumeKey =
      claimedSeat === "black"
        ? (row.black_resume ?? crypto.randomUUID())
        : claimedSeat === "white"
          ? (row.white_resume ?? crypto.randomUUID())
          : crypto.randomUUID();

    if (claimedSeat !== null) {
      this.replaceSeatSocket(socket, claimedSeat, identity.id);
      const prefix = claimedSeat === "black" ? "black" : "white";
      this.ctx.storage.sql.exec(
        `UPDATE room_state SET
           ${prefix}_id = ?, ${prefix}_name = ?, ${prefix}_guest = ?,
           ${prefix}_resume = ?, ${prefix}_connected = 1,
           ${prefix}_ticket = NULL, ${prefix}_ticket_expires = NULL
         WHERE singleton = 1`,
        identity.id,
        identity.name,
        identity.guest ? 1 : 0,
        assignedResumeKey,
      );
    }

    socket.serializeAttachment({
      authenticated: true,
      role,
      playerId: identity.id,
      name: identity.name,
      guest: identity.guest,
      resumeKey: assignedResumeKey,
    } satisfies SocketAttachment);

    let updated = this.room();
    if (
      updated.started_at === null &&
      updated.black_id !== null &&
      updated.white_id !== null &&
      updated.black_connected === 1 &&
      updated.white_connected === 1
    ) {
      const now = Date.now();
      this.ctx.storage.sql.exec(
        "UPDATE room_state SET started_at = ?, turn_started_at = ?, absence_since = NULL WHERE singleton = 1",
        now,
        now,
      );
      updated = this.room();
    } else {
      if (
        row.absence_since !== null &&
        updated.black_connected === 1 &&
        updated.white_connected === 1
      ) {
        this.ctx.storage.sql.exec(
          "UPDATE room_state SET turn_started_at = ? WHERE singleton = 1",
          Date.now(),
        );
        updated = this.room();
      }
      await this.updateAbsence(updated);
      updated = this.room();
    }

    const you: PlayerInfo = { ...identity, connected: true };
    this.send(socket, {
      t: "welcome",
      v: REALTIME_PROTOCOL_VERSION,
      role,
      you,
      resumeKey: assignedResumeKey,
      snapshot: this.snapshot(updated),
    });
    this.broadcastPresence(updated);
    await this.scheduleAlarm(updated);
  }

  private reservationSeat(row: RoomRow, resumeKey: string | null): Seat | null {
    if (resumeKey === null) return null;
    const now = Date.now();
    if (row.black_ticket === resumeKey && (row.black_ticket_expires ?? 0) >= now) return "black";
    if (row.white_ticket === resumeKey && (row.white_ticket_expires ?? 0) >= now) return "white";
    return null;
  }

  private replaceSeatSocket(current: WebSocket, seat: Seat, playerId: string): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === current || socket.readyState !== WebSocket.OPEN) continue;
      const attachment = parseAttachment(socket);
      if (
        attachment.authenticated &&
        attachment.role === seat &&
        attachment.playerId === playerId
      ) {
        socket.close(4001, "Replaced by a newer connection");
      }
    }
  }

  private async handleMove(
    _socket: WebSocket,
    attachment: SocketAttachment,
    raw: Record<string, unknown>,
  ): Promise<void> {
    const socket = _socket;
    const row = this.room();
    if (row.end_reason !== null) {
      this.sendError(socket, "game_over");
      return;
    }
    if (attachment.role !== "black" && attachment.role !== "white") {
      this.sendError(socket, "not_your_turn");
      return;
    }

    const moves = this.moves();
    const turn: Seat | null = this.turn(row, moves.length);
    if (turn !== attachment.role) {
      this.sendError(socket, "not_your_turn");
      return;
    }
    const now = Date.now();
    const allotted = turn === "black" ? row.black_clock : row.white_clock;
    const board = boardFromMoves(moves);
    if (row.absence_since === null && row.turn_started_at + allotted <= now) {
      const status = statusAfter(board, moves.at(-1) ?? null);
      await this.endMatch(opposite(turn), "timeout", status);
      return;
    }
    if (raw.expectedPly !== moves.length) {
      this.sendError(socket, "stale_ply");
      return;
    }
    if (!isRecord(raw.coord)) {
      this.sendError(socket, "illegal_move");
      return;
    }
    const x = raw.coord.x;
    const y = raw.coord.y;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      y < 0 ||
      x >= BOARD_SIZE ||
      y >= BOARD_SIZE
    ) {
      this.sendError(socket, "illegal_move");
      return;
    }
    if (board[idx(x, y)] !== 0) {
      this.sendError(socket, "illegal_move");
      return;
    }
    const player: Player = turn === "black" ? 1 : 2;
    if (isForbidden(board, x, y, player, row.rule as RuleSet)) {
      this.sendError(socket, "forbidden_point");
      return;
    }
    const elapsed =
      row.absence_since === null ? Math.max(0, now - row.turn_started_at) : 0;
    const remaining = Math.max(0, (turn === "black" ? row.black_clock : row.white_clock) - elapsed);
    const coord: Coord = { x, y };
    moves.push(coord);
    board[idx(x, y)] = player;
    const status = statusAfter(board, coord);
    const next = opposite(turn);
    const clockColumn = turn === "black" ? "black_clock" : "white_clock";
    const nextClockColumn = next === "black" ? "black_clock" : "white_clock";

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "INSERT INTO moves (ply, x, y) VALUES (?, ?, ?)",
        moves.length,
        x,
        y,
      );
      this.ctx.storage.sql.exec(
        `UPDATE room_state SET ${clockColumn} = ?, ${nextClockColumn} = ?, turn_started_at = ? WHERE singleton = 1`,
        remaining,
        TURN_MS,
        now,
      );
    });

    let updated = this.room();
    const ended = status.winner !== 0 || status.boardFull;
    const nextTurn = ended ? null : next;
    this.broadcast({
      t: "move",
      coord,
      by: turn,
      ply: moves.length,
      status,
      turn: nextTurn,
      clocks: this.clocks(updated),
    });

    if (status.winner !== 0) {
      const winner: Seat = status.winner === 1 ? "black" : "white";
      await this.endMatch(winner, "five", status);
      return;
    }
    if (status.boardFull) {
      await this.endMatch(null, "draw", status);
      return;
    }

    updated = this.room();
    await this.scheduleAlarm(updated);
  }

  private async handleResign(attachment: SocketAttachment): Promise<void> {
    if (attachment.role !== "black" && attachment.role !== "white") return;
    const row = this.room();
    if (row.end_reason !== null || row.started_at === null) return;
    const moves = this.moves();
    const status = statusAfter(boardFromMoves(moves), moves.at(-1) ?? null);
    await this.endMatch(opposite(attachment.role), "resign", status);
  }

  private async handleRematch(attachment: SocketAttachment): Promise<void> {
    if (attachment.role !== "black" && attachment.role !== "white") return;
    let row = this.room();
    if (row.end_reason === null || row.black_id === null || row.white_id === null) {
      this.sendErrorForPlayer(attachment.playerId, "game_over");
      return;
    }
    const column = attachment.role === "black" ? "black_offer" : "white_offer";
    this.ctx.storage.sql.exec(`UPDATE room_state SET ${column} = 1 WHERE singleton = 1`);
    this.broadcast({ t: "rematch_offer", by: attachment.role });
    row = this.room();
    if (row.black_offer !== 1 || row.white_offer !== 1) return;

    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM moves");
      this.ctx.storage.sql.exec(
        `UPDATE room_state SET
          black_id = ?, black_name = ?, black_guest = ?, black_resume = ?, black_connected = ?,
          white_id = ?, white_name = ?, white_guest = ?, white_resume = ?, white_connected = ?,
          started_at = ?, end_reason = NULL, winner = NULL,
          black_clock = ?, white_clock = ?, turn_started_at = ?, absence_since = NULL,
          finalised = 0, match_seq = match_seq + 1, black_offer = 0, white_offer = 0
         WHERE singleton = 1`,
        row.white_id,
        row.white_name,
        row.white_guest,
        row.white_resume,
        row.white_connected,
        row.black_id,
        row.black_name,
        row.black_guest,
        row.black_resume,
        row.black_connected,
        now,
        TURN_MS,
        TURN_MS,
        now,
      );
    });

    for (const socket of this.ctx.getWebSockets()) {
      const current = parseAttachment(socket);
      if (!current.authenticated || (current.role !== "black" && current.role !== "white")) continue;
      socket.serializeAttachment({
        ...current,
        role: opposite(current.role),
      } satisfies SocketAttachment);
    }
    row = this.room();
    this.broadcast({ t: "rematch_start", snapshot: this.snapshot(row) });
    await this.scheduleAlarm(row);
  }

  private async endMatch(
    winner: Seat | null,
    reason: EndReason,
    status: GameStatus,
  ): Promise<void> {
    const changed = this.ctx.storage.sql.exec(
      "UPDATE room_state SET end_reason = ?, winner = ? WHERE singleton = 1 AND end_reason IS NULL",
      reason,
      winner,
    );
    if (changed.rowsWritten === 0) return;
    await this.ctx.storage.deleteAlarm();
    const matchId = await this.finalise(this.room(), reason, winner);
    this.broadcast({ t: "over", winner, reason, status, matchId });
  }

  private async finalise(
    row: RoomRow,
    reason: EndReason,
    winner: Seat | null,
  ): Promise<string | null> {
    if (
      row.started_at === null ||
      row.code === null ||
      row.black_id === null ||
      row.black_name === null ||
      row.black_guest === null ||
      row.white_id === null ||
      row.white_name === null ||
      row.white_guest === null
    ) {
      return null;
    }

    const moves = this.moves();
    if (reason === "abandoned" && winner === null && moves.length < 10) return null;
    const guard = this.ctx.storage.sql.exec(
      "UPDATE room_state SET finalised = 1 WHERE singleton = 1 AND finalised = 0",
    );
    if (guard.rowsWritten === 0) return null;

    const finishedAt = Date.now();
    const matchId = `${row.code}:${row.started_at}:${row.match_seq}`;
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        `INSERT OR IGNORE INTO matches
          (id, code, rule, black_id, black_name, white_id, white_name, winner, reason, plies, started_at, finished_at, moves)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        matchId,
        row.code,
        row.rule,
        row.black_id,
        row.black_name,
        row.white_id,
        row.white_name,
        winner,
        reason,
        moves.length,
        row.started_at,
        finishedAt,
        moves.map(toNotation).join(" "),
      ),
    ];

    if (!(reason === "abandoned" && winner === null)) {
      if (row.black_guest === 0) {
        statements.push(
          this.statsStatement(
            row.black_id,
            row.black_name,
            winner === "black",
            winner === "white",
            winner === null,
            finishedAt,
          ),
        );
      }
      if (row.white_guest === 0) {
        statements.push(
          this.statsStatement(
            row.white_id,
            row.white_name,
            winner === "white",
            winner === "black",
            winner === null,
            finishedAt,
          ),
        );
      }
    }

    try {
      await this.env.DB.batch(statements);
      return matchId;
    } catch {
      this.ctx.storage.sql.exec("UPDATE room_state SET finalised = 0 WHERE singleton = 1");
      return null;
    }
  }

  private statsStatement(
    id: string,
    name: string,
    won: boolean,
    lost: boolean,
    drew: boolean,
    finishedAt: number,
  ): D1PreparedStatement {
    const win = won ? 1 : 0;
    const loss = lost ? 1 : 0;
    const draw = drew ? 1 : 0;
    return this.env.DB.prepare(
      `INSERT INTO player_stats
        (id, name, wins, losses, draws, played, streak, best_streak, last_played_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         wins = player_stats.wins + excluded.wins,
         losses = player_stats.losses + excluded.losses,
         draws = player_stats.draws + excluded.draws,
         played = player_stats.played + 1,
         streak = CASE WHEN excluded.wins = 1 THEN player_stats.streak + 1 ELSE 0 END,
         best_streak = MAX(
           player_stats.best_streak,
           CASE WHEN excluded.wins = 1 THEN player_stats.streak + 1 ELSE 0 END
         ),
         last_played_at = excluded.last_played_at`,
    ).bind(id, name, win, loss, draw, win, win, finishedAt);
  }

  override async alarm(): Promise<void> {
    const row = this.room();
    if (row.end_reason !== null || row.started_at === null) return;
    const now = Date.now();
    const moves = this.moves();
    const status = statusAfter(boardFromMoves(moves), moves.at(-1) ?? null);

    if (row.absence_since !== null) {
      if (row.absence_since + ABANDON_MS <= now) {
        const blackConnected = row.black_connected === 1;
        const whiteConnected = row.white_connected === 1;
        const winner: Seat | null =
          blackConnected === whiteConnected ? null : blackConnected ? "black" : "white";
        await this.endMatch(winner, "abandoned", status);
      } else {
        await this.scheduleAlarm(row);
      }
      return;
    }

    const turn = this.turn(row, moves.length);
    if (turn !== null) {
      const remaining = turn === "black" ? row.black_clock : row.white_clock;
      if (row.turn_started_at + remaining <= now) {
        await this.endMatch(opposite(turn), "timeout", status);
        return;
      }
    }
    await this.scheduleAlarm(row);
  }

  override async webSocketClose(
    socket: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    await this.disconnect(socket);
  }

  override async webSocketError(socket: WebSocket, _error: unknown): Promise<void> {
    await this.disconnect(socket);
  }

  private async disconnect(socket: WebSocket): Promise<void> {
    const attachment = parseAttachment(socket);
    if (
      !attachment.authenticated ||
      (attachment.role !== "black" && attachment.role !== "white")
    ) {
      this.broadcastPresence(this.room());
      return;
    }

    const replacementExists = this.ctx.getWebSockets().some((candidate) => {
      if (candidate === socket || candidate.readyState !== WebSocket.OPEN) return false;
      const candidateAttachment = parseAttachment(candidate);
      return (
        candidateAttachment.authenticated &&
        candidateAttachment.role === attachment.role &&
        candidateAttachment.playerId === attachment.playerId
      );
    });
    if (!replacementExists) {
      const before = this.room();
      const column = attachment.role === "black" ? "black_connected" : "white_connected";
      this.ctx.storage.sql.exec(`UPDATE room_state SET ${column} = 0 WHERE singleton = 1`);
      if (
        before.started_at !== null &&
        before.end_reason === null &&
        before.black_connected === 1 &&
        before.white_connected === 1
      ) {
        const moves = this.moves();
        const turn = this.turn(before, moves.length);
        if (turn !== null) {
          const now = Date.now();
          const remaining = Math.max(
            0,
            (turn === "black" ? before.black_clock : before.white_clock) -
              Math.max(0, now - before.turn_started_at),
          );
          const clockColumn = turn === "black" ? "black_clock" : "white_clock";
          this.ctx.storage.sql.exec(
            `UPDATE room_state SET ${clockColumn} = ?, turn_started_at = ? WHERE singleton = 1`,
            remaining,
            now,
          );
        }
      }
    }
    await this.updateAbsence(this.room());
    const row = this.room();
    this.broadcastPresence(row);
    await this.scheduleAlarm(row);
  }

  private async updateAbsence(row: RoomRow): Promise<void> {
    if (row.started_at === null || row.end_reason !== null) return;
    const bothConnected = row.black_connected === 1 && row.white_connected === 1;
    if (bothConnected && row.absence_since !== null) {
      this.ctx.storage.sql.exec("UPDATE room_state SET absence_since = NULL WHERE singleton = 1");
    } else if (!bothConnected && row.absence_since === null) {
      this.ctx.storage.sql.exec(
        "UPDATE room_state SET absence_since = ? WHERE singleton = 1",
        Date.now(),
      );
    }
  }

  private async scheduleAlarm(row: RoomRow): Promise<void> {
    if (row.started_at === null || row.end_reason !== null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    if (row.absence_since !== null) {
      await this.ctx.storage.setAlarm(row.absence_since + ABANDON_MS);
      return;
    }
    const moves = this.moves();
    const turn = this.turn(row, moves.length);
    if (turn === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const remaining = turn === "black" ? row.black_clock : row.white_clock;
    await this.ctx.storage.setAlarm(row.turn_started_at + remaining);
  }

  private turn(row: RoomRow, ply: number): Seat | null {
    if (
      row.started_at === null ||
      row.end_reason !== null ||
      row.black_id === null ||
      row.white_id === null
    ) {
      return null;
    }
    return ply % 2 === 0 ? "black" : "white";
  }

  private clocks(row: RoomRow): Clocks {
    let black = row.black_clock;
    let white = row.white_clock;
    const moves = this.moves();
    const turn = this.turn(row, moves.length);
    const elapsed =
      row.absence_since === null ? Math.max(0, Date.now() - row.turn_started_at) : 0;
    if (turn === "black") black = Math.max(0, black - elapsed);
    if (turn === "white") white = Math.max(0, white - elapsed);
    return { black, white, turnStartedAt: row.turn_started_at };
  }

  private snapshot(row: RoomRow): RoomSnapshot {
    const moves = this.moves();
    const board = boardFromMoves(moves);
    const status = statusAfter(board, moves.at(-1) ?? null);
    return {
      code: row.code ?? "",
      rule: row.rule as RuleSet,
      moves,
      status,
      turn: this.turn(row, moves.length),
      players: {
        black: seatPlayer(row, "black"),
        white: seatPlayer(row, "white"),
      },
      clocks: this.clocks(row),
      winner: row.winner as Seat | null,
      endReason: row.end_reason as EndReason | null,
      spectators: this.spectatorCount(),
    };
  }

  private spectatorCount(): number {
    let count = 0;
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const attachment = parseAttachment(socket);
      if (attachment.authenticated && attachment.role === "spectator") count++;
    }
    return count;
  }

  private broadcastPresence(row: RoomRow): void {
    this.broadcast({
      t: "presence",
      players: {
        black: seatPlayer(row, "black"),
        white: seatPlayer(row, "white"),
      },
      spectators: this.spectatorCount(),
    });
  }

  private sendErrorForPlayer(playerId: string | undefined, code: ServerErrorCode): void {
    if (!playerId) return;
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = parseAttachment(socket);
      if (attachment.authenticated && attachment.playerId === playerId) {
        this.sendError(socket, code);
      }
    }
  }

  private sendError(socket: WebSocket, code: ServerErrorCode, detail?: string): void {
    this.send(socket, { t: "error", code, ...(detail ? { detail } : {}) });
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  private broadcast(message: ServerMessage): void {
    const encoded = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState === WebSocket.OPEN) socket.send(encoded);
    }
  }
}
