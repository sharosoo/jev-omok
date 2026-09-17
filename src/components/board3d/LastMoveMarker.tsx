"use client";

import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useRef } from "react";

import { getLastMoveMaterial, getRingGeometry } from "./resources";
import {
  cellKey,
  clamp01,
  DROP_TOTAL_MS,
  LAST_MOVE_Y,
  worldXFromColumn,
  worldZFromRow,
} from "./scene";

const RING_INNER = 0.53;
const RING_OUTER = 0.61;
const FADE_MS = 180;
const PEAK_OPACITY = 0.85;
const BREATH_PERIOD_MS = 1800;
const HALF_PI = Math.PI / 2;

export interface LastMoveMarkerProps {
  column: number;
  row: number;
  reducedMotion: boolean;
}

/** Persistent ring around the most recent stone, revealed once its drop ends. */
const LastMoveMarker = memo(function LastMoveMarker({
  column,
  row,
  reducedMotion,
}: LastMoveMarkerProps) {
  const material = getLastMoveMaterial();
  const placedAt = useRef(0);
  const placedKey = useRef(-1);

  const key = cellKey(column, row);
  if (placedKey.current !== key) {
    placedKey.current = key;
    placedAt.current = performance.now();
  }

  // The material is shared, so hand it back transparent when the marker goes.
  useEffect(() => () => void (material.opacity = 0), [material]);

  useFrame(() => {
    const now = performance.now();
    if (reducedMotion) {
      material.opacity = PEAK_OPACITY;
      return;
    }
    const delay = DROP_TOTAL_MS;
    const fade = clamp01((now - placedAt.current - delay) / FADE_MS);
    const breath = 0.82 + 0.18 * Math.sin((now / BREATH_PERIOD_MS) * Math.PI * 2);
    material.opacity = PEAK_OPACITY * fade * breath;
  });

  return (
    <mesh
      geometry={getRingGeometry(RING_INNER, RING_OUTER)}
      material={material}
      rotation={[-HALF_PI, 0, 0]}
      position={[worldXFromColumn(column), LAST_MOVE_Y, worldZFromRow(row)]}
      dispose={null}
    />
  );
});

export default LastMoveMarker;
