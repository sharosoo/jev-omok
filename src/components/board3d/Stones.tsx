"use client";

import { createInstances, type PositionMesh } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { memo, useMemo, useRef } from "react";

import {
  getBlackStoneMaterial,
  getContactShadowGeometry,
  getContactShadowMaterial,
  getWhiteStoneMaterial,
  stoneGeometry,
} from "./resources";
import {
  BOARD_CELLS,
  clamp01,
  CONTACT_SHADOW_RADIUS,
  CONTACT_SHADOW_Y,
  DROP_HEIGHT,
  DROP_TOTAL_MS,
  dropPose,
  KEY_LIGHT_POSITION,
  settledPose,
  STONE_HALF_HEIGHT,
  winLift,
  worldXFromColumn,
  worldZFromRow,
  type StonePose,
} from "./scene";
import type { StoneRecord } from "./useStoneRecords";

/*
 * One InstancedMesh per colour: a full board is 225 lens solids, and instancing
 * keeps that at two draw calls for the colour pass plus two for the shadow map.
 * Each context pair has to be created separately because `Instances` publishes
 * its instance registry through the context it is given.
 */
const [BlackInstances, BlackInstance] = createInstances();
const [WhiteInstances, WhiteInstance] = createInstances();
const [ShadowInstances, ShadowInstance] = createInstances();

/* Horizontal travel of a contact blob per unit of stone height. */
const SHADOW_SLIDE_X = KEY_LIGHT_POSITION[0] / KEY_LIGHT_POSITION[1];
const SHADOW_SLIDE_Z = KEY_LIGHT_POSITION[2] / KEY_LIGHT_POSITION[1];

type NodeRegistry = Map<number, PositionMesh>;

export interface StonesProps {
  records: readonly StoneRecord[];
  /** Cell keys of the winning line, in line order; empty while playing. */
  winningKeys: readonly number[];
  winStartedAt: number | null;
  reducedMotion: boolean;
}

const Stones = memo(function Stones({
  records,
  winningKeys,
  winStartedAt,
  reducedMotion,
}: StonesProps) {
  const nodes = useRef<NodeRegistry>(new Map());
  const shadows = useRef<NodeRegistry>(new Map());
  const setters = useRef<Map<number, (node: PositionMesh | null) => void>>(new Map());
  const shadowSetters = useRef<Map<number, (node: PositionMesh | null) => void>>(new Map());

  // Stable per-key ref callbacks, so React does not detach and reattach every
  // stone on each render.
  const refInto = (
    cache: Map<number, (node: PositionMesh | null) => void>,
    registry: NodeRegistry,
    key: number,
  ): ((node: PositionMesh | null) => void) => {
    let setter = cache.get(key);
    if (setter === undefined) {
      setter = (node: PositionMesh | null): void => {
        if (node === null) registry.delete(key);
        else registry.set(key, node);
      };
      cache.set(key, setter);
    }
    return setter;
  };

  const black = useMemo(() => records.filter((record) => record.player === 1), [records]);
  const white = useMemo(() => records.filter((record) => record.player === 2), [records]);

  return (
    <group>
      <StoneAnimator
        nodes={nodes.current}
        shadows={shadows.current}
        records={records}
        winningKeys={winningKeys}
        winStartedAt={winStartedAt}
        reducedMotion={reducedMotion}
      />

      <BlackInstances
        limit={BOARD_CELLS}
        geometry={stoneGeometry()}
        material={getBlackStoneMaterial()}
        castShadow
        frustumCulled={false}
        dispose={null}
      >
        {black.map((record) => (
          <BlackInstance
            key={record.key}
            ref={refInto(setters.current, nodes.current, record.key)}
          />
        ))}
      </BlackInstances>

      <WhiteInstances
        limit={BOARD_CELLS}
        geometry={stoneGeometry()}
        material={getWhiteStoneMaterial()}
        castShadow
        frustumCulled={false}
        dispose={null}
      >
        {white.map((record) => (
          <WhiteInstance
            key={record.key}
            ref={refInto(setters.current, nodes.current, record.key)}
          />
        ))}
      </WhiteInstances>

      <ShadowInstances
        limit={BOARD_CELLS}
        geometry={getContactShadowGeometry()}
        material={getContactShadowMaterial()}
        frustumCulled={false}
        dispose={null}
      >
        {records.map((record) => (
          <ShadowInstance
            key={record.key}
            ref={refInto(shadowSetters.current, shadows.current, record.key)}
          />
        ))}
      </ShadowInstances>
    </group>
  );
});

