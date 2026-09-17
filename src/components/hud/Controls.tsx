"use client";

import type { ChangeEvent } from "react";

import { UI } from "@/lib/lines";
import { DIFFICULTY_ORDER, RULE_ORDER, useGameStore } from "@/store/game";

export function Controls() {
  const rule = useGameStore((state) => state.rule);
  const difficulty = useGameStore((state) => state.difficulty);
  const moveCount = useGameStore((state) => state.moves.length);
  const setRule = useGameStore((state) => state.setRule);
  const setDifficulty = useGameStore((state) => state.setDifficulty);
  const newGame = useGameStore((state) => state.newGame);
  const undo = useGameStore((state) => state.undo);

  // The select hands back a plain string; match it against the known set.
  const onDifficulty = (event: ChangeEvent<HTMLSelectElement>) => {
    const picked = DIFFICULTY_ORDER.find((level) => level === event.target.value);
    if (picked !== undefined) setDifficulty(picked);
  };

  return (
    <section className="controls" aria-labelledby="controls-heading">
      <h2 className="panel__heading" id="controls-heading">
        {UI.difficulty.label}
      </h2>

      <select
        className="controls__select"
        aria-label={UI.difficulty.label}
        onChange={onDifficulty}
        value={difficulty}
      >
        {DIFFICULTY_ORDER.map((level) => (
          <option key={level} value={level}>
            {UI.difficulty.names[level]}
          </option>
        ))}
      </select>

      <h2 className="panel__heading" id="rule-heading">
        {UI.rule.label}
      </h2>
      <div className="controls__toggle" role="group" aria-labelledby="rule-heading">
        {RULE_ORDER.map((option) => (
          <button
            aria-pressed={option === rule}
            className="controls__toggleButton"
            key={option}
            onClick={() => {
              setRule(option);
            }}
            type="button"
          >
            {UI.rule.names[option]}
          </button>
        ))}
      </div>
      <p className="controls__help">{UI.rule.help[rule]}</p>

      <div className="controls__actions">
        <button className="button" onClick={newGame} type="button">
          {UI.controls.newGame}
        </button>
        <button
          className="button button--ghost"
          disabled={moveCount === 0}
          onClick={undo}
          type="button"
        >
          {UI.controls.undo}
        </button>
      </div>
    </section>
  );
}
