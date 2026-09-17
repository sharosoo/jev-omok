import { DurableObject } from "cloudflare:workers";
import type { QueueServerMessage, Seat } from "@/game/realtime";
import {
  REALTIME_PROTOCOL_VERSION,
  ROOM_CODE_LENGTH,
} from "@/game/realtime";
import { authenticatePlayer, createGuestIdentity } from "./auth";
import type { PlayerIdentity } from "./auth";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type QueueRow = {
  seq: number;
  player_id: string;
  name: string;
  guest: number;
  connection_id: string;
};

type QueueAttachment = {
  readonly authenticated: boolean;
  readonly playerId?: string;
  readonly connectionId?: string;
  readonly queued?: boolean;
};

function parseObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function parseAttachment(socket: WebSocket): QueueAttachment {
  const raw = parseObject(socket.deserializeAttachment() as unknown);
  if (!raw || raw.authenticated !== true) return { authenticated: false };
  if (
    typeof raw.playerId !== "string" ||
    typeof raw.connectionId !== "string" ||
    typeof raw.queued !== "boolean"
  ) {
    return { authenticated: false };
  }
  return {
    authenticated: true,
    playerId: raw.playerId,
    connectionId: raw.connectionId,
    queued: raw.queued,
  };
}

function roomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  let code = "";
  for (const value of bytes) code += ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length];
  return code;
}

