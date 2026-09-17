"use client";

import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { Coord } from "@/game/protocol";

import {
  getRingGeometry,
  getWinConnectorGeometry,
  getWinConnectorMaterial,
  getWinHaloMaterial,
} from "./resources";
import {
  cellKey,
  clamp01,
  easeOutCubic,
  lineEndpoints,
  STONE_HALF_HEIGHT,
  WIN_HALO_Y,
  WIN_RISE,
  WIN_STAGGER_MS,
  worldXFromColumn,
  worldZFromRow,
} from "./scene";

const CONNECTOR_RADIUS = 0.075;
const CONNECTOR_OVERHANG = 0.4;
const CONNECTOR_PULSE = 0.3;
const PULSE_PERIOD_MS = 1100;
const GROW_MS = 260;
const HALO_INNER = 0.3;
const HALO_OUTER = 0.56;
const HALF_PI = Math.PI / 2;

const UP = new THREE.Vector3(0, 1, 0);

export interface WinHighlightProps {
  line: readonly Coord[];
  startedAt: number;
  reducedMotion: boolean;
}

/** Glowing connector through the five winning stones, plus a halo under each. */
const WinHighlight = memo(function WinHighlight({
  line,
  startedAt,
  reducedMotion,
}: WinHighlightProps) {
  const connector = useRef<THREE.Mesh>(null);
  const material = getWinConnectorMaterial();
  const halo = getWinHaloMaterial();

  const placement = useMemo(() => {
    const ends = lineEndpoints(line);
    if (ends === null) return null;
    const [a, b] = ends;
    const from = new THREE.Vector3(worldXFromColumn(a.x), 0, worldZFromRow(a.y));
    const to = new THREE.Vector3(worldXFromColumn(b.x), 0, worldZFromRow(b.y));
    const span = to.distanceTo(from);
    const direction = to.clone().sub(from).normalize();
    return {
      length: span + CONNECTOR_OVERHANG * 2,
      centre: from.clone().add(to).multiplyScalar(0.5),
      quaternion: new THREE.Quaternion().setFromUnitVectors(UP, direction),
    };
  }, [line]);

  // Both materials are shared singletons; leave them invisible on the way out.
  useEffect(
    () => () => {
      material.opacity = 0;
      halo.opacity = 0;
    },
    [material, halo],
  );

  useFrame(() => {
    const mesh = connector.current;
    if (mesh === null || placement === null) return;
    if (reducedMotion) {
      mesh.scale.set(CONNECTOR_RADIUS, placement.length, CONNECTOR_RADIUS);
      material.opacity = 0.85;
      halo.opacity = 0.45;
      return;
    }
    const elapsed = performance.now() - startedAt;
    const grow = easeOutCubic(clamp01(elapsed / GROW_MS));
    const pulse = 1 + CONNECTOR_PULSE * Math.sin((elapsed / PULSE_PERIOD_MS) * Math.PI * 2);
    const radius = CONNECTOR_RADIUS * grow * pulse;
    mesh.scale.set(radius, placement.length * grow, radius);
    material.opacity = 0.9 * grow;
    halo.opacity = grow * (0.32 + 0.22 * Math.sin((elapsed / PULSE_PERIOD_MS) * Math.PI * 2));
  });

  if (placement === null) return null;

  return (
    <group>
      <mesh
        ref={connector}
        geometry={getWinConnectorGeometry()}
        material={material}
        position={[placement.centre.x, STONE_HALF_HEIGHT + WIN_RISE, placement.centre.z]}
        quaternion={placement.quaternion}
        scale={[CONNECTOR_RADIUS, placement.length, CONNECTOR_RADIUS]}
        dispose={null}
      />
      {line.map((point, index) => (
        <WinHalo
          key={cellKey(point.x, point.y)}
          point={point}
          index={index}
          startedAt={startedAt}
          reducedMotion={reducedMotion}
        />
      ))}
    </group>
  );
});

export default WinHighlight;

interface WinHaloProps {
  point: Coord;
  index: number;
  startedAt: number;
  reducedMotion: boolean;
}

function WinHalo({ point, index, startedAt, reducedMotion }: WinHaloProps) {
  const ring = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const mesh = ring.current;
    if (mesh === null) return;
    if (reducedMotion) {
      mesh.scale.setScalar(1);
      return;
    }
    const elapsed = performance.now() - startedAt - index * WIN_STAGGER_MS;
    if (elapsed <= 0) {
      mesh.scale.setScalar(0);
      return;
    }
    const grow = easeOutCubic(clamp01(elapsed / GROW_MS));
    const breathe = 1 + 0.14 * Math.sin((elapsed / PULSE_PERIOD_MS) * Math.PI * 2);
    mesh.scale.setScalar(grow * breathe);
  });

  return (
    <mesh
      ref={ring}
      geometry={getRingGeometry(HALO_INNER, HALO_OUTER)}
      material={getWinHaloMaterial()}
      rotation={[-HALF_PI, 0, 0]}
      position={[worldXFromColumn(point.x), WIN_HALO_Y, worldZFromRow(point.y)]}
      dispose={null}
    />
  );
}
