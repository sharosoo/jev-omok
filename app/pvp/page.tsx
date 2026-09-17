"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import styles from "@/components/pvp/pvp.module.css";
import type { RuleSet } from "@/game/protocol";
import type { QueueClientMessage } from "@/game/realtime";
import { ROOM_CODE_LENGTH } from "@/game/realtime";
import { tokens, useAuth } from "@/lib/auth";
import { UI } from "@/lib/lines";
import type { SocketHandle } from "@/lib/realtime";
import { connectQueue, createRoom } from "@/lib/realtime";
import { RULE_ORDER } from "@/store/game";
import { readGuestName, rememberSeat, saveGuestName } from "@/store/pvp";

/*
 * Hard navigation on purpose: `/pvp/<code>` is served by a shell the export
 * emitted for one placeholder param, so the App Router has no RSC payload to
 * fetch for a real code.
 *
 * `next dev` refuses any param `generateStaticParams()` did not return while
 * `output: "export"` is on, so development addresses the shell directly and
 * passes the code alongside. The built site has the Worker rewrite in front of
 * it and uses the readable form.
 */
const enterRoom = (code: string): void => {
  window.location.assign(
    process.env.NODE_ENV === "production" ? `/pvp/${code}` : `/pvp/room?code=${code}`,
  );
};

