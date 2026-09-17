import { describe, expect, it } from "vitest";
import type { Coord, Player } from "@/game/protocol";
import { createBoard, fromNotation, toNotation } from "./rules";
import { analyzePoints } from "./candidates";
import { idx } from "./patterns";
import { evaluateBoard, localScore } from "./evaluate";
import { nearBest, searchMoves } from "./search";
import type { Board } from "./types";

const at = (text: string): Coord => {
  const coord = fromNotation(text);
  if (!coord) throw new Error(`bad coordinate ${text}`);
  return coord;
};

function position(black: readonly string[], white: readonly string[]): Board {
  const board = createBoard();
  for (const c of black) board[idx(at(c).x, at(c).y)] = 1;
  for (const c of white) board[idx(at(c).x, at(c).y)] = 2;
  return board;
}

const LIMITS = { depth: 6, rootWidth: 12, innerWidth: 8, nodeLimit: 60_000 };

const search = (board: Board, me: Player, limits = LIMITS) =>
  searchMoves(
    board,
    me,
    "freestyle",
    analyzePoints(board, me, "freestyle").filter((p) => !p.forbidden),
    limits,
  );

describe("incremental evaluation", () => {
  it("agrees with a full sweep after a placement", () => {
    const board = position(["H8", "I9", "K10"], ["I8", "J8", "G7"]);
    const point = at("J9");
    const cell = idx(point.x, point.y);

    const before = evaluateBoard(board);
    const localBefore = localScore(board, point.x, point.y);
    board[cell] = 2;
    const localAfter = localScore(board, point.x, point.y);

    // This identity is what lets the search carry the score instead of
    // re-evaluating the board at every node.
    expect(before - localBefore + localAfter).toBe(evaluateBoard(board));
  });

  it("is signed from black's point of view", () => {
    expect(evaluateBoard(position(["H8", "I8", "J8"], []))).toBeGreaterThan(0);
    expect(evaluateBoard(position([], ["H8", "I8", "J8"]))).toBeLessThan(0);
    expect(evaluateBoard(createBoard())).toBe(0);
  });
});

describe("search", () => {
  it("plays the immediate five", () => {
    const board = position(["A1", "B1", "C1"], ["H8", "I8", "J8", "K8"]);
    const result = search(board, 2);
    expect(["G8", "L8"]).toContain(toNotation(result.moves[0]?.coord ?? { x: -1, y: -1 }));
  });

  it("completes five instead of answering the opponent's four", () => {
    // Both sides have a four. White moves, so white must finish, not block.
    const board = position(["C7", "D7", "E7", "F7"], ["H8", "I8", "J8", "K8"]);
    const result = search(board, 2);
    const chosen = toNotation(result.moves[0]?.coord ?? { x: -1, y: -1 });
    expect(["G8", "L8"]).toContain(chosen);
  });

  it("scores a faster win above a slower one", () => {
    const board = position(["A1", "B2", "C3"], ["H8", "I8", "J8", "K8", "E11", "F11", "G11"]);
    const result = search(board, 2);
    const five = result.moves.find((m) => ["G8", "L8"].includes(toNotation(m.coord)));
    const three = result.moves.find((m) => ["D11", "H11"].includes(toNotation(m.coord)));
    expect(five).toBeDefined();
    if (five && three) expect(five.score).toBeGreaterThan(three.score);
  });

  it("blocks the end of an open three that actually holds", () => {
    // Black has H8-I8-J8 open at G8 and K8, with L8 already white, so blocking
    // at G8 leaves nothing while K8 still allows a four toward F8.
    const board = position(["H8", "I8", "J8"], ["L8", "A1", "O15"]);
    const result = search(board, 2);
    const best = toNotation(result.moves[0]?.coord ?? { x: -1, y: -1 });
    expect(["G8", "K8"]).toContain(best);
  });

  it("never proposes an occupied point", () => {
    const board = position(["H8", "I9", "J10"], ["I8", "J9", "K10"]);
    const result = search(board, 2);
    for (const move of result.moves) expect(board[idx(move.coord.x, move.coord.y)]).toBe(0);
  });

  it("leaves the board exactly as it found it", () => {
    const board = position(["H8", "I9", "J10", "K8"], ["I8", "J9", "G7"]);
    const snapshot = Array.from(board);
    search(board, 2);
    expect(Array.from(board)).toEqual(snapshot);
  });

  it("respects the node ceiling and reports truncation", () => {
    const board = position(["H8", "I9", "J10", "K8", "F6"], ["I8", "J9", "G7", "H11", "E5"]);
    const result = search(board, 2, { ...LIMITS, nodeLimit: 50 });
    expect(result.nodes).toBeLessThanOrEqual(50 + LIMITS.depth);
    expect(result.truncated).toBe(true);
    expect(result.moves.length).toBeGreaterThan(0);
  });
});

describe("nearBest", () => {
  it("keeps a single clearly-best move alone", () => {
    const board = position(["A1", "B1", "C1"], ["H8", "I8", "J8", "K8"]);
    const result = search(board, 2);
    const set = nearBest(result, 1_500, 12);
    // Only the two winning points can be within a small margin of a mate score.
    for (const move of set) expect(["G8", "L8"]).toContain(toNotation(move.coord));
  });

  it("offers several moves in a quiet position", () => {
    const board = position(["H8", "K10"], ["I9", "G7"]);
    const result = search(board, 2, { ...LIMITS, depth: 4 });
    expect(nearBest(result, 6_000, 12).length).toBeGreaterThan(1);
  });
});
