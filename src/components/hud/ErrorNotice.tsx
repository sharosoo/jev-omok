"use client";

import { UI } from "@/lib/lines";
import { useGameStore } from "@/store/game";

/**
 * The human's stone is already on the board when this shows, so the only thing
 * missing is the AI's answer: retry re-issues exactly that turn.
 */
export function ErrorNotice() {
  const error = useGameStore((state) => state.error);
  const requestAiMove = useGameStore((state) => state.requestAiMove);

  if (error === null) return null;

  return (
    <section className="notice notice--error" role="alert">
      <h2 className="notice__title">{UI.error.title}</h2>
      <p className="notice__body">{UI.error[error]}</p>
      <button className="button" onClick={requestAiMove} type="button">
        {UI.controls.retry}
      </button>
    </section>
  );
}
