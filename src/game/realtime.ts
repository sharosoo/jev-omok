import type { Coord, GameStatus, RuleSet } from "./protocol";

/**
 * Wire contract for human-vs-human matches. The browser, the Worker and the
 * MatchRoom Durable Object all import this file; it must stay free of any
 * runtime API.
 *
 * The room is authoritative. A client never applies its own move optimistically
 * as final state: it sends the intent and waits for the echo, because only the
 * room knows whose turn it is after a reconnect.
 */

export const REALTIME_PROTOCOL_VERSION = 1;

/** Seat in a match. Black always moves first, as in the AI game. */
export type Seat = "black" | "white";
export type Role = Seat | "spectator";

export interface PlayerInfo {
  /** Stable id: the OIDC subject for a signed-in player, `guest:<nanoid>` otherwise. */
  readonly id: string;
  readonly name: string;
  readonly guest: boolean;
  readonly connected: boolean;
}

export type EndReason = "five" | "resign" | "timeout" | "abandoned" | "draw";

export interface Clocks {
  /** Milliseconds left on each seat's turn clock. */
  readonly black: number;
  readonly white: number;
  /** When the current turn started, epoch ms, so clients can tick locally. */
  readonly turnStartedAt: number;
}

export interface RoomSnapshot {
  readonly code: string;
  readonly rule: RuleSet;
  readonly moves: readonly Coord[];
  readonly status: GameStatus;
  /** Whose turn it is; null once the game is over. */
  readonly turn: Seat | null;
  readonly players: { readonly black: PlayerInfo | null; readonly white: PlayerInfo | null };
  readonly clocks: Clocks;
  readonly endReason: EndReason | null;
  readonly spectators: number;
}

/*
 * Browsers cannot set headers on a WebSocket handshake, so the access token is
 * never in the URL (it would end up in logs and Referer): the first frame after
 * the socket opens carries it, and the room refuses every other message until
 * that frame arrives.
 */
export type ClientMessage =
  | {
      readonly t: "hello";
      readonly v: number;
      /** Bearer token from the sharosoo provider; omitted by a guest. */
      readonly token?: string;
      /** Requested display name for a guest. Ignored when a token is present. */
      readonly guestName?: string;
      /** Resume a seat after a reload; the room matches it against the player id. */
      readonly resumeKey?: string;
    }
  | { readonly t: "move"; readonly coord: Coord; readonly expectedPly: number }
  | { readonly t: "resign" }
  | { readonly t: "rematch" }
  | { readonly t: "ping" };

export type ServerErrorCode =
  | "bad_message"
  | "unauthenticated"
  | "room_full"
  | "not_your_turn"
  | "illegal_move"
  | "forbidden_point"
  | "game_over"
  | "stale_ply"
  | "version_mismatch"
  | "rate_limited";

export type ServerMessage
  = { readonly t: "welcome"; readonly v: number; readonly role: Role; readonly you: PlayerInfo; readonly resumeKey: string; readonly snapshot: RoomSnapshot }
  | { readonly t: "snapshot"; readonly snapshot: RoomSnapshot }
  | { readonly t: "move"; readonly coord: Coord; readonly by: Seat; readonly ply: number; readonly status: GameStatus; readonly turn: Seat | null; readonly clocks: Clocks }
  | { readonly t: "presence"; readonly players: RoomSnapshot["players"]; readonly spectators: number }
  | { readonly t: "over"; readonly winner: Seat | null; readonly reason: EndReason; readonly status: GameStatus; readonly matchId: string | null }
  | { readonly t: "rematch_offer"; readonly by: Seat }
  | { readonly t: "rematch_start"; readonly snapshot: RoomSnapshot }
  | { readonly t: "error"; readonly code: ServerErrorCode; readonly detail?: string }
  | { readonly t: "pong"; readonly clocks: Clocks };

/** Matchmaking socket: `/api/queue/ws`. Same hello-first rule. */
export type QueueClientMessage =
  | { readonly t: "hello"; readonly v: number; readonly token?: string; readonly guestName?: string }
  | { readonly t: "cancel" };

export type QueueServerMessage =
  | { readonly t: "waiting"; readonly position: number }
  /*
   * `ticket` is the seat reservation. The lobby reserves both seats in the room
   * before it answers, and the client replays the ticket as `resumeKey` on its
   * first `hello`. Without it a guest would arrive at the room as a brand-new
   * random identity, and whoever connected first would take black regardless of
   * what the lobby promised.
   */
  | { readonly t: "matched"; readonly code: string; readonly seat: Seat; readonly ticket: string }
  | { readonly t: "error"; readonly code: ServerErrorCode; readonly detail?: string };

/** Per-seat turn budget. A match cannot outlive two abandoned turns. */
export const TURN_MS = 60_000;
/** A room with no connected player for this long is closed by an alarm. */
export const ABANDON_MS = 120_000;
/** Room codes are short enough to read out loud. */
export const ROOM_CODE_LENGTH = 6;

export interface MatchRecord {
  readonly id: string;
  readonly code: string;
  readonly rule: RuleSet;
  readonly blackId: string;
  readonly blackName: string;
  readonly whiteId: string;
  readonly whiteName: string;
  /** null on a draw. */
  readonly winner: Seat | null;
  readonly reason: EndReason;
  readonly plies: number;
  readonly startedAt: number;
  readonly finishedAt: number;
  /** Move list packed as notation, e.g. "H8 I9 J8". */
  readonly moves: string;
}

export interface PlayerStats {
  readonly id: string;
  readonly name: string;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly played: number;
  /** Current and best win streak, maintained on write. */
  readonly streak: number;
  readonly bestStreak: number;
  readonly lastPlayedAt: number | null;
}

export interface ProfileResponse {
  readonly player: PlayerInfo;
  readonly stats: PlayerStats | null;
  readonly recent: readonly MatchRecord[];
}

export interface LeaderboardResponse {
  readonly rows: readonly PlayerStats[];
}
