import { describe, expect, it } from "vitest";
import type { Coord, Player, RuleSet } from "@/game/protocol";
import { createBoard, forbiddenPointsFlat, fromNotation, statusAfter, toNotation, toRows, validateMoves } from "./rules";
import { idx, isFork, reportAt } from "./patterns";
import { analyzePoints } from "./candidates";
import { findVcf } from "./vcf";
import { decideMove } from "./decide";
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

const shapeAt = (board: Board, coord: string, me: Player) => {
  const { x, y } = at(coord);
  return reportAt(board, x, y, me).best;
};

describe("shape classification", () => {
  it("reads a placement that completes five", () => {
    const board = position([], ["H8", "I8", "J8", "K8"]);
    expect(shapeAt(board, "G8", 2)).toBe("five");
    expect(shapeAt(board, "L8", 2)).toBe("five");
  });

  it("distinguishes an open four from a four with one blocked end", () => {
    expect(shapeAt(position([], ["I8", "J8", "K8"]), "H8", 2)).toBe("openFour");
    expect(shapeAt(position(["G8"], ["I8", "J8", "K8"]), "H8", 2)).toBe("four");
  });

  it("classifies a broken four through a gap", () => {
    // O O _ O O : filling the gap leaves exactly one completion point.
    expect(shapeAt(position([], ["H8", "I8", "L8", "M8"]), "K8", 2)).toBe("four");
  });

  it("reads open threes including split shapes", () => {
    expect(shapeAt(position([], ["I8", "J8"]), "H8", 2)).toBe("openThree");
    // _ O _ O _ with the middle filled is still an open three.
    expect(shapeAt(position([], ["H8", "J8"]), "I8", 2)).toBe("openThree");
  });

  it("downgrades a three whose extension is blocked to a closed three", () => {
    expect(shapeAt(position(["G8"], ["I8", "J8"]), "H8", 2)).toBe("closedThree");
  });

  it("reports nothing for a stone with no line", () => {
    expect(shapeAt(position(["A15"], []), "H8", 2)).toBe("none");
  });

  it("detects a fork only when two threats appear at once", () => {
    // The cross H8/J8/H10/J10 gives I9 an open three on both diagonals.
    const fork = reportAt(position([], ["H8", "J8", "H10", "J10"]), at("I9").x, at("I9").y, 2);
    expect(isFork(fork.counts)).toBe(true);
    const single = reportAt(position([], ["H8", "I8"]), at("J8").x, at("J8").y, 2);
    expect(isFork(single.counts)).toBe(false);
  });
});

describe("win detection", () => {
  it("returns the whole winning run through the last stone", () => {
    const board = position(["H8", "I8", "J8", "K8", "L8"], []);
    const status = statusAfter(board, at("L8"));
    expect(status.winner).toBe(1);
    expect(status.winningLine?.map((c) => toNotation(c))).toEqual(["H8", "I8", "J8", "K8", "L8"]);
  });

  it("treats six in a row as a win, not an overline penalty", () => {
    const board = position(["G8", "H8", "I8", "J8", "K8", "L8"], []);
    expect(statusAfter(board, at("G8")).winner).toBe(1);
  });

  it("reports no winner for four in a row", () => {
    const board = position(["H8", "I8", "J8", "K8"], []);
    expect(statusAfter(board, at("K8")).winner).toBe(0);
  });

  it("finds diagonal wins", () => {
    const board = position(["D4", "E5", "F6", "G7", "H8"], []);
    expect(statusAfter(board, at("H8")).winner).toBe(1);
  });
});

describe("history validation", () => {
  it("rejects a repeated point", () => {
    expect(validateMoves([at("H8"), at("H8")])).toEqual({
      ok: false,
      reason: "move 1 plays an occupied point",
    });
  });

  it("rejects moves played after the game was decided", () => {
    const moves = [
      at("H8"), at("A1"), at("I8"), at("A2"), at("J8"),
      at("A3"), at("K8"), at("A4"), at("L8"), at("A5"),
    ];
    expect(validateMoves(moves).ok).toBe(false);
  });

  it("accepts a legal alternating history", () => {
    expect(validateMoves([at("H8"), at("I9"), at("H9")])).toEqual({ ok: true });
  });
});

describe("double three ban", () => {
  it("forbids the point that makes two open threes at once", () => {
    const board = position([], ["H8", "J8", "H10", "J10"]);
    const forbidden = forbiddenPointsFlat(board, 2, "double_three_ban").map((c) => toNotation(c));
    expect(forbidden).toContain("I9");
  });

  it("allows the same point when the move also makes a four", () => {
    const board = position([], ["H8", "I8", "J8", "H10", "J10"]);
    const forbidden = forbiddenPointsFlat(board, 2, "double_three_ban").map((c) => toNotation(c));
    expect(forbidden).not.toContain("K8");
  });

  it("forbids nothing under freestyle", () => {
    const board = position([], ["H8", "I8", "H10", "J10"]);
    expect(forbiddenPointsFlat(board, 2, "freestyle")).toEqual([]);
  });
});

