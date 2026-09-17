"use client";

import { useEffect, useState } from "react";

import { completeLogin, login, safeReturnTo } from "@/lib/auth";
import { UI } from "@/lib/lines";

/*
 * The provider redirects here with `code` and `state`. Nothing renders for
 * long: the exchange is one round trip, then the browser leaves.
 */

/**
 * The PKCE verifier is consumed by the first exchange, so a second call would
 * fail on a request that actually succeeded. React runs mount effects twice in
 * development, hence the module-level promise instead of a ref.
 */
let exchange: Promise<string | null> | null = null;

export default function AuthCallbackPage() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    exchange ??= completeLogin();
    exchange
      .then((returnTo) => {
        // `replace`, so the back button does not land on a spent code.
        if (!cancelled) window.location.replace(safeReturnTo(returnTo));
      })
      .catch(() => {
        exchange = null;
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!failed) {
    return (
      <main className="page page--center">
        <p className="page__waiting" role="status">
          {UI.auth.callback.waiting}
        </p>
      </main>
    );
  }

  return (
    <main className="page page--center">
      <section className="panel notice--error">
        <h1 className="panel__title">{UI.auth.callback.errorTitle}</h1>
        <p className="panel__body">{UI.auth.callback.errorBody}</p>
        <button
          className="button"
          onClick={() => {
            // The original `returnTo` died with the pending request, so retrying
            // starts a fresh login aimed at the landing screen.
            login("/").catch(() => {
              setFailed(true);
            });
          }}
          type="button"
        >
          {UI.auth.callback.retry}
        </button>
      </section>
    </main>
  );
}