export default Stones;

interface StoneAnimatorProps extends StonesProps {
  nodes: NodeRegistry;
  shadows: NodeRegistry;
}

/**
 * Drives every stone transform from one `useFrame`. Mounted before the
 * `Instances` groups so its callback runs before drei samples the instance
 * matrices, and idle boards stop writing transforms altogether.
 */
function StoneAnimator({
  nodes,
  shadows,
  records,
  winningKeys,
  winStartedAt,
  reducedMotion,
}: StoneAnimatorProps): null {
  const pose = useRef<StonePose>({ y: STONE_HALF_HEIGHT, scaleXZ: 1, scaleY: 1 });
  const appliedRecords = useRef<readonly StoneRecord[] | null>(null);
  const appliedWin = useRef<number | null | undefined>(undefined);
  const wasMoving = useRef(false);

  const winIndexByKey = useMemo(() => {
    const index = new Map<number, number>();
    winningKeys.forEach((key, position) => index.set(key, position));
    return index;
  }, [winningKeys]);

  const settleDeadline = useMemo(() => {
    let deadline = 0;
    for (const record of records) {
      if (record.bornAt !== null) deadline = Math.max(deadline, record.bornAt + DROP_TOTAL_MS);
    }
    return deadline;
  }, [records]);

  useFrame(() => {
    const now = performance.now();
    const moving = !reducedMotion && (winStartedAt !== null || now < settleDeadline);
    // `wasMoving` buys one extra pass after the last animated frame, so the
    // rest pose is always the pose that stays on screen.
    const dirty =
      appliedRecords.current !== records ||
      appliedWin.current !== winStartedAt ||
      wasMoving.current;
    if (!moving && !dirty) return;

    appliedRecords.current = records;
    appliedWin.current = winStartedAt;
    wasMoving.current = moving;

    const current = pose.current;
    for (const record of records) {
      if (reducedMotion || record.bornAt === null) settledPose(current);
      else dropPose(now - record.bornAt, current);

      const winIndex = winIndexByKey.get(record.key);
      const lift =
        winIndex === undefined || winStartedAt === null
          ? 0
          : winLift(now - winStartedAt, winIndex, reducedMotion);

      const worldX = worldXFromColumn(record.column);
      const worldZ = worldZFromRow(record.row);
      const height = current.y + lift;

      const node = nodes.get(record.key);
      if (node !== undefined) {
        node.position.set(worldX, height, worldZ);
        node.scale.set(current.scaleXZ, current.scaleY, current.scaleXZ);
        node.updateMatrixWorld();
      }

      const shadow = shadows.get(record.key);
      if (shadow !== undefined) {
        // The blob slides out along the key light and tightens as the stone
        // arrives, which is what reads as the stone meeting the wood.
        const air = clamp01((height - STONE_HALF_HEIGHT) / DROP_HEIGHT);
        const spread = CONTACT_SHADOW_RADIUS * (1 - 0.45 * air);
        shadow.position.set(
          worldX - SHADOW_SLIDE_X * height,
          CONTACT_SHADOW_Y,
          worldZ - SHADOW_SLIDE_Z * height,
        );
        shadow.scale.set(spread, 1, spread);
        shadow.updateMatrixWorld();
      }
    }
  });

  return null;
}
