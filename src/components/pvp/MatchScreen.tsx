"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { ROOM_CODE_LENGTH } from "@/game/realtime";
import { UI } from "@/lib/lines";
import { usePvpStore } from "@/store/pvp";

import { MatchPanel } from "./MatchPanel";
import styles from "./pvp.module.css";

/*
 * The scene touches WebGL on import, so it must never be evaluated during the
 * static export. `ssr: false` is only legal inside a client component.
 */
const Board3D = dynamic(() => import("@/components/board3d/Board3D"), {
  ssr: false,
  loading: () => <div className="stage__loading" aria-hidden="true" />,
});

const CODE_PATTERN = new RegExp(`^[A-Z0-9]{${String(ROOM_CODE_LENGTH)}}$`);

/*
 * The export emits one shell for this route, so the code is never a build-time
 * param: it is read back off the address bar. The path is the real form
 * (`/pvp/ABC123`, rewritten to the shell by the Worker); the query form keeps
 * the page usable wherever that rewrite is not in front of it.
 */
const codeFromLocation = (location: Location): string | null => {
  const segment = (location.pathname.split("/").pop() ?? "").toUpperCase();
  if (CODE_PATTERN.test(segment)) return segment;

  const queried = new URLSearchParams(location.search).get("code")?.toUpperCase() ?? "";
  return CODE_PATTERN.test(queried) ? queried : null;
};

export function MatchScreen() {
  const [code, setCode] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);

  const board = usePvpStore((state) => state.board);
  const lastMove = usePvpStore((state) => state.lastMove);
  const winningLine = usePvpStore((state) => state.winningLine);
  const forbidden = usePvpStore((state) => state.forbidden);
  const snapshot = usePvpStore((state) => state.snapshot);
  const role = usePvpStore((state) => state.role);
  const connection = usePvpStore((state) => state.connection);
  const notFound = usePvpStore((state) => state.notFound);
  const place = usePvpStore((state) => state.place);
  const join = usePvpStore((state) => state.join);
  const leave = usePvpStore((state) => state.leave);

  useEffect(() => {
    setCode(codeFromLocation(window.location));
    setResolved(true);
  }, []);

  useEffect(() => {
    if (code === null) return;
    join(code);
    return leave;
  }, [code, join, leave]);

  if (resolved && code === null) return <MissingRoom />;
  if (notFound) return <MissingRoom />;

  const interactive =
    connection === "open" &&
    snapshot !== null &&
    (role === "black" || role === "white") &&
    snapshot.turn === role &&
    snapshot.status.winner === 0;

  return (
    <main className="stage">
      <section aria-label={UI.a11y.board} className="stage__board">
        <Board3D
          board={board}
          forbidden={forbidden}
          interactive={interactive}
          lastMove={lastMove}
          onPlace={place}
          seat={role === "white" ? 2 : 1}
          winningLine={winningLine}
        />
      </section>
      <MatchPanel code={code ?? ""} />
    </main>
  );
}

function MissingRoom() {
  return (
    <main className={styles.missing}>
      <p>{UI.pvp.room.notFound}</p>
      <a className={`button button--ghost ${styles.linkButton}`} href="/pvp">
        {UI.pvp.room.notFoundBack}
      </a>
    </main>
  );
}
