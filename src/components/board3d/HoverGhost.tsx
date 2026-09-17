"use client";

import { useFrame } from "@react-three/fiber";
import { memo, useRef } from "react";
import type * as THREE from "three";

import type { Player } from "@/game/protocol";

import {
  getGhostMaterial,
  getHoverRingMaterial,
  getRingGeometry,
  ghostGeometry,
} from "./resources";
import {
  cellKey,
  clamp01,
  easeOutCubic,
  HOVER_RING_Y,
  STONE_HALF_HEIGHT,
  worldXFromColumn,
  worldZFromRow,
} from "./scene";

const POP_MS = 110;
const POP_FROM = 0.78;
const RING_INNER = 0.5;
const RING_OUTER = 0.58;
const HALF_PI = Math.PI / 2;

export interface HoverGhostProps {
  column: number;
  row: number;
  reducedMotion: boolean;
  /** Colour of the stone being previewed, i.e. the local player's seat. */
  seat: Player;
}

/** Translucent preview of the human's stone plus a ring on the intersection. */
const HoverGhost = memo(function HoverGhost({ column, row, reducedMotion, seat }: HoverGhostProps) {
  const stone = useRef<THREE.Mesh>(null);
  const shownAt = useRef(0);
  const shownKey = useRef(-1);

  // Restart the pop whenever the pointer crosses into a new intersection.
  const key = cellKey(column, row);
  if (shownKey.current !== key) {
    shownKey.current = key;
    shownAt.current = performance.now();
  }

  useFrame(() => {
    const mesh = stone.current;
    if (mesh === null) return;
    const progress = reducedMotion ? 1 : clamp01((performance.now() - shownAt.current) / POP_MS);
    const scale = POP_FROM + (1 - POP_FROM) * easeOutCubic(progress);
    mesh.scale.setScalar(scale);
    mesh.position.y = STONE_HALF_HEIGHT * scale;
  });

  return (
    <group position={[worldXFromColumn(column), 0, worldZFromRow(row)]}>
      <mesh
        ref={stone}
        geometry={ghostGeometry()}
        material={getGhostMaterial(seat)}
        position={[0, STONE_HALF_HEIGHT, 0]}
        dispose={null}
      />
      <mesh
        geometry={getRingGeometry(RING_INNER, RING_OUTER)}
        material={getHoverRingMaterial()}
        rotation={[-HALF_PI, 0, 0]}
        position={[0, HOVER_RING_Y, 0]}
        dispose={null}
      />
    </group>
  );
});

export default HoverGhost;
