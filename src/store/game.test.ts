import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Coord, MoveResponse } from "@/game/protocol";
import { useGameStore } from "@/store/game";

const reply = (move: Coord | null, overrides: Partial<MoveResponse> = {}): MoveResponse => ({
  move,
  source: "engine_fallback",
  reason: "test",
  confidence: null,
  danger: null,
  line: null,
  status: { winner: 0, winningLine: null, boardFull: false },
  latencyMs: 1,
  ...overrides,
});

const jsonResponse = (move: Coord | null): Response =>
  new Response(JSON.stringify(reply(move)), { status: 200 });

/** White answers far from the action so black can be driven deliberately. */
const parkedWhite = (attempt: number): Coord => ({ x: 0, y: attempt - 1 });

/**
 * `requestAiMove` is fire-and-forget, so tests wait on the store transition
 * itself rather than on a duration.
 */
const settled = (): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  if (useGameStore.getState().phase !== "thinking") {
    resolve();
    return promise;
  }
  const unsubscribe = useGameStore.subscribe((state) => {
    if (state.phase !== "thinking") {
      unsubscribe();
      resolve();
    }
  });
  return promise;
};

const stubWhite = () => {
  let attempts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      attempts += 1;
      return Promise.resolve(jsonResponse(parkedWhite(attempts)));
    }),
  );
  return () => attempts;
};

const play = async (coord: Coord): Promise<void> => {
  useGameStore.getState().placeHuman(coord);
  await settled();
};

beforeEach(() => {
  useGameStore.getState().newGame();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("undo", () => {
  it("removes the human and AI stones as a pair, leaving black to move", async () => {
    stubWhite();
    await play({ x: 5, y: 5 });
    await play({ x: 6, y: 5 });
    expect(useGameStore.getState().moves).toHaveLength(4);

    useGameStore.getState().undo();

    const state = useGameStore.getState();
    expect(state.moves).toEqual([
      { x: 5, y: 5 },
      { x: 0, y: 0 },
    ]);
    expect(state.turn).toBe("human");
    expect(state.phase).toBe("idle");
    // The undone point has to be playable again.
    expect(state.board[5]?.[6]).toBe(0);
  });

  it("removes a lone human stone when the AI never answered", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("fetch failed"))));

    useGameStore.getState().placeHuman({ x: 7, y: 7 });
    await settled();
    expect(useGameStore.getState().moves).toHaveLength(1);
    expect(useGameStore.getState().error).toBe("network");
    // The board stays locked on the AI so the human cannot play twice.
    expect(useGameStore.getState().turn).toBe("ai");

    useGameStore.getState().undo();

    const state = useGameStore.getState();
    expect(state.moves).toHaveLength(0);
    expect(state.turn).toBe("human");
    expect(state.error).toBeNull();
    expect(state.board[7]?.[7]).toBe(0);
  });
});

describe("single flight", () => {
  it("ignores a click while the AI is thinking", async () => {
    const { promise, resolve } = Promise.withResolvers<Response>();
    const fetchMock = vi.fn(() => promise);
    vi.stubGlobal("fetch", fetchMock);

    useGameStore.getState().placeHuman({ x: 7, y: 7 });
    expect(useGameStore.getState().phase).toBe("thinking");

    useGameStore.getState().placeHuman({ x: 8, y: 8 });
    expect(useGameStore.getState().moves).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolve(jsonResponse({ x: 3, y: 3 }));
    await settled();

    const state = useGameStore.getState();
    expect(state.moves).toEqual([
      { x: 7, y: 7 },
      { x: 3, y: 3 },
    ]);
    expect(state.board[8]?.[8]).toBe(0);
  });

  it("never lands a reply that was computed for an abandoned position", async () => {
    const stale = Promise.withResolvers<Response>();
    vi.stubGlobal("fetch", vi.fn(() => stale.promise));

    useGameStore.getState().placeHuman({ x: 7, y: 7 });
    useGameStore.getState().newGame();

    // The abandoned turn answers with a stone the fresh board must never show.
    stale.resolve(jsonResponse({ x: 12, y: 12 }));

    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ x: 1, y: 1 }))));
    await play({ x: 4, y: 4 });

    const state = useGameStore.getState();
    expect(state.moves).toEqual([
      { x: 4, y: 4 },
      { x: 1, y: 1 },
    ]);
    expect(state.board[12]?.[12]).toBe(0);
    expect(state.board[7]?.[7]).toBe(0);
  });
});

describe("local win detection", () => {
  it("ends the game on black's fifth stone without asking the worker", async () => {
    const attempts = stubWhite();
    for (const x of [5, 6, 7, 8]) {
      await play({ x, y: 5 });
    }
    const before = attempts();

    useGameStore.getState().placeHuman({ x: 9, y: 5 });

    const state = useGameStore.getState();
    expect(state.phase).toBe("over");
    expect(state.status.winner).toBe(1);
    expect(state.status.winningLine).toHaveLength(5);
    expect(attempts()).toBe(before);
  });

  it("refuses a click once the game is over", async () => {
    stubWhite();
    for (const x of [5, 6, 7, 8]) {
      await play({ x, y: 5 });
    }
    useGameStore.getState().placeHuman({ x: 9, y: 5 });
    const decided = useGameStore.getState().moves.length;

    useGameStore.getState().placeHuman({ x: 11, y: 11 });

    expect(useGameStore.getState().moves).toHaveLength(decided);
  });
});
