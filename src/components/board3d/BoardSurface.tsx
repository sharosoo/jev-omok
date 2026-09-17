"use client";

import { RoundedBox } from "@react-three/drei";
import { memo } from "react";

import {
  getGridGeometry,
  getGridMaterial,
  getVeneerGeometry,
  getVeneerMaterial,
} from "./resources";
import { BOARD_EXTENT, BOARD_THICKNESS, BOARD_TOP_Y, GRID_Y, VENEER_Y } from "./scene";

const HALF_PI = Math.PI / 2;

/**
 * Wooden slab, grain veneer and the lacquered grid. The grid and star points
 * are one merged geometry floating a couple of millimetres above the veneer,
 * which is enough separation for the depth buffer at this camera range.
 */
const BoardSurface = memo(function BoardSurface() {
  return (
    <group>
      <RoundedBox
        args={[BOARD_EXTENT, BOARD_THICKNESS, BOARD_EXTENT]}
        radius={0.14}
        smoothness={3}
        bevelSegments={3}
        position={[0, BOARD_TOP_Y - BOARD_THICKNESS / 2, 0]}
        receiveShadow
      >
        <meshStandardMaterial color="#d3a869" roughness={0.6} metalness={0.02} />
      </RoundedBox>

      <mesh
        geometry={getVeneerGeometry()}
        material={getVeneerMaterial()}
        rotation={[-HALF_PI, 0, 0]}
        position={[0, VENEER_Y, 0]}
        receiveShadow
        dispose={null}
      />

      <mesh
        geometry={getGridGeometry()}
        material={getGridMaterial()}
        position={[0, GRID_Y, 0]}
        dispose={null}
      />
    </group>
  );
});

export default BoardSurface;
