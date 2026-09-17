import Link from "next/link";

import { AuthControl } from "@/components/account/AuthControl";
import { BoardMotif } from "@/components/landing/BoardMotif";
import { Leaderboard } from "@/components/landing/Leaderboard";
import { APP_TITLE, UI } from "@/lib/lines";

/*
 * The entry screen, and the only one that gets to be cheap: it is a server
 * component and it never imports the 3D scene, so `/` paints without a WebGL
 * context, a `three` chunk, or a canvas the reader did not ask for.
 */

const ENTRIES = [
  { href: "/play", ...UI.landing.entries.ai },
  { href: "/pvp", ...UI.landing.entries.pvp },
  { href: "/profile", ...UI.landing.entries.profile },
] as const;

export default function LandingPage() {
  return (
    <main className="landing">
      <section className="hero">
        <div className="hero__copy">
          <h1 className="hero__title">{APP_TITLE}</h1>
          <p className="hero__tagline">{UI.landing.tagline}</p>
          <div className="hero__auth">
            <AuthControl />
          </div>
        </div>
        <BoardMotif />
      </section>

      <nav className="entries">
        {ENTRIES.map((entry) => (
          <Link className="entry" href={entry.href} key={entry.href}>
            <span className="entry__label">{entry.label}</span>
            <span className="entry__desc">{entry.desc}</span>
          </Link>
        ))}
      </nav>

      <Leaderboard />
    </main>
  );
}
