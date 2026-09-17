# Implementation status

Every item is either done and verified, or listed with what is missing. No item
is marked done on the strength of code existing — the verification column says
how it was checked.

## Done

| Area | Files | Verified by |
| --- | --- | --- |
| Wire contract | `src/game/protocol.ts` | consumed by worker, store, api client |
| Shape classifier | `src/engine/patterns.ts` | 7 unit tests incl. broken four, split three, blocked three |
| Rules, notation, history validation | `src/engine/rules.ts` | 11 unit tests: five-or-more, diagonals, 33 금수, illegal histories |
| Candidate generation and static eval | `src/engine/candidates.ts` | 1 unit test (radius, emptiness, ordering) + full games |
| VCF search | `src/engine/vcf.ts` | 3 unit tests incl. board-restoration; finds open-four wins |
| Alpha-beta search + incremental eval | `src/engine/search.ts`, `src/engine/evaluate.ts` | 11 unit tests incl. the delta-eval identity, mate ordering, node ceiling; 6 games/level vs a club baseline |
| Difficulty knobs | `src/engine/difficulty.ts` | temperature reshaping observed on live distributions |
| Jev adapter, annotation, parsing | `src/engine/jev.ts` | ~90 live calls; 20/21 on the forced-position suite |
| Decision pipeline | `src/engine/decide.ts` | 7 ladder tests; AI wins a full game in 28 plies |
| Worker API | `src/worker/index.ts` | `/api/health` + complete game played over HTTP |
| Korean copy | `src/lib/lines.ts` | composed by the naturalizer agent, all HUD keys present |
| Deploy config | `wrangler.jsonc`, `next.config.ts` | `wrangler dev` boots with assets, secret, DO and D1 bindings |
| PvP wire contract | `src/game/realtime.ts` | consumed unchanged by the room, the lobby, the socket client and the store |
| Match room (authoritative) | `src/worker/room.ts` | 17 protocol assertions in `scripts/test-pvp.mjs` against `wrangler dev` |
| Matchmaking lobby | `src/worker/lobby.ts` | FIFO seats, tickets and reserved identities asserted in the same script |
| Match records and stats | `migrations/0001_matches.sql`, D1 `DB` binding | finished guest match read back from local D1; `player_stats` correctly empty for guests |
| Auth (worker side) | `src/worker/auth.ts`, `src/worker/index.ts` | `/api/me` 401 guest, `/api/players/:id` 404 unknown |
| Auth (browser side) | `src/lib/auth.ts` | 3 tests incl. the open-redirect guard; authorize URL carries PKCE, resource and scopes |
| Landing, profile, header | `app/page.tsx`, `app/profile`, `src/components/{landing,account}` | rendered in a browser; landing ships no WebGL canvas |
| PvP screens | `app/pvp`, `src/components/pvp`, `src/store/pvp.ts`, `src/lib/realtime.ts` | 17 tests; lobby rendered in a browser; `/pvp/ABC123` serves the room shell |
| Client game state and turn machine | `src/store/game.ts` | 6 unit tests (`src/store/game.test.ts`): undo parity, lone-stone undo, click ignored while thinking, stale reply never lands, local win with zero API calls + browser: `localStorage` restore and corrupt-value tolerance |
| Move API client | `src/lib/api.ts` | 10 unit tests (`src/lib/api.test.ts`): one retry on 5xx/network, no retry on 4xx or timeout, `ErrorResponse` surfaced, off-contract payloads rejected by the guard + browser: retry recovers the turn |
| App shell and HUD | `app/**`, `src/components/hud/**` | browser at 1366px and 390px: turn/thinking, AI line + source badge, danger meter (`null` renders empty, not 0), controls, 기보 notation, game-over panel |

Suite: **76 tests passing**, 1.4 s. Frontend suite: **16 tests passing**, 1.3 s.

## In progress

| Area | Owner | Contract |
| --- | --- | --- |
| 3D board scene, stone drop animation, hover ghost, win highlight | `Board3D` agent | `Board3DProps` in `src/components/board3d/Board3D.tsx` |

## Remaining

1. Register the OIDC client so sign-in actually works. The provider patch is
   committed in `sharosoo-world` on branch `feat/omok-oidc-client` (audience
   `omok`, scopes `omok:read`/`omok:write`, clients `omok-web` and
   `omok-web-dev`). Applying it means deploying `auth.sharosoo.com` and seeding
   its D1 — shared infrastructure, so it waits for an explicit go.
2. Apply the match schema to remote D1 and deploy:
   `pnpm wrangler d1 migrations apply jev-omok --remote` then `pnpm run deploy`.
   The deploy carries DO migration tag `v1` (`new_sqlite_classes`), which is
   append-only — never edit that entry afterwards.
3. Play one real PvP match against production from two browsers and confirm a
   `matches` row plus two `player_stats` upserts for signed-in players.

## Deliberately not built

| Not built | Why | Cost to add later |
| --- | --- | --- |
| Renju rules (asymmetric 33/44/overline for black) | confuses casual players; `freestyle` + symmetric `double_three_ban` cover the audience | one `RuleSet` value + one predicate in `rules.ts` |
| Transposition table, iterative deepening, per-node move generation | the depth-6 search already goes 3-0-3 against the baseline at 2.1 ms/turn; per-node generation costs 0.59 ms/node and is what caps useful depth | `search.ts` would gain a Zobrist table and a cheap incremental generator |
| VCT (victory by continuous threat) | wider tree than VCF for a casual opponent | same shape as `vcf.ts` |
| 26-opening book | a real book needs the 8-fold symmetry canonicalisation to be worth the bytes | `openingMove` is already isolated |
| Spectator-only rooms, tournaments, rating (ELO) | the record keeps wins/losses/streaks, which is what a casual player reads; a rating needs a pool big enough to mean something | `player_stats` already carries the write path |
| Guest match history | guests have no persistent identity; their games archive to `matches` but nothing points at them | a claim flow on first sign-in |

## Guard rails worth keeping

- Anything computable from the board is computed, never asked of Jev. The one
  question that violated this (`human_blundered`) measured 0.84 vs 0.67 between
  a real blunder and a correct block, and was deleted.
- Jev options must mention every fact the priority order refers to. Dropping the
  fork flags cost 3/3 on the fork-denial position.
- Candidate lists stay near 12. At 30 the suite fell from 14/14 to 12/14.
- Forced tactics never reach Jev. On a bare board it blocked instead of winning
  in 3/3 trials of the "win beats block" position.
