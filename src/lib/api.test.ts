import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiFailure, requestMove } from "@/lib/api";
import type { MoveRequest, MoveResponse } from "@/game/protocol";

const REQUEST: MoveRequest = {
  moves: [{ x: 7, y: 7 }],
  rule: "freestyle",
  difficulty: "medium",
};

const VALID: MoveResponse = {
  move: { x: 6, y: 6 },
  source: "opening_book",
  reason: "book",
  confidence: null,
  danger: 0,
  line: { id: "calm_open", text: "." },
  status: { winner: 0, winningLine: null, boardFull: false },
  latencyMs: 1,
};

const stubFetch = (handler: (attempt: number) => Response | Promise<Response>) => {
  let attempts = 0;
  const fetchMock = vi.fn(() => {
    attempts += 1;
    return Promise.resolve(handler(attempts));
  });
  vi.stubGlobal("fetch", fetchMock);
  return () => attempts;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("requestMove retry taxonomy", () => {
  it("retries a 5xx exactly once and returns the second answer", async () => {
    const attempts = stubFetch((attempt) =>
      attempt === 1
        ? new Response(JSON.stringify({ error: "jev_upstream_failed" }), { status: 503 })
        : new Response(JSON.stringify(VALID), { status: 200 }),
    );

    await expect(requestMove(REQUEST)).resolves.toEqual(VALID);
    expect(attempts()).toBe(2);
  });

  it("retries a network error exactly once", async () => {
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new TypeError("fetch failed"))
          : Promise.resolve(new Response(JSON.stringify(VALID), { status: 200 }));
      }),
    );

    await expect(requestMove(REQUEST)).resolves.toEqual(VALID);
    expect(attempts).toBe(2);
  });

  it("gives up after the single retry", async () => {
    const attempts = stubFetch(() => new Response("", { status: 500 }));

    await expect(requestMove(REQUEST)).rejects.toMatchObject({ kind: "server" });
    expect(attempts()).toBe(2);
  });

  it("never retries a 4xx, since repeating the same request cannot fix it", async () => {
    const attempts = stubFetch(
      () => new Response(JSON.stringify({ error: "invalid_history", detail: "move 3" }), { status: 400 }),
    );

    const failure = await requestMove(REQUEST).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiFailure);
    expect(failure).toMatchObject({ kind: "protocol", detail: "move 3" });
    expect(attempts()).toBe(1);
  });

  it("treats a 200 carrying an ErrorResponse as a server refusal", async () => {
    const attempts = stubFetch(
      () => new Response(JSON.stringify({ error: "board_full" }), { status: 200 }),
    );

    await expect(requestMove(REQUEST)).rejects.toMatchObject({
      kind: "server",
      detail: "board_full",
    });
    expect(attempts()).toBe(1);
  });

  it("surfaces an expired deadline as timeout without a retry", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        attempts += 1;
        const { promise, reject } = Promise.withResolvers<Response>();
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
        return promise;
      }),
    );

    const pending = requestMove(REQUEST);
    const assertion = expect(pending).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(12_000);
    await assertion;
    expect(attempts).toBe(1);
  });
});

describe("response validation", () => {
  it("rejects a body that is not JSON rather than handing it to the store", async () => {
    stubFetch(() => new Response("<html>gateway</html>", { status: 200 }));
    await expect(requestMove(REQUEST)).rejects.toMatchObject({ kind: "protocol" });
  });

  it("rejects an off-contract move instead of casting it", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ ...VALID, move: { x: 99, y: 3 } }), {
          status: 200,
        }),
    );
    await expect(requestMove(REQUEST)).rejects.toMatchObject({ kind: "protocol" });
  });

  it("rejects an unknown MoveSource instead of widening the union", async () => {
    stubFetch(
      () => new Response(JSON.stringify({ ...VALID, source: "vibes" }), { status: 200 }),
    );
    await expect(requestMove(REQUEST)).rejects.toMatchObject({ kind: "protocol" });
  });

  it("keeps a null danger null, so the HUD can tell it apart from 0", async () => {
    stubFetch(
      () => new Response(JSON.stringify({ ...VALID, danger: null }), { status: 200 }),
    );
    await expect(requestMove(REQUEST)).resolves.toMatchObject({ danger: null });
  });
});
