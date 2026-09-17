"use client";

import type { PlayerInfo, RoomSnapshot, Seat } from "@/game/realtime";
import { UI } from "@/lib/lines";
import type { Countdown } from "@/store/pvp";

import styles from "./pvp.module.css";

const SEATS: readonly Seat[] = ["black", "white"];
/** Below this the clock turns red; it is the last moment a player can react. */
const LOW_MS = 10_000;

const clockText = (ms: number): string => {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes)}:${seconds.toString().padStart(2, "0")}`;
};

interface PlayerSeatsProps {
  players: RoomSnapshot["players"];
  turn: Seat | null;
  clocks: Countdown;
  you: PlayerInfo | null;
}

export function PlayerSeats({ players, turn, clocks, you }: PlayerSeatsProps) {
  return (
    <section aria-labelledby="pvp-players">
      <h2 className="panel__heading" id="pvp-players">
        {UI.pvp.room.playersLabel}
      </h2>
      <ul className={styles.seats}>
        {SEATS.map((seat) => {
          const player = players[seat];
          const remaining = clocks[seat];
          const mine = player !== null && you !== null && player.id === you.id;

          return (
            <li
              className={styles.seat}
              data-low={remaining < LOW_MS}
              data-seat={seat}
              data-turn={turn === seat}
              key={seat}
            >
              <span aria-hidden="true" className={styles.seatStone} />
              <span className={styles.seatWho}>
                <span className={styles.seatName} data-empty={player === null}>
                  {player?.name ?? UI.pvp.room.emptySeat}
                </span>
                {mine ? <span className="badge">{UI.pvp.room.you}</span> : null}
                {player === null ? null : (
                  <>
                    <span
                      aria-hidden="true"
                      className={styles.presence}
                      data-on={player.connected}
                    />
                    <span className={styles.srOnly}>
                      {player.connected ? UI.pvp.room.connected : UI.pvp.room.disconnected}
                    </span>
                  </>
                )}
              </span>
              <span className={styles.seatClock}>
                <span className={styles.srOnly}>{`${UI.pvp.room.seat[seat]} `}</span>
                {clockText(remaining)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
