"use client";

import type { ThreeEvent } from "@react-three/fiber";
import { memo, useRef } from "react";

import { getPickGeometry } from "./resources";
import { cellKey, columnFromWorldX, isOnBoard, PICK_Y, rowFromWorldZ } from "./scene";

const HALF_PI = Math.PI / 2;
/** A rotating drag travels far further than this; a tap never does. */
const TAP_SLOP_PX = 8;
const TAP_MAX_MS = 700;

export interface PickPlaneProps {
  /** Cell key under the pointer, or `null` when the pointer left the board. */
  onHover: (key: number | null) => void;
  onCommit: (column: number, row: number) => void;
}

/*
 * A single invisible plane does all the picking: the world-space hit point
 * rounds straight to the nearest intersection, which is one raycast per
 * pointer event instead of 225 event-carrying meshes competing for the ray.
 */
const PickPlane = memo(function PickPlane({ onHover, onCommit }: PickPlaneProps) {
  const pressed = useRef<{ x: number; y: number; at: number } | null>(null);

  const keyAt = (event: ThreeEvent<PointerEvent>): number | null => {
    const column = columnFromWorldX(event.point.x);
    const row = rowFromWorldZ(event.point.z);
    return isOnBoard(column, row) ? cellKey(column, row) : null;
  };

  return (
    <mesh
      geometry={getPickGeometry()}
      rotation={[-HALF_PI, 0, 0]}
      position={[0, PICK_Y, 0]}
      visible={false}
      dispose={null}
      onPointerMove={(event) => onHover(keyAt(event))}
      onPointerOut={() => {
        pressed.current = null;
        onHover(null);
      }}
      onPointerDown={(event) => {
        pressed.current = {
          x: event.nativeEvent.clientX,
          y: event.nativeEvent.clientY,
          at: performance.now(),
        };
        onHover(keyAt(event));
      }}
      onPointerUp={(event) => {
        const start = pressed.current;
        pressed.current = null;
        if (start === null) return;
        const dx = event.nativeEvent.clientX - start.x;
        const dy = event.nativeEvent.clientY - start.y;
        // Releasing after a camera orbit must not drop a stone.
        if (Math.hypot(dx, dy) > TAP_SLOP_PX) return;
        if (performance.now() - start.at > TAP_MAX_MS) return;
        const column = columnFromWorldX(event.point.x);
        const row = rowFromWorldZ(event.point.z);
        if (isOnBoard(column, row)) onCommit(column, row);
      }}
    >
      <meshBasicMaterial />
    </mesh>
  );
});

export default PickPlane;
