"use client";

import type { EndReason, Role, Seat } from "@/game/realtime";
import { UI } from "@/lib/lines";

import styles from "./pvp.module.css";

interface MatchOutcomeProps {
  winner: Seat | null;
  reason: EndReason;
  role: Role | null;
}

export function MatchOutcome({ winner, reason, role }: MatchOutcomeProps) {
  const playing = role === "black" || role === "white";
  const headline = !playing
    ? winner === null
      ? UI.pvp.room.over.draw
      : UI.pvp.room.over.winnerIs[winner]
    : winner === null
      ? UI.pvp.room.over.draw
      : winner === role
        ? UI.pvp.room.over.youWin
        : UI.pvp.room.over.youLose;

  return (
    <div className="notice notice--result" role="status">
      <h2 className="notice__title">{UI.pvp.room.over.title}</h2>
      <p className="notice__body">{headline}</p>
      <p className={styles.meta}>{UI.pvp.room.over.reason[reason]}</p>
    </div>
  );
}
