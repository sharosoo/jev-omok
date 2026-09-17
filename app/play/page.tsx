"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

import { HudPanel } from "@/components/hud/HudPanel";
import { UI } from "@/lib/lines";
import { useGameStore } from "@/store/game";

/*
 * The scene touches WebGL on import, so it must never be evaluated during the
 * static export. `ssr: false` is only legal inside a client component, which
 * is why this page is one.
 */
const Board3D = dynamic(() => import("@/components/board3d/Board3D"), {
  ssr: false,
  loading: () => <div className="stage__loading" aria-hidden="true" />,
});

export default function PlayPage() {
  const board = useGameStore((state) => state.board);
  const moves = useGameStore((state) => state.moves);
  const winningLine = useGameStore((state) => state.status.winningLine);
  const forbidden = useGameStore((state) => state.forbidden);
  const interactive = useGameStore((state) => state.phase === "idle" && state.turn === "human");
  const placeHuman = useGameStore((state) => state.placeHuman);
  const restore = useGameStore((state) => state.restore);

  // localStorage is unreachable during the export, so resuming happens on mount.
  useEffect(() => {
    restore();
  }, [restore]);

  return (
    <main className="stage">
      <section aria-label={UI.a11y.board} className="stage__board">
        <Board3D
          board={board}
          forbidden={forbidden}
          interactive={interactive}
          lastMove={moves.at(-1) ?? null}
          onPlace={placeHuman}
          winningLine={winningLine}
        />
      </section>
      <HudPanel />
    </main>
  );
}
