"use client";

import { UI } from "@/lib/lines";
import { useGameStore } from "@/store/game";

/** The AI's spoken line arrives already localised from the Worker. */
export function AiBubble() {
  const lastAi = useGameStore((state) => state.lastAi);
  // A turn can arrive without a line (Jev skipped or failed); then there is
  // nothing to say and the bubble stays out of the layout entirely.
  if (lastAi === null || lastAi.line === null) return null;

  return (
    <figure className="bubble" aria-label={UI.a11y.bubble}>
      <blockquote className="bubble__text">{lastAi.line.text}</blockquote>
      <figcaption className="bubble__meta">
        <span className="badge">{UI.source[lastAi.source]}</span>
      </figcaption>
    </figure>
  );
}
