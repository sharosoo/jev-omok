import { BOARD_SIZE } from "@/game/protocol";
import type { Cell, Coord, GameStatus, Player, RuleSet } from "@/game/protocol";
import { DIRS, N, idx, inBounds, reportAt } from "./patterns";
import type { Board } from "./types";

const COLUMNS = "ABCDEFGHIJKLMNO";

export const createBoard = (): Board => new Uint8Array(N * N);

/** Replays a move list; black plays the even indices, white the odd ones. */
export function boardFromMoves(moves: readonly Coord[]): Board {
  const board = createBoard();
  moves.forEach((move, i) => {
    board[idx(move.x, move.y)] = i % 2 === 0 ? 1 : 2;
  });
  return board;
}

export const toFlat = (rows: readonly (readonly Cell[])[]): Board => {
  const board = createBoard();
  for (let y = 0; y < N; y++) {
    const row = rows[y];
    if (!row) continue;
    for (let x = 0; x < N; x++) board[idx(x, y)] = row[x] ?? 0;
  }
  return board;
};

export const toRows = (board: Board): Cell[][] =>
  Array.from({ length: N }, (_, y) =>
    Array.from({ length: N }, (_, x) => (board[idx(x, y)] ?? 0) as Cell),
  );

export const toNotation = (coord: Coord): string =>
  `${COLUMNS[coord.x] ?? "?"}${coord.y + 1}`;

export function fromNotation(text: string): Coord | null {
  const match = /^([A-Oa-o])(\d{1,2})$/.exec(text.trim());
  if (!match) return null;
  const x = COLUMNS.indexOf((match[1] as string).toUpperCase());
  const y = Number(match[2]) - 1;
  return inBounds(x, y) ? { x, y } : null;
}

/**
 * The run of five or more through `lastMove`, or null. Returns the whole run so
 * the UI can highlight exactly the stones that ended the game.
 */
function runThrough(board: Board, lastMove: Coord, player: Player): Coord[] | null {
  for (const [dx, dy] of DIRS) {
    const line: Coord[] = [{ x: lastMove.x, y: lastMove.y }];
    for (let k = 1; k < N; k++) {
      const x = lastMove.x + (dx as number) * k;
      const y = lastMove.y + (dy as number) * k;
      if (!inBounds(x, y) || board[idx(x, y)] !== player) break;
      line.push({ x, y });
    }
    for (let k = 1; k < N; k++) {
      const x = lastMove.x - (dx as number) * k;
      const y = lastMove.y - (dy as number) * k;
      if (!inBounds(x, y) || board[idx(x, y)] !== player) break;
      line.unshift({ x, y });
    }
    if (line.length >= 5) return line;
  }
  return null;
}

export function statusAfter(board: Board, lastMove: Coord | null): GameStatus {
  let occupied = 0;
  for (let i = 0; i < board.length; i++) if (board[i]) occupied++;
  const boardFull = occupied >= N * N;

  if (!lastMove) return { winner: 0, winningLine: null, boardFull };
  const player = board[idx(lastMove.x, lastMove.y)];
  if (player !== 1 && player !== 2) return { winner: 0, winningLine: null, boardFull };

  const line = runThrough(board, lastMove, player);
  return line
    ? { winner: player, winningLine: line, boardFull }
    : { winner: 0, winningLine: null, boardFull };
}

/** Row-major entry point used by the browser store. */
export const checkWinner = (
  rows: readonly (readonly Cell[])[],
  lastMove: Coord,
): GameStatus => statusAfter(toFlat(rows), lastMove);

/**
 * Under `double_three_ban` a move is illegal when it creates two open threes at
 * once, unless it is already a four or better — a move that forces or wins is
 * never a 33. The ban is symmetric here: the Korean casual rule most players
 * know applies it to both colours, unlike Renju which restricts black only.
 */
export function isForbidden(board: Board, x: number, y: number, player: Player, rule: RuleSet) {
  if (rule !== "double_three_ban") return false;
  if (board[idx(x, y)] !== 0) return false;
  const report = reportAt(board, x, y, player);
  if (report.counts.five > 0 || report.counts.openFour > 0 || report.counts.four > 0) return false;
  return report.counts.openThree >= 2;
}

export function forbiddenPointsFlat(board: Board, player: Player, rule: RuleSet): Coord[] {
  if (rule !== "double_three_ban") return [];
  const out: Coord[] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (board[idx(x, y)] !== 0) continue;
      if (isForbidden(board, x, y, player, rule)) out.push({ x, y });
    }
  }
  return out;
}

export const forbiddenPoints = (
  rows: readonly (readonly Cell[])[],
  player: Player,
  rule: RuleSet,
): Coord[] => forbiddenPointsFlat(toFlat(rows), player, rule);

/**
 * Validates a client-supplied history before the engine trusts it: coordinates
 * in range, no repeats, and no move played after the game was already decided.
 */
export function validateMoves(moves: readonly Coord[]): { ok: true } | { ok: false; reason: string } {
  const board = createBoard();
  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    if (!move || !Number.isInteger(move.x) || !Number.isInteger(move.y)) {
      return { ok: false, reason: `move ${i} is not an integer coordinate` };
    }
    if (!inBounds(move.x, move.y)) return { ok: false, reason: `move ${i} is off the board` };
    const cell = idx(move.x, move.y);
    if (board[cell] !== 0) return { ok: false, reason: `move ${i} plays an occupied point` };
    board[cell] = i % 2 === 0 ? 1 : 2;
    const status = statusAfter(board, move);
    if (status.winner !== 0 && i !== moves.length - 1) {
      return { ok: false, reason: `move ${i} ended the game but the history continues` };
    }
  }
  return { ok: true };
}

export const nextPlayer = (moves: readonly Coord[]): Player => (moves.length % 2 === 0 ? 1 : 2);

export { BOARD_SIZE };