describe("vcf search", () => {
  it("finds the immediate open four that cannot be answered", () => {
    const board = position(["A1", "B1", "C1"], ["H8", "I8", "J8"]);
    const result = findVcf(board, 2, "freestyle", 4);
    expect(result).not.toBeNull();
    expect(["G8", "K8"]).toContain(toNotation(result?.move ?? { x: -1, y: -1 }));
  });

  it("returns null when no forcing sequence exists", () => {
    const board = position(["H9", "I9"], ["H8"]);
    expect(findVcf(board, 2, "freestyle", 6)).toBeNull();
  });

  it("leaves the board untouched", () => {
    const board = position(["A1", "B1", "C1"], ["H8", "I8", "J8"]);
    const before = Array.from(board);
    findVcf(board, 2, "freestyle", 6);
    expect(Array.from(board)).toEqual(before);
  });
});

/** The decision pipeline with Jev disabled: code alone must handle tactics. */
const decideLocally = (board: Board, moves: readonly Coord[], rule: RuleSet = "freestyle") =>
  decideMove({
    board,
    moves,
    me: 2,
    rule,
    difficulty: "master",
    seed: 12345,
    vcf: (b, me, r, depth) => findVcf(b, me, r, depth)?.move ?? null,
  });

describe("forced ladder", () => {
  const filler = ["A1", "A3", "A5", "A7", "A9", "A11", "A13", "A15", "C1", "C3"];

  const withHistory = (black: readonly string[], white: readonly string[]) => {
    // decideMove only reads `moves` for the opening book and the Jev state, so a
    // history long enough to leave the book is all these cases need.
    const moves: Coord[] = [];
    const max = Math.max(black.length, white.length);
    for (let i = 0; i < max; i++) {
      if (black[i]) moves.push(at(black[i] as string));
      if (white[i]) moves.push(at(white[i] as string));
    }
    return moves;
  };

  it("takes the win instead of blocking an enemy four", async () => {
    const black = ["C7", "D7", "E7", "F7"];
    const white = ["H8", "I8", "J8", "K8"];
    const decision = await decideLocally(position(black, white), withHistory(black, white));
    expect(decision.source).toBe("forced_win");
    expect(["G8", "L8"]).toContain(toNotation(decision.move));
  });

  it("blocks the opponent's five when it cannot win first", async () => {
    const black = ["H8", "I8", "J8", "K8"];
    const white = ["G8", "E11", "F12", "G13"];
    const decision = await decideLocally(position(black, white), withHistory(black, white));
    expect(decision.source).toBe("forced_block");
    expect(toNotation(decision.move)).toBe("L8");
  });

  it("blocks an enemy four rather than starting its own fork", async () => {
    const black = ["H8", "I8", "J8", "K8"];
    const white = ["E11", "F12", "G13", ...filler.slice(0, 1)];
    const decision = await decideLocally(position(black, white), withHistory(black, white));
    expect(decision.source).toBe("forced_block");
    expect(["G8", "L8"]).toContain(toNotation(decision.move));
  });

  it("takes away the opponent's double-threat point", async () => {
    const black = ["H8", "J8", "H10", "J10"];
    const white = ["B2", "C3", "N14", "M13"];
    const decision = await decideLocally(position(black, white), withHistory(black, white));
    expect(toNotation(decision.move)).toBe("I9");
  });

  it("never returns an occupied point", async () => {
    const black = ["H8", "I9", "J10"];
    const white = ["H9", "I8", "K8"];
    const board = position(black, white);
    const decision = await decideLocally(board, withHistory(black, white));
    expect(board[idx(decision.move.x, decision.move.y)]).toBe(0);
  });

  it("respects the 33 ban when picking its own move", async () => {
    const black = ["A1", "A3", "A5", "A7"];
    const white = ["H8", "I8", "H10", "J10"];
    const board = position(black, white);
    const decision = await decideLocally(board, withHistory(black, white), "double_three_ban");
    const forbidden = forbiddenPointsFlat(board, 2, "double_three_ban").map((c) => toNotation(c));
    expect(forbidden).not.toContain(toNotation(decision.move));
  });
});

describe("board conversion", () => {
  it("round-trips notation", () => {
    expect(toNotation({ x: 7, y: 7 })).toBe("H8");
    expect(fromNotation("H8")).toEqual({ x: 7, y: 7 });
    expect(fromNotation("A1")).toEqual({ x: 0, y: 0 });
    expect(fromNotation("O15")).toEqual({ x: 14, y: 14 });
    expect(fromNotation("P9")).toBeNull();
    expect(fromNotation("H16")).toBeNull();
  });

  it("keeps row-major orientation when converting to rows", () => {
    const board = position(["A1"], ["O15"]);
    const rows = toRows(board);
    expect(rows[0]?.[0]).toBe(1);
    expect(rows[14]?.[14]).toBe(2);
  });
});

describe("candidate generation", () => {
  it("only offers empty points near a stone, best first", () => {
    const board = position([], ["H8"]);
    const points = analyzePoints(board, 2, "freestyle");
    expect(points.length).toBeGreaterThan(0);
    expect(points.every((p) => board[idx(p.coord.x, p.coord.y)] === 0)).toBe(true);
    expect(points.every((p) => Math.abs(p.coord.x - 7) <= 2 && Math.abs(p.coord.y - 7) <= 2)).toBe(
      true,
    );
    const scores = points.map((p) => p.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
});
