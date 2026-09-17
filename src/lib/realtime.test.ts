import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoomSnapshot, ServerMessage } from "@/game/realtime";
import { connectRoom, parseQueueMessage, parseServerMessage } from "@/lib/realtime";

type Listener = (event: unknown) => void;

class FakeSocket {
  static instances: FakeSocket[] = [];

  readonly url: string;
  readonly sent: string[] = [];
  closedWith: number | null = null;
  private readonly listeners: Record<string, Listener[]> = {};

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener];
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code: number): void {
    this.closedWith = code;
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }

  frames(): unknown[] {
    return this.sent.map((raw) => JSON.parse(raw) as unknown);
  }
}

const SNAPSHOT: RoomSnapshot = {
  code: "ABC123",
  rule: "freestyle",
  moves: [],
  status: { winner: 0, winningLine: null, boardFull: false },
  turn: "black",
  players: {
    black: { id: "u1", name: "흑", guest: false, connected: true },
    white: null,
  },
  clocks: { black: 60_000, white: 60_000, turnStartedAt: 1_000 },
  winner: null,
  endReason: null,
  spectators: 0,
};

const WELCOME: ServerMessage = {
  t: "welcome",
  v: 1,
  role: "black",
  you: { id: "u1", name: "흑", guest: false, connected: true },
  resumeKey: "seat-key-1",
  snapshot: SNAPSHOT,
};

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("window", { location: { href: "http://localhost:3000/pvp/ABC123" } });
  vi.stubGlobal("document", {
    visibilityState: "visible",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const latest = (): FakeSocket => {
  const socket = FakeSocket.instances.at(-1);
  if (socket === undefined) throw new Error("no socket was opened");
  return socket;
};

describe("connectRoom handshake", () => {
  it("sends hello first and holds a move until welcome arrives", () => {
    const received: ServerMessage[] = [];
    const handle = connectRoom({
      code: "ABC123",
      token: "access-token",
      onMessage: (message) => received.push(message),
    });

    const socket = latest();
    expect(socket.url).toBe("ws://localhost:3000/api/rooms/ABC123/ws");

    handle.send({ t: "move", coord: { x: 7, y: 7 }, expectedPly: 0 });
    expect(socket.sent).toHaveLength(0);

    socket.emit("open", {});
    expect(socket.frames()).toEqual([{ t: "hello", v: 1, token: "access-token" }]);

    socket.emit("message", { data: JSON.stringify(WELCOME) });
    expect(socket.frames().at(-1)).toEqual({
      t: "move",
      coord: { x: 7, y: 7 },
      expectedPly: 0,
    });
    expect(received).toEqual([WELCOME]);
  });

  it("never hands an off-contract frame to the caller", () => {
    const received: ServerMessage[] = [];
    connectRoom({ code: "ABC123", token: null, onMessage: (message) => received.push(message) });

    const socket = latest();
    socket.emit("open", {});
    socket.emit("message", { data: "not json" });
    socket.emit("message", { data: JSON.stringify({ t: "welcome", v: 1, role: "penguin" }) });
    socket.emit("message", { data: JSON.stringify({ t: "unknown" }) });

    expect(received).toEqual([]);
  });

  it("reclaims the seat with the key the room last handed out", () => {
    vi.useFakeTimers();
    connectRoom({ code: "ABC123", token: null, guestName: "손님", onMessage: () => undefined });

    const first = latest();
    first.emit("open", {});
    expect(first.frames()).toEqual([{ t: "hello", v: 1, guestName: "손님" }]);

    first.emit("message", { data: JSON.stringify(WELCOME) });
    first.emit("close", { code: 1006, reason: "" });

    vi.advanceTimersByTime(800);
    const second = latest();
    expect(second).not.toBe(first);

    second.emit("open", {});
    expect(second.frames()).toEqual([
      { t: "hello", v: 1, guestName: "손님", resumeKey: "seat-key-1" },
    ]);
  });

  it("stops retrying when the room rejects the hello", () => {
    vi.useFakeTimers();
    const states: string[] = [];
    connectRoom({
      code: "ABC123",
      token: "bad",
      onMessage: () => undefined,
      onState: (state) => states.push(state),
    });

    latest().emit("close", { code: 4001, reason: "unauthenticated" });
    vi.advanceTimersByTime(60_000);

    expect(FakeSocket.instances).toHaveLength(1);
    expect(states.at(-1)).toBe("closed");
  });

  it("gives up after the backoff schedule is exhausted", () => {
    vi.useFakeTimers();
    const closes: boolean[] = [];
    connectRoom({
      code: "ABC123",
      token: null,
      onMessage: () => undefined,
      onClose: (info) => closes.push(info.permanent),
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      latest().emit("close", { code: 1006, reason: "" });
      vi.advanceTimersByTime(10_000);
    }

    expect(FakeSocket.instances).toHaveLength(7);
    expect(closes.at(-1)).toBe(true);
  });
});

describe("frame validation", () => {
  it("rejects a move whose coordinate is off the board", () => {
    expect(
      parseServerMessage({
        t: "move",
        coord: { x: 15, y: 0 },
        by: "black",
        ply: 1,
        status: { winner: 0, winningLine: null, boardFull: false },
        turn: "white",
        clocks: { black: 1, white: 1, turnStartedAt: 1 },
      }),
    ).toBeNull();
  });

  it("keeps a well-formed snapshot verbatim", () => {
    expect(parseServerMessage({ t: "snapshot", snapshot: SNAPSHOT })).toEqual({
      t: "snapshot",
      snapshot: SNAPSHOT,
    });
  });

  it("refuses a match without the seat ticket", () => {
    expect(parseQueueMessage({ t: "matched", code: "ABC123", seat: "black" })).toBeNull();
    expect(parseQueueMessage({ t: "matched", code: "ABC123", seat: "black", ticket: "k" })).toEqual(
      { t: "matched", code: "ABC123", seat: "black", ticket: "k" },
    );
  });
});
