"use client";

import { Canvas } from "@react-three/fiber";
import { useEffect, useRef } from "react";

import type { Cell, Coord } from "@/game/protocol";

import BoardScene from "./BoardScene";
import { VIEW_FOV } from "./scene";

export interface Board3DProps {
  /** Row-major 15x15 board: board[y][x]. 0 empty, 1 black, 2 white. */
  board: readonly (readonly Cell[])[];
  /** The stone placed most recently, highlighted with a marker. */
  lastMove: Coord | null;
  /** Five stones to highlight when the game is won; null while playing. */
  winningLine: readonly Coord[] | null;
  /** True while the human may click an empty intersection. */
  interactive: boolean;
  /** Points the human is not allowed to play (33 금수), rendered as blocked. */
  forbidden?: readonly Coord[];
  /** Fired with board coordinates when the human commits a placement. */
  onPlace: (coord: Coord) => void;
}

const ROOT_STYLE = { width: "100%", height: "100%" } as const;
const CANVAS_STYLE = { width: "100%", height: "100%", display: "block" } as const;

export default function Board3D(props: Board3DProps) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    /*
     * OrbitControls listens for `wheel` on the canvas and preventDefaults it,
     * which would trap the page's scrolling under the board. Swallowing the
     * event here in the capture phase keeps a plain wheel as page scroll and
     * leaves ctrl/meta + wheel (and pinch) for zooming the board.
     */
    const gate = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) event.stopPropagation();
    };
    element.addEventListener("wheel", gate, { capture: true, passive: true });
    return () => element.removeEventListener("wheel", gate, { capture: true });
  }, []);

  return (
    <div ref={root} style={ROOT_STYLE}>
      {/* `soft` maps to PCFSoftShadowMap, which three 0.186 removed. */}
      <Canvas
        shadows="percentage"
        dpr={[1, 1.6]}
        gl={{ antialias: true, alpha: true }}
        camera={{ position: [0, 25, 21], fov: VIEW_FOV, near: 5, far: 140 }}
        style={CANVAS_STYLE}
      >
        <BoardScene {...props} />
      </Canvas>
    </div>
  );
}
