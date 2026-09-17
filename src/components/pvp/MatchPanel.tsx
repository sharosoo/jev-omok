"use client";

import { UI } from "@/lib/lines";
import { usePvpStore } from "@/store/pvp";

import { ConnectionBanner } from "./ConnectionBanner";
import { MatchControls } from "./MatchControls";
import { MatchOutcome } from "./MatchOutcome";
import { MoveList } from "./MoveList";
import { PlayerSeats } from "./PlayerSeats";
import { RoomCode } from "./RoomCode";
import styles from "./pvp.module.css";

export function MatchPanel({ code }: { code: string }) {
  const snapshot = usePvpStore((state) => state.snapshot);
  const role = usePvpStore((state) => state.role);
  const you = usePvpStore((state) => state.you);
  const connection = usePvpStore((state) => state.connection);
  const clocks = usePvpStore((state) => state.clocks);
  const error = usePvpStore((state) => state.error);
  const rematchSent = usePvpStore((state) => state.rematchSent);
  const rematchOfferBy = usePvpStore((state) => state.rematchOfferBy);
  const resign = usePvpStore((state) => state.resign);
  const rematch = usePvpStore((state) => state.rematch);
  const retry = usePvpStore((state) => state.retry);

  const live = snapshot !== null && snapshot.turn !== null && snapshot.endReason === null;
  const yourTurn =
    snapshot !== null && (role === "black" || role === "white") && snapshot.turn === role;
  const turnText =
    snapshot === null || snapshot.turn === null
      ? null
      : role === "black" || role === "white"
        ? yourTurn
          ? UI.pvp.room.turnYours
          : UI.pvp.room.turnTheirs
        : UI.pvp.room.turnOf[snapshot.turn];
  const waiting =
    snapshot !== null && (snapshot.players.black === null || snapshot.players.white === null);

  return (
    <aside aria-label={UI.pvp.a11y.panel} className="hud">
      <div className="hud__status">
        <ConnectionBanner onRetry={retry} state={connection} />

        {error === null ? null : (
          <div className="notice notice--error" role="alert">
            <p className={styles.meta}>{UI.pvp.error[error]}</p>
          </div>
        )}

        {snapshot !== null && snapshot.endReason !== null ? (
          <MatchOutcome reason={snapshot.endReason} role={role} winner={snapshot.winner} />
        ) : null}

        {turnText === null ? null : (
          <p className={styles.turnLine} data-yours={yourTurn}>
            {turnText}
          </p>
        )}

        {role === "spectator" ? <span className="badge">{UI.pvp.room.spectatingBadge}</span> : null}
        {waiting ? <p className={styles.meta}>{UI.pvp.room.waitingOpponent}</p> : null}
      </div>

      {snapshot === null ? null : (
        <PlayerSeats
          clocks={clocks}
          players={snapshot.players}
          turn={snapshot.turn}
          you={you}
        />
      )}

      <MatchControls
        live={live}
        over={snapshot !== null && snapshot.endReason !== null}
        onRematch={rematch}
        onResign={resign}
        rematchOfferBy={rematchOfferBy}
        rematchSent={rematchSent}
        role={role}
      />

      <RoomCode code={code} />

      {snapshot === null || snapshot.spectators === 0 ? null : (
        <p className={styles.meta}>{`${UI.pvp.room.spectatorsLabel} ${String(snapshot.spectators)}`}</p>
      )}

      <MoveList moves={snapshot?.moves ?? []} />
    </aside>
  );
}
