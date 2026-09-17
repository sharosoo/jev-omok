"use client";

import { UI } from "@/lib/lines";
import { useGameStore } from "@/store/game";

/**
 * Turn state as a line of text rather than an overlay: the AI's think time is
 * announced next to the board, never on top of it.
 */
export function TurnIndicator() {
  const phase = useGameStore((state) => state.phase);
  const turn = useGameStore((state) => state.turn);

  if (phase === "over") return null;

  const thinking = phase === "thinking";
  const label = thinking ? UI.turn.thinking : turn === "human" ? UI.turn.human : UI.turn.ai;

  return (
    <p className="turn" aria-live="polite" data-active={thinking ? "ai" : turn}>
      <span className="turn__dot" aria-hidden="true" />
      <span className="turn__label">{label}</span>
      {thinking ? (
        <span className="turn__thinking" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : null}
    </p>
  );
}
