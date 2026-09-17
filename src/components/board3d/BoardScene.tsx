"use client";

import { Environment, Lightformer } from "@react-three/drei";
import { useCallback, useMemo, useRef } from "react";

import type { Coord } from "@/game/protocol";

import type { Board3DProps } from "./Board3D";
import BoardSurface from "./BoardSurface";
import CameraRig from "./CameraRig";
import ForbiddenMarkers from "./ForbiddenMarkers";
import Interaction from "./Interaction";
import LastMoveMarker from "./LastMoveMarker";
import Stones from "./Stones";
import WinHighlight from "./WinHighlight";
import { BOARD_EXTENT, cellKey, KEY_LIGHT_POSITION } from "./scene";
import { useReducedMotion } from "./useReducedMotion";
import { useStoneRecords } from "./useStoneRecords";

const NO_POINTS: readonly Coord[] = [];
const NO_KEYS: readonly number[] = [];
const SHADOW_REACH = BOARD_EXTENT * 0.62;

/**
 * Remembers when the win was announced so the highlight can be timed from the
 * same clock the stones use.
 */
function useWinClock(winningLine: readonly Coord[] | null): number | null {
  const startedAt = useRef<number | null>(null);
  const seen = useRef<readonly Coord[] | null>(null);
  if (seen.current !== winningLine) {
    seen.current = winningLine;
    startedAt.current = winningLine === null ? null : performance.now();
  }
  return startedAt.current;
}

export default function BoardScene({
  board,
  lastMove,
  winningLine,
  interactive,
  forbidden,
  onPlace,
}: Board3DProps) {
  const reducedMotion = useReducedMotion();
  const records = useStoneRecords(board);
  const winStartedAt = useWinClock(winningLine);

  const forbiddenPoints = forbidden ?? NO_POINTS;
  const forbiddenKeys = useMemo(() => {
    const keys = new Set<number>();
    for (const point of forbiddenPoints) keys.add(cellKey(point.x, point.y));
    return keys;
  }, [forbiddenPoints]);

  const winningKeys = useMemo(
    () => (winningLine === null ? NO_KEYS : winningLine.map((point) => cellKey(point.x, point.y))),
    [winningLine],
  );

  const canPlace = useCallback(
    (column: number, row: number): boolean => {
      if (!interactive) return false;
      const line = board[row];
      if (line === undefined || line[column] !== 0) return false;
      return !forbiddenKeys.has(cellKey(column, row));
    },
    [board, forbiddenKeys, interactive],
  );

  return (
    <>
      <CameraRig />

      <hemisphereLight args={["#cfe0ff", "#4a3421", 0.5]} />
      <ambientLight intensity={0.22} />
      {/*
       * Plain PCF soft shadows instead of drei's PCSS helper: that helper
       * rewrites a global shader chunk and disposes every material in the
       * scene, which invalidates the shared material singletons this board
       * relies on and leaves the renderer with dangling programs.
       */}
      <directionalLight
        castShadow
        position={KEY_LIGHT_POSITION}
        intensity={2.4}
        color="#fff4e2"
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.015}
        shadow-camera-near={1}
        shadow-camera-far={44}
        shadow-camera-left={-SHADOW_REACH}
        shadow-camera-right={SHADOW_REACH}
        shadow-camera-top={SHADOW_REACH}
        shadow-camera-bottom={-SHADOW_REACH}
      />
      <directionalLight position={[-10, 7, -8]} intensity={0.4} color="#cbdcff" />

      {/* Procedural studio reflections: no HDRI is fetched at runtime. */}
      <Environment resolution={192}>
        <Lightformer
          form="rect"
          intensity={2.4}
          color="#fff6e8"
          position={[0, 7, 5]}
          rotation={[-Math.PI / 5, 0, 0]}
          scale={[12, 7, 1]}
        />
        <Lightformer
          form="rect"
          intensity={0.9}
          color="#c2d8ff"
          position={[-9, 4, -5]}
          rotation={[0, Math.PI / 3, 0]}
          scale={[9, 9, 1]}
        />
        <Lightformer
          form="circle"
          intensity={1.6}
          color="#ffdcae"
          position={[7, 5, -7]}
          scale={5}
        />
        <Lightformer
          form="rect"
          intensity={0.35}
          color="#6d5a44"
          position={[0, -6, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[14, 14, 1]}
        />
      </Environment>

      <BoardSurface />
      <Stones
        records={records}
        winningKeys={winningKeys}
        winStartedAt={winStartedAt}
        reducedMotion={reducedMotion}
      />
      <ForbiddenMarkers points={forbiddenPoints} />
      {lastMove !== null && (
        <LastMoveMarker column={lastMove.x} row={lastMove.y} reducedMotion={reducedMotion} />
      )}
      {winningLine !== null && winStartedAt !== null && (
        <WinHighlight line={winningLine} startedAt={winStartedAt} reducedMotion={reducedMotion} />
      )}
      <Interaction canPlace={canPlace} onPlace={onPlace} reducedMotion={reducedMotion} />
    </>
  );
}