export default function PvpLobbyPage() {
  const { profile, status } = useAuth();
  const [guestName, setGuestName] = useState("");
  const [rule, setRule] = useState<RuleSet>("freestyle");

  const queue = useRef<SocketHandle<QueueClientMessage> | null>(null);
  const [searching, setSearching] = useState(false);
  const [position, setPosition] = useState<number | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createFailed, setCreateFailed] = useState(false);

  const [code, setCode] = useState("");
  const [codeInvalid, setCodeInvalid] = useState(false);

  // localStorage is unreachable during the export, so the saved nickname and
  // the cached profile can only be read once the page is in a browser.
  useEffect(() => {
    setGuestName(readGuestName());
  }, []);

  useEffect(() => () => queue.current?.close(), []);

  const guest = status !== "signed-in";
  const chosenName = guestName.trim();

  const identity = async (): Promise<{ token: string | null; guestName: string }> => {
    const token = await tokens.accessToken().catch(() => null);
    if (token === null) saveGuestName(chosenName);
    return {
      token,
      guestName: chosenName === "" ? UI.pvp.lobby.guestFallbackName : chosenName,
    };
  };

  const stopQueue = (): void => {
    queue.current?.send({ t: "cancel" });
    queue.current?.close();
    queue.current = null;
    setSearching(false);
    setPosition(null);
  };

  const startQueue = (): void => {
    if (searching) return;
    setSearching(true);
    setPosition(null);
    setQueueError(null);

    void (async () => {
      const who = await identity();
      queue.current = connectQueue({
        token: who.token,
        guestName: who.guestName,
        onMessage: (message) => {
          if (message.t === "waiting") {
            setPosition(message.position);
            return;
          }
          if (message.t === "matched") {
            // The ticket is the seat the lobby promised; the room only honours
            // it when the very first hello presents it.
            rememberSeat(message.code, message.ticket);
            queue.current?.close();
            queue.current = null;
            enterRoom(message.code);
            return;
          }
          setQueueError(UI.pvp.error[message.code]);
          stopQueue();
        },
        onClose: (info) => {
          if (!info.permanent) return;
          setQueueError(UI.pvp.error.network);
          setSearching(false);
        },
      });
    })();
  };

  const create = (): void => {
    if (creating) return;
    setCreating(true);
    setCreateFailed(false);

    void (async () => {
      try {
        const who = await identity();
        enterRoom(await createRoom(rule, who.token));
      } catch {
        setCreateFailed(true);
        setCreating(false);
      }
    })();
  };

  const join = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (code.length !== ROOM_CODE_LENGTH) {
      setCodeInvalid(true);
      return;
    }
    if (guest) saveGuestName(chosenName);
    enterRoom(code);
  };

  const onCode = (event: ChangeEvent<HTMLInputElement>): void => {
    setCodeInvalid(false);
    setCode(
      event.target.value
        .replace(/[^0-9a-z]/gi, "")
        .toUpperCase()
        .slice(0, ROOM_CODE_LENGTH),
    );
  };

  return (
    <main aria-label={UI.pvp.a11y.lobby} className={styles.lobby}>
      <div className={styles.lobbyInner}>
        <header>
          <h1 className={styles.lobbyTitle}>{UI.pvp.lobby.title}</h1>
          <p className={styles.lobbyLead}>{UI.pvp.lobby.subtitle}</p>
        </header>

        <div className={styles.identity}>
          {guest ? (
            <div className={`${styles.field} ${styles.identityField}`}>
              <label className={styles.fieldLabel} htmlFor="pvp-guest-name">
                {UI.pvp.lobby.guestLabel}
              </label>
              <input
                className={styles.input}
                id="pvp-guest-name"
                maxLength={16}
                onChange={(event) => setGuestName(event.target.value)}
                placeholder={UI.pvp.lobby.guestPlaceholder}
                value={guestName}
              />
              <p className={styles.cardHelp}>{UI.pvp.lobby.guestHint}</p>
            </div>
          ) : (
            <p className={styles.cardHelp}>
              {`${UI.pvp.lobby.signedInAs} `}
              <span className={styles.identityName}>{profile?.name ?? ""}</span>
            </p>
          )}
        </div>

        <div className={styles.cards}>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>{UI.pvp.lobby.quick.title}</h2>
            <p className={styles.cardHelp}>{UI.pvp.lobby.quick.help}</p>
            {searching ? (
              <p aria-live="polite" className={styles.searching}>
                {UI.pvp.lobby.quick.searching}
                {position === null ? null : (
                  <span className={styles.queueNumber}>
                    {`${UI.pvp.lobby.quick.positionLabel} ${String(position)}`}
                  </span>
                )}
              </p>
            ) : null}
            {queueError === null ? null : <p className={styles.formError}>{queueError}</p>}
            <div className={styles.actions}>
              {searching ? (
                <button className="button button--ghost" onClick={stopQueue} type="button">
                  {UI.pvp.lobby.quick.cancel}
                </button>
              ) : (
                <button className="button" onClick={startQueue} type="button">
                  {UI.pvp.lobby.quick.start}
                </button>
              )}
            </div>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>{UI.pvp.lobby.create.title}</h2>
            <p className={styles.cardHelp}>{UI.pvp.lobby.create.help}</p>
            <div className="controls__toggle" aria-label={UI.rule.label} role="group">
              {RULE_ORDER.map((option) => (
                <button
                  aria-pressed={option === rule}
                  className="controls__toggleButton"
                  key={option}
                  onClick={() => setRule(option)}
                  type="button"
                >
                  {UI.rule.names[option]}
                </button>
              ))}
            </div>
            <p className={styles.cardHelp}>{UI.rule.help[rule]}</p>
            {createFailed ? <p className={styles.formError}>{UI.pvp.lobby.create.failed}</p> : null}
            <div className={styles.actions}>
              <button className="button" disabled={creating} onClick={create} type="button">
                {UI.pvp.lobby.create.action}
              </button>
            </div>
          </section>

          <form className={styles.card} onSubmit={join}>
            <h2 className={styles.cardTitle}>{UI.pvp.lobby.join.title}</h2>
            <p className={styles.cardHelp}>{UI.pvp.lobby.join.help}</p>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="pvp-code">
                {UI.pvp.lobby.join.label}
              </label>
              <input
                autoComplete="off"
                className={`${styles.input} ${styles.codeInput}`}
                id="pvp-code"
                inputMode="text"
                onChange={onCode}
                placeholder={UI.pvp.lobby.join.placeholder}
                spellCheck={false}
                value={code}
              />
            </div>
            {codeInvalid ? <p className={styles.formError}>{UI.pvp.lobby.join.invalid}</p> : null}
            <div className={styles.actions}>
              <button className="button" type="submit">
                {UI.pvp.lobby.join.action}
              </button>
            </div>
          </form>
        </div>

        <nav className={styles.crumbs}>
          <a href="/">{UI.pvp.lobby.homeLink}</a>
        </nav>
      </div>
    </main>
  );
}
