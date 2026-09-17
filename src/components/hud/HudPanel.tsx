"use client";

import { UI } from "@/lib/lines";
import { useGameStore } from "@/store/game";

import { AiBubble } from "./AiBubble";
import { Controls } from "./Controls";
import { DangerMeter } from "./DangerMeter";
import { ErrorNotice } from "./ErrorNotice";
import { GameOverPanel } from "./GameOverPanel";
import { MoveRecord } from "./MoveRecord";
import { TurnIndicator } from "./TurnIndicator";

export function HudPanel() {
  const isFresh = useGameStore((state) => state.moves.length === 0 && state.phase !== "over");

  return (
    <aside aria-label={UI.a11y.hud} className="hud">
      <div className="hud__status">
        <TurnIndicator />
        <GameOverPanel />
        <ErrorNotice />
        {isFresh ? <p className="hud__hint">{UI.hint}</p> : <AiBubble />}
      </div>
      <DangerMeter />
      <Controls />
      <MoveRecord />
    </aside>
  );
}
