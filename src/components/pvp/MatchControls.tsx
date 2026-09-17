"use client";

import { useState } from "react";

import type { Role, Seat } from "@/game/realtime";
import { UI } from "@/lib/lines";

import styles from "./pvp.module.css";

interface MatchControlsProps {
  role: Role | null;
  /** True while the match can still receive a move. */
  live: boolean;
  /** True once the match has a result. A room still waiting for an opponent is
   * neither live nor over, and must offer neither control. */
  over: boolean;
  rematchSent: boolean;
  rematchOfferBy: Seat | null;
  onResign: () => void;
  onRematch: () => void;
}

export function MatchControls({
  role,
  live,
  over,
  rematchSent,
  rematchOfferBy,
  onResign,
  onRematch,
}: MatchControlsProps) {
  const [confirming, setConfirming] = useState(false);
  const playing = role === "black" || role === "white";

  return (
    <div className={styles.stacked}>
      {playing && live ? (
        confirming ? (
          <div className={styles.actions}>
            <button
              className="button"
              onClick={() => {
                setConfirming(false);
                onResign();
              }}
              type="button"
            >
              {UI.pvp.room.resignConfirm}
            </button>
            <button
              className="button button--ghost"
              onClick={() => setConfirming(false)}
              type="button"
            >
              {UI.pvp.room.resignCancel}
            </button>
          </div>
        ) : (
          <button
            className="button button--ghost"
            onClick={() => setConfirming(true)}
            type="button"
          >
            {UI.pvp.room.resign}
          </button>
        )
      ) : null}

      {playing && over ? (
        <>
          <button className="button" disabled={rematchSent} onClick={onRematch} type="button">
            {UI.pvp.room.rematch}
          </button>
          {rematchSent ? <p className={styles.meta}>{UI.pvp.room.rematchSent}</p> : null}
          {rematchOfferBy !== null && !rematchSent ? (
            <p className={styles.meta}>{UI.pvp.room.rematchIncoming}</p>
          ) : null}
        </>
      ) : null}

      <a className={`button button--ghost ${styles.linkButton}`} href="/pvp">
        {UI.pvp.room.leave}
      </a>
    </div>
  );
}
