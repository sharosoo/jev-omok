"use client";

import { useEffect, useState } from "react";

import { parseLeaderboard } from "@/components/account/parse";
import type { PlayerStats } from "@/game/realtime";
import { UI } from "@/lib/lines";

const TOP = 5;

/**
 * Top players on the landing screen. A ranking is decoration on an entry
 * screen, so every failure — offline, 500, empty table — renders nothing at
 * all rather than an error the reader cannot act on.
 */
export function Leaderboard() {
  const [rows, setRows] = useState<readonly PlayerStats[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    const load = async (): Promise<void> => {
      try {
        const response = await fetch("/api/leaderboard", {
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) return;
        const body: unknown = await response.json();
        const parsed = parseLeaderboard(body);
        if (parsed !== null) setRows(parsed.rows.slice(0, TOP));
      } catch {
        // Includes the abort on unmount. Nothing to show either way.
      }
    };

    void load();
    return () => {
      controller.abort();
    };
  }, []);

  if (rows.length === 0) return null;

  return (
    <section className="ranks" aria-labelledby="ranks-heading">
      <h2 className="panel__heading" id="ranks-heading">
        {UI.landing.leaderboard.title}
      </h2>
      <p className="ranks__caption">{UI.landing.leaderboard.caption}</p>
      <ol className="ranks__list">
        {rows.map((row, index) => (
          <li className="ranks__item" key={row.id}>
            <span className="ranks__place">{index + 1}</span>
            <span className="ranks__name">{row.name}</span>
            <span className="ranks__score">
              {`${String(row.wins)}${UI.stat.win} ${String(row.losses)}${UI.stat.loss}`}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
