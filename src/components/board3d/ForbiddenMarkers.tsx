"use client";

import { memo } from "react";

import type { Coord } from "@/game/protocol";

import { getForbiddenMaterial, getRingGeometry } from "./resources";
import { cellKey, FORBIDDEN_Y, worldXFromColumn, worldZFromRow } from "./scene";

const RING_INNER = 0.24;
const RING_OUTER = 0.32;
const HALF_PI = Math.PI / 2;

export interface ForbiddenMarkersProps {
  points: readonly Coord[];
}

/** Thin red rings on the points the human may not play (33 금수). */
const ForbiddenMarkers = memo(function ForbiddenMarkers({ points }: ForbiddenMarkersProps) {
  return (
    <group>
      {points.map((point) => (
        <mesh
          key={cellKey(point.x, point.y)}
          geometry={getRingGeometry(RING_INNER, RING_OUTER)}
          material={getForbiddenMaterial()}
          rotation={[-HALF_PI, 0, 0]}
          position={[worldXFromColumn(point.x), FORBIDDEN_Y, worldZFromRow(point.y)]}
          dispose={null}
        />
      ))}
    </group>
  );
});

export default ForbiddenMarkers;
