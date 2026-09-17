"use client";

import { useEffect, useState } from "react";

import { parseProfileResponse } from "@/components/account/parse";
import type { MatchRecord, PlayerStats, ProfileResponse, Seat } from "@/game/realtime";
import { login, tokens } from "@/lib/auth";
import { UI } from "@/lib/lines";

type View =
  | { readonly kind: "loading" }
  | { readonly kind: "guest" }
  | { readonly kind: "failed" }
  | { readonly kind: "record"; readonly data: ProfileResponse };

/** A signed-in player with no finished match has no `player_stats` row yet. */
const NO_GAMES: Omit<PlayerStats, "id" | "name"> = {
  wins: 0,
  losses: 0,
  draws: 0,
  played: 0,
  streak: 0,
  bestStreak: 0,
  lastPlayedAt: null,
};

const relative = (finishedAt: number, now: number): string => {
  const minutes = Math.floor(Math.max(now - finishedAt, 0) / 60_000);
  if (minutes < 1) return UI.profile.ago.now;
  if (minutes < 60) return `${String(minutes)}${UI.profile.ago.minute}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}${UI.profile.ago.hour}`;
  return `${String(Math.floor(hours / 24))}${UI.profile.ago.day}`;
};

interface Played {
  readonly match: MatchRecord;
  readonly seat: Seat;
  readonly opponent: string;
  readonly outcome: "win" | "loss" | "draw";
}

const asPlayed = (match: MatchRecord, playerId: string): Played => {
  const seat: Seat = match.blackId === playerId ? "black" : "white";
  return {
    match,
    seat,
    opponent: seat === "black" ? match.whiteName : match.blackName,
    outcome: match.winner === null ? "draw" : match.winner === seat ? "win" : "loss",
  };
};

export function PlayerRecord() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const load = async (): Promise<void> => {
      const token = await tokens.accessToken();
      if (cancelled) return;
      if (token === null) {
        setView({ kind: "guest" });
        return;
      }

      try {
        const response = await fetch("/api/me", {
          headers: { accept: "application/json", authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (cancelled) return;
        /*
         * A rejected token is "not signed in" for this screen. The token store
         * is left alone on purpose: wiping the session here would hide a
         * provider-side problem behind what looks like a normal sign-out.
         */
        if (response.status === 401 || response.status === 403) {
          setView({ kind: "guest" });
          return;
        }
        if (!response.ok) {
          setView({ kind: "failed" });
          return;
        }
        const parsed = parseProfileResponse(await response.json());
        if (cancelled) return;
        setView(parsed === null ? { kind: "failed" } : { kind: "record", data: parsed });
      } catch {
        if (!cancelled) setView({ kind: "failed" });
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [attempt]);

  if (view.kind === "loading") {
    return <p className="page__pending" aria-hidden="true" />;
  }

  if (view.kind === "guest") {
    return (
      <section className="panel panel--prompt">
        <h2 className="panel__title">{UI.profile.guest.title}</h2>
        <p className="panel__body">{UI.profile.guest.body}</p>
        <button
          className="button"
          onClick={() => {
            login("/profile").catch(() => {
              setView({ kind: "failed" });
            });
          }}
          type="button"
        >
          {UI.profile.guest.cta}
        </button>
      </section>
    );
  }

  if (view.kind === "failed") {
    return (
      <section className="panel notice--error">
        <h2 className="panel__title">{UI.error.title}</h2>
        <p className="panel__body">{UI.error.server}</p>
        <button
          className="button"
          onClick={() => {
            setView({ kind: "loading" });
            setAttempt((n) => n + 1);
          }}
          type="button"
        >
          {UI.controls.retry}
        </button>
      </section>
    );
  }

  const { player, recent } = view.data;
  const stats = view.data.stats ?? { id: player.id, name: player.name, ...NO_GAMES };
  const now = Date.now();

  return (
    <>
      <section className="stats" aria-label={UI.profile.title}>
        <p className="stats__who">{player.name}</p>
        <dl className="stats__grid">
          <div className="stat stat--strong">
            <dt>{UI.profile.stats.wins}</dt>
            <dd>{stats.wins}</dd>
          </div>
          <div className="stat">
            <dt>{UI.profile.stats.losses}</dt>
            <dd>{stats.losses}</dd>
          </div>
          <div className="stat">
            <dt>{UI.profile.stats.draws}</dt>
            <dd>{stats.draws}</dd>
          </div>
          <div className="stat">
            <dt>{UI.profile.stats.played}</dt>
            <dd>{stats.played}</dd>
          </div>
          <div className="stat">
            <dt>{UI.profile.stats.streak}</dt>
            <dd>{stats.streak}</dd>
          </div>
          <div className="stat">
            <dt>{UI.profile.stats.bestStreak}</dt>
            <dd>{stats.bestStreak}</dd>
          </div>
        </dl>
      </section>

      <section className="matches" aria-labelledby="matches-heading">
        <h2 className="panel__heading" id="matches-heading">
          {UI.profile.recent.title}
        </h2>
        {recent.length === 0 ? (
          <p className="record__empty">{UI.profile.recent.empty}</p>
        ) : (
          <table className="matches__table">
            <thead>
              <tr>
                <th scope="col">{UI.profile.recent.opponent}</th>
                <th scope="col">{UI.profile.recent.seat}</th>
                <th scope="col">{UI.profile.recent.result}</th>
                <th className="matches__cell--wide" scope="col">
                  {UI.profile.recent.reason}
                </th>
                <th className="matches__cell--wide" scope="col">
                  {UI.profile.recent.plies}
                </th>
                <th scope="col">{UI.profile.recent.when}</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((match) => {
                const played = asPlayed(match, player.id);
                return (
                  <tr key={match.id}>
                    <td className="matches__opponent">{played.opponent}</td>
                    <td>
                      <span className="matches__seat" data-stone={played.seat} />
                      {played.seat === "black" ? UI.record.black : UI.record.white}
                    </td>
                    <td className="matches__outcome" data-outcome={played.outcome}>
                      {UI.profile.outcome[played.outcome]}
                    </td>
                    <td className="matches__cell--wide">{UI.profile.reason[match.reason]}</td>
                    <td className="matches__cell--wide">
                      {`${String(match.plies)}${UI.stat.move}`}
                    </td>
                    <td className="matches__when">{relative(match.finishedAt, now)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