export class Lobby extends DurableObject<CloudflareEnv> {
  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS queue (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        guest INTEGER NOT NULL,
        connection_id TEXT NOT NULL UNIQUE
      );
    `);
  }

  override fetch(request: Request): Response {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ authenticated: false } satisfies QueueAttachment);
    this.ctx.acceptWebSocket(server, ["pending"]);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") {
      this.send(socket, { t: "error", code: "bad_message" });
      return;
    }

    let raw: Record<string, unknown> | null;
    try {
      raw = parseObject(JSON.parse(message) as unknown);
    } catch {
      raw = null;
    }
    if (!raw || typeof raw.t !== "string") {
      this.send(socket, { t: "error", code: "bad_message" });
      return;
    }

    const attachment = parseAttachment(socket);
    if (!attachment.authenticated) {
      if (raw.t !== "hello") {
        this.send(socket, { t: "error", code: "unauthenticated" });
        return;
      }
      await this.hello(socket, raw);
      return;
    }

    if (raw.t !== "cancel") {
      this.send(socket, { t: "error", code: "bad_message" });
      return;
    }
    this.removeConnection(attachment.connectionId);
    socket.serializeAttachment({ ...attachment, queued: false } satisfies QueueAttachment);
    socket.close(1000, "Queue cancelled");
  }

  private async hello(socket: WebSocket, raw: Record<string, unknown>): Promise<void> {
    if (raw.v !== REALTIME_PROTOCOL_VERSION) {
      this.send(socket, { t: "error", code: "version_mismatch" });
      return;
    }

    let identity: PlayerIdentity;
    if (typeof raw.token === "string") {
      try {
        identity = await authenticatePlayer(this.env, raw.token);
      } catch {
        this.send(socket, { t: "error", code: "unauthenticated" });
        return;
      }
    } else {
      identity = createGuestIdentity(raw.guestName);
    }

    const connectionId = crypto.randomUUID();
    socket.serializeAttachment({
      authenticated: true,
      playerId: identity.id,
      connectionId,
      queued: false,
    } satisfies QueueAttachment);

    const existing = this.ctx.storage.sql
      .exec<QueueRow>("SELECT * FROM queue WHERE player_id = ?", identity.id)
      .toArray()[0];
    if (existing) {
      const existingSocket = this.socketFor(existing.connection_id);
      if (existingSocket) {
        this.ctx.storage.sql.exec(
          "UPDATE queue SET connection_id = ? WHERE player_id = ?",
          connectionId,
          identity.id,
        );
        socket.serializeAttachment({
          authenticated: true,
          playerId: identity.id,
          connectionId,
          queued: true,
        } satisfies QueueAttachment);
        existingSocket.close(4001, "Replaced by a newer connection");
        this.send(socket, { t: "waiting", position: this.position(existing.seq) });
        return;
      }
      this.ctx.storage.sql.exec("DELETE FROM queue WHERE player_id = ?", identity.id);
    }

    const opponent = this.ctx.storage.sql
      .exec<QueueRow>("SELECT * FROM queue ORDER BY seq LIMIT 1")
      .toArray()[0];
    if (!opponent) {
      this.enqueue(socket, identity, connectionId);
      return;
    }

    const opponentSocket = this.socketFor(opponent.connection_id);
    if (!opponentSocket) {
      this.ctx.storage.sql.exec("DELETE FROM queue WHERE connection_id = ?", opponent.connection_id);
      this.enqueue(socket, identity, connectionId);
      return;
    }

    const room = await this.initialiseRoom();
    if (room === null) {
      this.send(socket, { t: "error", code: "bad_message" });
      return;
    }
    const { code, stub } = room;
    const blackTicket = crypto.randomUUID();
    const whiteTicket = crypto.randomUUID();

    const reservations = await Promise.all([
      this.reserve(stub, "black", opponent, blackTicket),
      this.reserve(
        stub,
        "white",
        {
          seq: 0,
          player_id: identity.id,
          name: identity.name,
          guest: identity.guest ? 1 : 0,
          connection_id: connectionId,
        },
        whiteTicket,
      ),
    ]);
    if (reservations.some((response) => !response.ok)) {
      this.send(socket, { t: "error", code: "bad_message" });
      return;
    }

    this.ctx.storage.sql.exec("DELETE FROM queue WHERE connection_id = ?", opponent.connection_id);
    opponentSocket.serializeAttachment({
      ...parseAttachment(opponentSocket),
      queued: false,
    } satisfies QueueAttachment);
    this.send(opponentSocket, {
      t: "matched",
      code,
      seat: "black",
      ticket: blackTicket,
    });
    this.send(socket, { t: "matched", code, seat: "white", ticket: whiteTicket });
    opponentSocket.close(1000, "Matched");
    socket.close(1000, "Matched");
  }

  private async initialiseRoom(): Promise<{
    readonly code: string;
    readonly stub: DurableObjectStub;
  } | null> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = roomCode();
      const stub = this.env.ROOM.get(this.env.ROOM.idFromName(code));
      const response = await stub.fetch("https://room/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, rule: "freestyle" }),
      });
      if (response.ok) return { code, stub };
      if (response.status !== 409) return null;
    }
    return null;
  }

  private reserve(
    stub: DurableObjectStub,
    seat: Seat,
    player: QueueRow,
    ticket: string,
  ): Promise<Response> {
    return stub.fetch("https://room/reserve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seat,
        playerId: player.player_id,
        name: player.name,
        guest: player.guest === 1,
        ticket,
      }),
    });
  }

  private enqueue(socket: WebSocket, identity: PlayerIdentity, connectionId: string): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO queue (player_id, name, guest, connection_id) VALUES (?, ?, ?, ?)",
      identity.id,
      identity.name,
      identity.guest ? 1 : 0,
      connectionId,
    );
    const attachment = parseAttachment(socket);
    socket.serializeAttachment({ ...attachment, queued: true } satisfies QueueAttachment);
    const row = this.ctx.storage.sql
      .exec<QueueRow>("SELECT * FROM queue WHERE connection_id = ?", connectionId)
      .one();
    this.send(socket, { t: "waiting", position: this.position(row.seq) });
  }

  private position(seq: number): number {
    const row = this.ctx.storage.sql
      .exec<{ position: number }>("SELECT COUNT(*) AS position FROM queue WHERE seq <= ?", seq)
      .one();
    return row.position;
  }

  private socketFor(connectionId: string): WebSocket | null {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const attachment = parseAttachment(socket);
      if (attachment.authenticated && attachment.connectionId === connectionId) return socket;
    }
    return null;
  }

  override webSocketClose(
    socket: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): void {
    const attachment = parseAttachment(socket);
    if (attachment.authenticated && attachment.queued) {
      this.removeConnection(attachment.connectionId);
    }
  }

  override webSocketError(socket: WebSocket, _error: unknown): void {
    const attachment = parseAttachment(socket);
    if (attachment.authenticated && attachment.queued) {
      this.removeConnection(attachment.connectionId);
    }
  }

  private removeConnection(connectionId: string | undefined): void {
    if (connectionId) {
      this.ctx.storage.sql.exec("DELETE FROM queue WHERE connection_id = ?", connectionId);
    }
  }

  private send(socket: WebSocket, message: QueueServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
}
