"use client";

import { useThree } from "@react-three/fiber";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { BOARD_SIZE, type Coord } from "@/game/protocol";

import HoverGhost from "./HoverGhost";
import PickPlane from "./PickPlane";

export interface InteractionProps {
  canPlace: (column: number, row: number) => boolean;
  onPlace: (coord: Coord) => void;
  reducedMotion: boolean;
}

/**
 * Owns the hover state so a pointer crossing intersections only re-renders the
 * ghost, never the board, the stones or the lighting.
 */
const Interaction = memo(function Interaction({
  canPlace,
  onPlace,
  reducedMotion,
}: InteractionProps) {
  const [hoverKey, setHoverKey] = useState<number | null>(null);
  const domElement = useThree((state) => state.gl.domElement);

  const hover = useMemo(() => {
    if (hoverKey === null) return null;
    const column = hoverKey % BOARD_SIZE;
    const row = (hoverKey - column) / BOARD_SIZE;
    return canPlace(column, row) ? { column, row } : null;
  }, [hoverKey, canPlace]);

  const commit = useCallback(
    (column: number, row: number) => {
      if (!canPlace(column, row)) return;
      onPlace({ x: column, y: row });
    },
    [canPlace, onPlace],
  );

  useEffect(() => {
    domElement.style.cursor = hover === null ? "default" : "pointer";
    return () => {
      domElement.style.cursor = "default";
    };
  }, [domElement, hover]);

  return (
    <>
      <PickPlane onHover={setHoverKey} onCommit={commit} />
      {hover !== null && (
        <HoverGhost column={hover.column} row={hover.row} reducedMotion={reducedMotion} />
      )}
    </>
  );
});

export default Interaction;
