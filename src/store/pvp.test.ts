import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Coord } from "@/game/protocol";
import type { RoomSnapshot, ServerMessage } from "@/game/realtime";
import { usePvpStore } from "@/store/pvp";

vi.mock("@/lib/auth", () => ({ tokens: { accessToken: () => Promise.resolve(null) } }));

type Listener = (event: unknown) => void;

class FakeSocket {
  static instances: FakeSocket[] = [];

  readonly sent: string[] = [];
  private readonly listeners: Record<string, Listener[]> = {};

  constructor(_url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener];
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    /* the store only ever asks; nothing observes the closure here */
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }

  frames(): unknown[] {
    return this.sent.map((raw) => JSON.parse(raw) as unknown);
  }
}

const memoryStorage = (): Storage => {
  const cells: Record<string, string> = {};
  return {
    getItem: (key) => cells[key] ?? null,
    setItem: (key, value) => {
      cells[key] = value;
    },
    removeItem: (key) => {
      delete cells[key];
    },
    clear: () => undefined,
    key: () => null,
    length: 0,
  };
};

const snapshotWith = (over: Partial<RoomSnapshot>): RoomSnapshot => ({
  code: "ABC123",
  rule: "freestyle",
  moves: [],
  status: { winner: 0, winningLine: null, boardFull: false },
  turn: "black",
  players: {
    black: { id: "me", name: "흑", guest: true, connected: true },
    white: { id: "other", name: "백", guest: true, connected: true },
  },
  clocks: { black: 60_000, white: 60_000, turnStartedAt: Date.now() },
  winner: null,
  endReason: null,
  spectators: 0,
  ...over,
});

const welcome = (snapshot: RoomSnapshot, role: "black" | "white" | "spectator"): ServerMessage => ({
  t: "welcome",
  v: 1,
  role,
  you:
    role === "spectator"
      ? { id: "watcher", name: "관전", guest: true, connected: true }
      : { id: role === "black" ? "me" : "other", name: "흑", guest: true, connected: true },
  resumeKey: "seat-1",
  snapshot,
});

/** What `GET /api/rooms/:code` answers. 404 until a test opens a room. */
let roomHttp: { status: number; body: string | null } = { status: 404, body: null };

/** Joins, waits for the socket, and delivers the opening welcome. */
const enterRoom = async (
  snapshot: RoomSnapshot,
  role: "black" | "white" | "spectator",
): Promise<FakeSocket> => {
  roomHttp = { status: 200, body: JSON.stringify(snapshot) };
  usePvpStore.getState().join("ABC123");
  await vi.waitFor(() => {
    expect(FakeSocket.instances).toHaveLength(1);
  });

  const socket = FakeSocket.instances[0];
  if (socket === undefined) throw new Error("no socket was opened");
  socket.emit("open", {});
  socket.emit("message", { data: JSON.stringify(welcome(snapshot, role)) });
  return socket;
};

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("window", {
    location: { href: "http://localhost:3000/pvp/ABC123" },
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
  });
  vi.stubGlobal("document", {
    visibilityState: "visible",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  roomHttp = { status: 404, body: null };
  vi.stubGlobal("fetch", () =>
    Promise.resolve(new Response(roomHttp.body, { status: roomHttp.status })),
  );
});

afterEach(() => {
  usePvpStore.getState().leave();
  vi.unstubAllGlobals();
});

const H8: Coord = { x: 7, y: 7 };
const I9: Coord = { x: 8, y: 8 };

describe("pvp match state", () => {
  it("replays the room's move list with black on the even plies", async () => {
    await enterRoom(snapshotWith({ moves: [H8, I9] }), "black");

    const { board, lastMove } = usePvpStore.getState();
    expect(board[7]?.[7]).toBe(1);
    expect(board[8]?.[8]).toBe(2);
    expect(lastMove).toEqual(I9);
  });

  it("turns an unknown code into a state instead of a hanging connection", async () => {
    usePvpStore.getState().join("ZZZZZZ");

    await vi.waitFor(() => {
      expect(usePvpStore.getState().notFound).toBe(true);
    });
    expect(FakeSocket.instances).toEqual([]);
  });

  it("sends a click as an intent and leaves the board untouched", async () => {
    const socket = await enterRoom(snapshotWith({ moves: [] }), "black");

    usePvpStore.getState().place(H8);

    expect(socket.frames().at(-1)).toEqual({ t: "move", coord: H8, expectedPly: 0 });
    expect(usePvpStore.getState().board[7]?.[7]).toBe(0);
  });

  it("puts the stone down only when the room echoes it", async () => {
    const socket = await enterRoom(snapshotWith({ moves: [] }), "black");

    socket.emit("message", {
      data: JSON.stringify({
        t: "move",
        coord: H8,
        by: "black",
        ply: 1,
        status: { winner: 0, winningLine: null, boardFull: false },
        turn: "white",
        clocks: { black: 58_000, white: 60_000, turnStartedAt: Date.now() },
      }),
    });

    expect(usePvpStore.getState().board[7]?.[7]).toBe(1);
    expect(usePvpStore.getState().snapshot?.turn).toBe("white");
  });

  it("ignores a click while the other seat is on the clock", async () => {
    const socket = await enterRoom(snapshotWith({ moves: [H8], turn: "white" }), "black");

    usePvpStore.getState().place(I9);

    expect(socket.frames().filter((frame) => JSON.stringify(frame).includes('"move"'))).toEqual([]);
  });

  it("never lets a spectator move or resign", async () => {
    const socket = await enterRoom(snapshotWith({ moves: [] }), "spectator");

    usePvpStore.getState().place(H8);
    usePvpStore.getState().resign();

    expect(socket.frames()).toEqual([{ t: "hello", v: 1, guestName: "손님" }]);
  });

  it("records who won a resignation without inventing a five on the board", async () => {
    const socket = await enterRoom(snapshotWith({ moves: [H8, I9] }), "black");

    socket.emit("message", {
      data: JSON.stringify({
        t: "over",
        winner: "black",
        reason: "resign",
        status: { winner: 0, winningLine: null, boardFull: false },
        matchId: "m1",
      }),
    });

    const { snapshot, winningLine } = usePvpStore.getState();
    expect(snapshot?.winner).toBe("black");
    expect(snapshot?.status.winner).toBe(0);
    expect(snapshot?.endReason).toBe("resign");
    expect(snapshot?.turn).toBeNull();
    expect(winningLine).toBeNull();
  });

  it("reloads into a finished resignation without drawing a winning line", async () => {
    await enterRoom(
      snapshotWith({ moves: [H8, I9], turn: null, winner: "black", endReason: "resign" }),
      "black",
    );

    const { snapshot, winningLine, board } = usePvpStore.getState();
    expect(snapshot?.winner).toBe("black");
    expect(snapshot?.endReason).toBe("resign");
    // Board3D must not highlight five stones that were never played.
    expect(winningLine).toBeNull();
    expect(board[7]?.[7]).toBe(1);
  });

  it("burns the mover's clock down from turnStartedAt and freezes the other", async () => {
    const started = Date.now() - 5_000;
    await enterRoom(
      snapshotWith({ clocks: { black: 60_000, white: 60_000, turnStartedAt: started } }),
      "black",
    );

    const { clocks } = usePvpStore.getState();
    expect(clocks.white).toBe(60_000);
    expect(clocks.black).toBeLessThanOrEqual(55_000);
    expect(clocks.black).toBeGreaterThan(54_000);
  });
});
