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
| Difficulty knobs | `src/engine/difficulty.ts` | temperature reshaping observed on live distributions |
| Jev adapter, annotation, parsing | `src/engine/jev.ts` | ~90 live calls; 20/21 on the forced-position suite |
| Decision pipeline | `src/engine/decide.ts` | 7 ladder tests; AI wins a full game in 28 plies |
| Worker API | `src/worker/index.ts` | `/api/health` + complete game played over HTTP |
| Korean copy | `src/lib/lines.ts` | composed by the naturalizer agent, all HUD keys present |
| Deploy config | `wrangler.jsonc`, `next.config.ts` | `wrangler dev` boots with assets + secret bindings |
| Client game state and turn machine | `src/store/game.ts` | 6 unit tests (`src/store/game.test.ts`): undo parity, lone-stone undo, click ignored while thinking, stale reply never lands, local win with zero API calls + browser: `localStorage` restore and corrupt-value tolerance |
| Move API client | `src/lib/api.ts` | 10 unit tests (`src/lib/api.test.ts`): one retry on 5xx/network, no retry on 4xx or timeout, `ErrorResponse` surfaced, off-contract payloads rejected by the guard + browser: retry recovers the turn |
| App shell and HUD | `app/**`, `src/components/hud/**` | browser at 1366px and 390px: turn/thinking, AI line + source badge, danger meter (`null` renders empty, not 0), controls, 기보 notation, game-over panel |

Engine suite: **29 tests passing**, 175 ms. Frontend suite: **16 tests passing**, 1.3 s.

## In progress

| Area | Owner | Contract |
| --- | --- | --- |
| 3D board scene, stone drop animation, hover ghost, win highlight | `Board3D` agent | `Board3DProps` in `src/components/board3d/Board3D.tsx` |

## Remaining after the frontend lands

1. `pnpm build` must produce `./out` — the placeholder `out/index.html` written
   for the `wrangler dev` smoke test gets replaced by the real export.
2. Browser end-to-end: play a full game in a real tab, confirm the drop
   animation, the danger meter tracking `danger`, the AI line changing with the
   position, undo, difficulty switching, and the win highlight.
3. `wrangler secret put TYPESAFE_API_KEY`, then `pnpm deploy`, then verify
   `https://omok.sharosoo.com/api/health` returns `{"jev":true}` and play one
   game against production.

## Deliberately not built

| Not built | Why | Cost to add later |
| --- | --- | --- |
| Renju rules (asymmetric 33/44/overline for black) | confuses casual players; `freestyle` + symmetric `double_three_ban` cover the audience | one `RuleSet` value + one predicate in `rules.ts` |
| Alpha-beta / PVS search with a transposition table | the forced ladder plus VCF plus Jev already beats a greedy baseline; a full search would make Jev decorative | new module behind the same `decideMove` step |
| VCT (victory by continuous threat) | wider tree than VCF for a casual opponent | same shape as `vcf.ts` |
| 26-opening book | a real book needs the 8-fold symmetry canonicalisation to be worth the bytes | `openingMove` is already isolated |
| D1 game archive, replay URLs | no product need yet; the Worker is stateless and the client persists locally | one table, one insert at game end |
| Accounts | no per-user state to protect | `@sharosoo/auth-client` + an `omok` audience in `sharosoo-world` |
| Durable Objects / multiplayer | single-player vs AI | DO per room + WebSocket |

## Guard rails worth keeping

- Anything computable from the board is computed, never asked of Jev. The one
  question that violated this (`human_blundered`) measured 0.84 vs 0.67 between
  a real blunder and a correct block, and was deleted.
- Jev options must mention every fact the priority order refers to. Dropping the
  fork flags cost 3/3 on the fork-denial position.
- Candidate lists stay near 12. At 30 the suite fell from 14/14 to 12/14.
- Forced tactics never reach Jev. On a bare board it blocked instead of winning
  in 3/3 trials of the "win beats block" position.
