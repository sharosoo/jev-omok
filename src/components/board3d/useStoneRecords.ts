import { useMemo, useRef } from "react";

import { BOARD_SIZE, type Cell, type Player } from "@/game/protocol";

import { cellKey } from "./scene";

export interface StoneRecord {
  readonly key: number;
  readonly column: number;
  readonly row: number;
  readonly player: Player;
  /** `performance.now()` when the stone first appeared, `null` if it was already on the board. */
  readonly bornAt: number | null;
}

/**
 * Diffs the incoming board against the last one and hands back one record per
 * stone, reusing the previous record whenever the intersection still holds the
 * same colour. That reuse is what keeps a re-render from replaying the drop
 * animation of stones that were already down.
 *
 * Stones present on the very first render are marked as already settled, so
 * restoring a saved game does not rain fifty stones onto the board.
 */
export function useStoneRecords(board: readonly (readonly Cell[])[]): readonly StoneRecord[] {
  const previous = useRef<Map<number, StoneRecord>>(new Map());
  const mounted = useRef(false);

  return useMemo(() => {
    const now = performance.now();
    const next = new Map<number, StoneRecord>();
    const records: StoneRecord[] = [];

    for (let row = 0; row < BOARD_SIZE; row++) {
      const line = board[row];
      if (line === undefined) continue;
      for (let column = 0; column < BOARD_SIZE; column++) {
        const cell = line[column];
        if (cell === undefined || cell === 0) continue;
        const key = cellKey(column, row);
        const prior = previous.current.get(key);
        const record: StoneRecord =
          prior !== undefined && prior.player === cell
            ? prior
            : { key, column, row, player: cell, bornAt: mounted.current ? now : null };
        next.set(key, record);
        records.push(record);
      }
    }

    previous.current = next;
    mounted.current = true;
    return records;
  }, [board]);
}
