"use client";

import { useEffect, useRef, useState } from "react";

import { UI } from "@/lib/lines";

import styles from "./pvp.module.css";

const CONFIRM_MS = 2_000;

export function RoomCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = (): void => {
    void navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), CONFIRM_MS);
      },
      // A denied clipboard leaves the code on screen to select by hand.
      () => setCopied(false),
    );
  };

  return (
    <section aria-labelledby="pvp-code">
      <h2 className="panel__heading" id="pvp-code">
        {UI.pvp.room.codeLabel}
      </h2>
      <div className={styles.codeRow}>
        <output className={styles.codeValue}>{code}</output>
        <button
          className={`button button--ghost ${styles.copyButton}`}
          onClick={copy}
          type="button"
        >
          {UI.pvp.room.copy}
        </button>
      </div>
      <p aria-live="polite" className={styles.copied}>
        {copied ? UI.pvp.room.copied : ""}
      </p>
    </section>
  );
}
