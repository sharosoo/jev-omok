"use client";

import Link from "next/link";
import { useState } from "react";

import { useAuth } from "@/lib/auth";
import { UI } from "@/lib/lines";

/**
 * Sign-in / signed-in-as control. Used both in the header and on the landing
 * screen, so it carries no layout of its own.
 */
export function AuthControl() {
  const { profile, status, login, logout } = useAuth();
  const [failed, setFailed] = useState(false);

  // The first paint cannot know whether a token is in storage; a placeholder of
  // the control's own width keeps the header from jumping once it does.
  if (status === "loading") {
    return <span className="auth auth--pending" aria-hidden="true" />;
  }

  if (profile === null) {
    return (
      <div className="auth">
        <span className="auth__guest">{UI.auth.guest}</span>
        <button
          className="button button--compact"
          onClick={() => {
            setFailed(false);
            // Resolves only if the redirect never happens.
            login().catch(() => {
              setFailed(true);
            });
          }}
          type="button"
        >
          {UI.auth.signIn}
        </button>
        {failed ? (
          <span className="auth__failed" role="alert">
            {UI.error.network}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="auth">
      <Link className="auth__me" href="/profile">
        <span aria-hidden="true" className="auth__initial">
          {[...profile.name][0] ?? "?"}
        </span>
        <span className="auth__name">{profile.name}</span>
      </Link>
      <button className="button button--ghost button--compact" onClick={logout} type="button">
        {UI.auth.signOut}
      </button>
    </div>
  );
}
