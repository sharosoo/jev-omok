"use client";

import { UI } from "@/lib/lines";
import type { ConnectionState } from "@/lib/realtime";

import styles from "./pvp.module.css";

interface ConnectionBannerProps {
  state: ConnectionState;
  onRetry: () => void;
}

export function ConnectionBanner({ state, onRetry }: ConnectionBannerProps) {
  if (state === "open") return null;

  const closed = state === "closed";
  const text =
    state === "connecting"
      ? UI.pvp.connection.connecting
      : closed
        ? UI.pvp.connection.closed
        : UI.pvp.connection.reconnecting;

  return (
    <div aria-live="polite" className="notice" role="status">
      <p className={styles.meta}>{text}</p>
      {closed ? (
        <button className="button button--ghost" onClick={onRetry} type="button">
          {UI.pvp.connection.retry}
        </button>
      ) : null}
    </div>
  );
}
