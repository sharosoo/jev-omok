/*
 * State of one human-vs-human match. The room is authoritative: nothing here
 * ever writes a stone, a turn or a result on its own — every board change comes
 * from a frame the room sent. The only thing this store computes locally is the
 * countdown, and that is cosmetic.
 */

import { create } from "zustand";

import { boardFromMoves, forbiddenPointsFlat, statusAfter, toRows } from "@/engine/rules";
import type { Cell, Coord, Player } from "@/game/protocol";
import type {
  ClientMessage,
  PlayerInfo,
  Role,
  RoomSnapshot,
  Seat,
  ServerErrorCode,
  ServerMessage,
} from "@/game/realtime";
import { tokens } from "@/lib/auth";
import { UI } from "@/lib/lines";
import type { ConnectionState, SocketHandle } from "@/lib/realtime";
import { connectRoom, fetchRoom, RoomRequestError } from "@/lib/realtime";

/** Everything the panel can explain to the player, server code or transport. */
export type PvpError = ServerErrorCode | "network";

export interface Countdown {
  readonly black: number;
  readonly white: number;
}

export interface PvpState {
  code: string | null;
  snapshot: RoomSnapshot | null;
  role: Role | null;
  you: PlayerInfo | null;
  connection: ConnectionState;
  /** Milliseconds left per seat, ticking locally between server frames. */
  clocks: Countdown;
  error: PvpError | null;
  /** The code addresses no live room; the page offers a way back instead. */
  notFound: boolean;
  rematchOfferBy: Seat | null;
  rematchSent: boolean;
  board: readonly (readonly Cell[])[];
  lastMove: Coord | null;
  winningLine: readonly Coord[] | null;
  forbidden: readonly Coord[];

  join: (code: string) => void;
  leave: () => void;
  place: (coord: Coord) => void;
  resign: () => void;
  rematch: () => void;
  retry: () => void;
}

const GUEST_NAME_KEY = "jev-omok:pvp:guest";

/*
 * The seat claim is per tab and per room: a resume key from `welcome`, or the
 * single-use ticket the lobby handed out when it matched two players. Both are
 * replayed the same way, so they share one slot.
 */
const seatSlot = (code: string): string => `jev-omok:pvp:seat:${code}`;

