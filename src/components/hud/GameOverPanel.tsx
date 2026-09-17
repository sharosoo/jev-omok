"use client";

import { UI } from "@/lib/lines";
import { AI, HUMAN, useGameStore } from "@/store/game";

export function GameOverPanel() {
  const phase = useGameStore((state) => state.phase);
  const winner = useGameStore((state) => state.status.winner);
  const newGame = useGameStore((state) => state.newGame);

  if (phase !== "over") return null;

  const outcome =
    winner === HUMAN ? UI.result.humanWin : winner === AI ? UI.result.aiWin : UI.result.draw;

  return (
    <section className="notice notice--result" data-winner={winner} role="status">
      <h2 className="notice__title">{UI.result.title}</h2>
      <p className="notice__body">{outcome}</p>
      <button autoFocus className="button" onClick={newGame} type="button">
        {UI.controls.newGame}
      </button>
    </section>
  );
}
