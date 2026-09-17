import Link from "next/link";

import { AuthControl } from "@/components/account/AuthControl";
import { APP_TITLE, UI } from "@/lib/lines";

/*
 * Persistent on every route, so it stays a server component: the account
 * control is the only part that needs the client bundle.
 */
export function SiteHeader() {
  return (
    <header className="app__header">
      <Link className="brand" href="/">
        {APP_TITLE}
      </Link>
      <nav className="nav">
        <Link className="nav__link" href="/play">
          {UI.landing.nav.play}
        </Link>
        <Link className="nav__link" href="/pvp">
          {UI.landing.nav.pvp}
        </Link>
        {/* A guest is not dead-ended here: /profile explains what signing in keeps. */}
        <Link className="nav__link nav__link--wide" href="/profile">
          {UI.landing.nav.profile}
        </Link>
      </nav>
      <AuthControl />
    </header>
  );
}