const readStore = (storage: Storage | null, key: string): string | null => {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const writeStore = (storage: Storage | null, key: string, value: string): void => {
  try {
    storage?.setItem(key, value);
  } catch {
    /* Private-mode quota failures cost a seat resume, never the match. */
  }
};

const browserStorage = (session: boolean): Storage | null => {
  if (typeof window === "undefined") return null;
  return session ? window.sessionStorage : window.localStorage;
};

export const readGuestName = (): string =>
  readStore(browserStorage(false), GUEST_NAME_KEY) ?? "";

export const saveGuestName = (name: string): void => {
  writeStore(browserStorage(false), GUEST_NAME_KEY, name);
};

/** Called by the lobby with a queue ticket, and by this store with a resume key. */
export const rememberSeat = (code: string, claim: string): void => {
  writeStore(browserStorage(true), seatSlot(code), claim);
};

const emptyBoard: readonly (readonly Cell[])[] = toRows(boardFromMoves([]));

const IDLE: Omit<
  PvpState,
  "join" | "leave" | "place" | "resign" | "rematch" | "retry"
> = {
  code: null,
  snapshot: null,
  role: null,
  you: null,
  connection: "closed",
  clocks: { black: 0, white: 0 },
  error: null,
  notFound: false,
  rematchOfferBy: null,
  rematchSent: false,
  board: emptyBoard,
  lastMove: null,
  winningLine: null,
  forbidden: [],
};

const seatPlayer = (seat: Seat): Player => (seat === "black" ? 1 : 2);

const countdown = (snapshot: RoomSnapshot, now: number): Countdown => {
  const elapsed = Math.max(0, now - snapshot.clocks.turnStartedAt);
  return {
    black:
      snapshot.turn === "black" ? Math.max(0, snapshot.clocks.black - elapsed) : snapshot.clocks.black,
    white:
      snapshot.turn === "white" ? Math.max(0, snapshot.clocks.white - elapsed) : snapshot.clocks.white,
  };
};

interface Derived {
  snapshot: RoomSnapshot;
  board: readonly (readonly Cell[])[];
  lastMove: Coord | null;
  winningLine: readonly Coord[] | null;
  forbidden: readonly Coord[];
  clocks: Countdown;
}

/** Rebuilds everything the board needs from the move list the room sent. */
const derive = (snapshot: RoomSnapshot, role: Role | null): Derived => {
  const flat = boardFromMoves(snapshot.moves);
  const lastMove = snapshot.moves.at(-1) ?? null;
  const seat: Seat | null = role === null || role === "spectator" ? null : role;
  // Forbidden points are a hint for the player about to move, nobody else.
  const hinting = seat !== null && snapshot.turn === seat && snapshot.rule === "double_three_ban";

  return {
    snapshot,
    board: toRows(flat),
    lastMove,
    // A terse snapshot may report the winner without the run; recompute it so
    // the highlight survives a reload.
    winningLine:
      snapshot.status.winningLine ??
      (snapshot.status.winner !== 0 && lastMove !== null
        ? statusAfter(flat, lastMove).winningLine
        : null),
    forbidden:
      hinting && seat !== null ? forbiddenPointsFlat(flat, seatPlayer(seat), snapshot.rule) : [],
    clocks: countdown(snapshot, Date.now()),
  };
};

/*
 * Module-level because they are not state a component renders: the socket and
 * the ticker belong to the mounted match, and `generation` discards callbacks
 * from a room the player has already left.
 */
let socket: SocketHandle<ClientMessage> | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let generation = 0;

export const usePvpStore = create<PvpState>()((set, get) => {
  const apply = (message: ServerMessage): void => {
    const state = get();
    const current = state.snapshot;

    switch (message.t) {
      case "welcome": {
        if (state.code !== null) rememberSeat(state.code, message.resumeKey);
        set({
          role: message.role,
          you: message.you,
          error: null,
          notFound: false,
          rematchOfferBy: null,
          rematchSent: false,
          ...derive(message.snapshot, message.role),
        });
        return;
      }
      case "snapshot":
        set(derive(message.snapshot, state.role));
        return;
      case "move": {
        if (current === null) return;
        set({
          error: null,
          ...derive(
            {
              ...current,
              moves: [...current.moves, message.coord],
              status: message.status,
              turn: message.turn,
              clocks: message.clocks,
            },
            state.role,
          ),
        });
        return;
      }
      case "presence": {
        if (current === null) return;
        set(
          derive(
            { ...current, players: message.players, spectators: message.spectators },
            state.role,
          ),
        );
        return;
      }
      case "over": {
        if (current === null) return;
        set(
          derive(
            {
              ...current,
              status: message.status,
              turn: null,
              winner: message.winner,
              endReason: message.reason,
            },
            state.role,
          ),
        );
        return;
      }
      case "rematch_offer":
        // The room echoes the offer to both seats; only the other seat's offer
        // is something to accept.
        set(
          message.by === state.role
            ? { rematchSent: true }
            : { rematchOfferBy: message.by, rematchSent: false },
        );
        return;
      case "rematch_start":
        set({
          rematchOfferBy: null,
          rematchSent: false,
          error: null,
          ...derive(message.snapshot, state.role),
        });
        return;
      case "error":
        set({ error: message.code });
        return;
      case "pong": {
        if (current === null) return;
        set(derive({ ...current, clocks: message.clocks }, state.role));
        return;
      }
    }
  };

  const startTicker = (): void => {
    if (ticker !== null) return;
    ticker = setInterval(() => {
      const { snapshot, clocks } = get();
      if (snapshot === null || snapshot.turn === null) return;
      const next = countdown(snapshot, Date.now());
      // Re-render once a second, not four times: the panel shows whole seconds.
      const changed =
        Math.ceil(next.black / 1000) !== Math.ceil(clocks.black / 1000) ||
        Math.ceil(next.white / 1000) !== Math.ceil(clocks.white / 1000);
      if (changed) set({ clocks: next });
    }, 250);
  };

  const teardown = (): void => {
    generation += 1;
    socket?.close();
    socket = null;
    if (ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  };

  const open = (code: string): void => {
    const ticket = generation;

    void (async () => {
      const token = await tokens.accessToken().catch(() => null);
      if (ticket !== generation) return;

      try {
        const snapshot = await fetchRoom(code, token);
        if (ticket !== generation) return;
        set(derive(snapshot, get().role));
      } catch (error) {
        if (ticket !== generation) return;
        if (error instanceof RoomRequestError && error.missing) {
          set({ notFound: true, connection: "closed" });
          return;
        }
        // A failed read is not fatal; the socket is the real source of truth.
      }

      const guestName = token === null ? readGuestName().trim() : "";
      socket = connectRoom({
        code,
        token,
        guestName: guestName === "" ? UI.pvp.lobby.guestFallbackName : guestName,
        resumeKey: readStore(browserStorage(true), seatSlot(code)),
        onMessage: apply,
        onState: (connection) => {
          set(connection === "open" ? { connection, error: null } : { connection });
        },
        onClose: (info) => {
          if (info.permanent) set({ error: "network" });
        },
      });
      startTicker();
    })();
  };

  return {
    ...IDLE,

    join: (code) => {
      if (get().code === code && socket !== null) return;
      teardown();
      set({ ...IDLE, code, connection: "connecting" });
      open(code);
    },

    leave: () => {
      teardown();
      set({ ...IDLE });
    },

    place: (coord) => {
      const { snapshot, role, connection, board, forbidden } = get();
      if (socket === null || connection !== "open") return;
      if (snapshot === null || role === null || role === "spectator") return;
      if (snapshot.turn !== role || snapshot.status.winner !== 0) return;
      if (board[coord.y]?.[coord.x] !== 0) return;
      if (forbidden.some((point) => point.x === coord.x && point.y === coord.y)) return;

      // Intent only. The stone appears when the room echoes the move back.
      socket.send({ t: "move", coord, expectedPly: snapshot.moves.length });
    },

    resign: () => {
      const { role, snapshot } = get();
      if (socket === null || role === null || role === "spectator") return;
      if (snapshot === null || snapshot.turn === null) return;
      socket.send({ t: "resign" });
    },

    rematch: () => {
      const { role } = get();
      if (socket === null || role === null || role === "spectator") return;
      socket.send({ t: "rematch" });
      set({ rematchSent: true });
    },

    retry: () => {
      const { code } = get();
      if (code === null) return;
      teardown();
      set({ ...IDLE, code, connection: "connecting" });
      open(code);
    },
  };
});
