# jev-omok

3D gomoku (오목) against an AI opponent, for `omok.sharosoo.com`.

The human plays black and moves first by clicking an intersection on a WebGL
board; the AI plays white. Tactics are decided by a deterministic engine,
non-forced moves and the AI's commentary by TypeSafe AI's **Jev** System One
model.

- Design, measurements and the Jev request contract: [docs/DESIGN.md](docs/DESIGN.md)
- Build status and remaining work: [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)

## Layout

```
app/                     Next.js App Router pages (static export)
src/
  components/board3d/    react-three-fiber board, stones, drop animation
  components/hud/        turn indicator, AI bubble, danger meter, controls
  store/game.ts          zustand client game state machine
  lib/api.ts             typed client for POST /api/move
  lib/lines.ts           all Korean copy (single source)
  game/protocol.ts       browser <-> worker wire contract
  engine/                board, shapes, candidates, VCF, difficulty, Jev adapter
  worker/index.ts        Hono Worker: /api/move, /api/health, assets fallback
```

## Setup

```bash
pnpm install
cp .dev.vars.example .dev.vars   # then put the TypeSafe key in TYPESAFE_API_KEY
cp .env.example .env             # CLOUDFLARE_API_TOKEN for deploys
```

`.dev.vars` and `.env` are gitignored. The TypeSafe key is read only inside the
Worker; it is never sent to the browser.

## Develop

Two processes: Next dev for the UI, `wrangler dev` for the API. `next.config.ts`
rewrites `/api/*` to `127.0.0.1:8787`, so the browser talks to the real Worker.

```bash
pnpm dev:worker    # wrangler dev on 8787 (needs ./out to exist: run pnpm build once)
pnpm dev           # next dev on 3000
```

```bash
pnpm test          # engine regression suite (vitest)
pnpm typecheck     # tsc --noEmit
pnpm build         # next build -> ./out (static export)
```

`GET /api/health` reports whether a Jev key is bound:

```bash
curl -s localhost:8787/api/health   # {"ok":true,"jev":true,"board":15}
```

## Deploy

```bash
printf '%s' "$TYPESAFE_API_KEY" | pnpm wrangler secret put TYPESAFE_API_KEY  # once
set -a; source .env; set +a
pnpm run deploy    # next build && wrangler deploy ('pnpm deploy' is a reserved pnpm command)
```

`wrangler.jsonc` binds the custom domain:

```jsonc
"routes": [{ "pattern": "omok.sharosoo.com", "custom_domain": true }]
```

Cloudflare provisions the DNS record and the certificate for a Worker custom
domain automatically. If `omok.sharosoo.com` already has a conflicting record
(an old tunnel CNAME, for example), delete it first or the domain will not
attach. A `Authentication error [10000]` at the end of a deploy usually means
the API token lacks `Workers Routes:Edit` — the script upload itself has already
succeeded at that point. The project's token hits exactly that, so the domain
was attached once through the account-level API instead, which the same token
is allowed to call:

```bash
curl -sX PUT "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/domains" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"environment":"production","hostname":"omok.sharosoo.com","service":"jev-omok","zone_id":"<sharosoo.com zone id>"}'
```

Once attached it stays attached, so later deploys only need `pnpm run deploy`
and the routes error at the end is cosmetic.

## Relationship to sharosoo-world

Standalone on purpose. `sharosoo-world` is a pnpm workspace built around Vite +
TanStack Router and the Astryx design system, and its `pnpm-workspace.yaml` does
not glob new app directories; a Next.js + react-three-fiber app would fight that
toolchain. The deploy conventions are followed instead: Worker + Assets binding
with `run_worker_first`, `custom_domain` routing, secrets via
`wrangler secret put`, `observability.enabled`, and the same Cloudflare account.

There is no login. If accounts are ever wanted, the path is the published
`@sharosoo/auth-client` package plus an `omok` audience registered in
`sharosoo-world` — the same route `artifact-hub` took.
