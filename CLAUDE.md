# Working on FourFold

Orientation for a new session. **[README.md](README.md) explains how the system
works** — this file covers what the README doesn't: the live environment, the
conventions, and the mistakes already made so they aren't made again.

## What this is

A private football competition for seven friends, based on the six matches Sky
Super 6 picks each round. Players back five of the six as five £1 fourfolds
(£5 a round). The site is the permanent record: rounds import themselves from
Super 6, and when someone wins, an admin types one number into `/admin`.

Read [README.md § The game](README.md#the-game) before touching anything that
calculates money. In particular: the admin enters the **return** (what the
bookmaker paid back), not the profit, and standings rank on **total returns**,
which is the competition's long-standing rule — don't "improve" it.

## Related repositories

- **`matbroughty/fffc`** — the *old* static site, still serving production
  `fourfold.co.uk`. Plain HTML/Bulma with standings hardcoded per season. Not
  deployed from here. Also cloned at `~/IdeaProjects/fffc`.
- **`~/claude-gsd/ttlp-react`** — an unrelated project (Tim's Twitter Listening
  Party) that happens to sit next door. Nothing to do with FourFold.

## Live environment

| | |
| --- | --- |
| Amplify app | `fourfold-react`, appId **`dl1ttg477pxdt`**, region **`eu-west-2`** |
| Branch | `main` → **`new.fourfold.co.uk`** (staging), autoBuild on |
| Production | `fourfold.co.uk` — still the OLD static site. Untouched. |
| Service role | `AMPLIFY_ASSUME`, with `AdministratorAccess-Amplify` |
| Secrets | `/fourfold/admin-password-hash`, `/fourfold/token-secret` (SSM SecureString) |

Each Amplify branch gets its own DynamoDB table, Lambdas and API Gateway, so
never assume one table. Look them up:

```bash
aws dynamodb list-tables --region eu-west-2 | grep -i fourfold
aws apigatewayv2 get-apis --region eu-west-2 --query "Items[?Name=='FourFoldHttpApi']"
aws lambda list-functions --region eu-west-2 \
  --query "Functions[?contains(FunctionName,'FourFold')].FunctionName"
```

A personal sandbox stack may also exist (`npx ampx sandbox`). Its table has
`removalPolicy: RETAIN`, so `ampx sandbox delete` leaves it behind — check for
orphans before assuming a table is live.

## Conventions

- **Push straight to `main`.** Amplify runs `npm test` then builds, so a failing
  test blocks the deploy rather than shipping a broken site.
- **Every push redeploys `new.fourfold.co.uk`.** That is staging, so it's fine —
  but it is a real site someone may be looking at.
- **Never change production DNS.** The cut-over is a deliberate manual step,
  written up in [docs/cutover.md](docs/cutover.md).
- **Money is integer pence everywhere.** No floats, ever. Use
  `shared/domain/money.ts`; don't hand-roll parsing or `toFixed` arithmetic.
- **Sky's API is touched in exactly two files** — `shared/super6/client.ts` and
  `shared/super6/normalize.ts`. Keep it that way so the provider stays swappable.
- Before changing history or money code, run `npm test`: the real season totals
  are asserted in `shared/migration/csv.test.ts` and will catch damage.

## Traps — all of these have already bitten

Each one cost real debugging. The tests that guard them are noted; don't delete
those tests.

1. **Super 6 round ids restart every season.** `roundId` alone is not unique —
   2026/27 round 1 collides with 2025/26 round 1. Rounds are keyed
   `"{season}:{roundId}"`. Sky also serves *only* the current season, which is why
   local persistence is the whole point.
2. **`scoreChallenges[].id` is not a 1–6 position.** It increments across the
   season with gaps (round 2 uses 8–13, round 3 uses 15–20). We store it as
   `externalChallengeId` and assign our own `position`.
3. **Sky sends `score: 0` before kick-off.** Passing it through makes every
   unplayed fixture look like a 0–0 draw. Scores are `null` unless live or finished.
4. **`JSON.stringify` broke sync idempotency.** It preserves insertion order;
   DynamoDB returns attributes in its own order, so every round compared as
   changed and the sync rewrote the whole season every 3 hours. Use
   `stableStringify` in `server/src/sync.ts`. The in-memory repository cannot
   catch this — the regression test uses one that reverses keys on read.
5. **Stake is only charged for rounds that have started.** Super 6 announces
   future rounds, and counting them showed everyone £15 down before a ball was
   kicked. See `hasRoundStarted`.
6. **The home page must not lead with the highest-numbered round.** Same reason;
   use `pickCurrentRound` in `shared/domain/rounds.ts`.
7. **The sync Lambda has no SSM access, by design.** It authenticates nobody, so
   it must call `loadSyncConfig()`, not `loadConfig()`. Calling the latter crashes
   it with AccessDenied on every scheduled run.
8. **Public Lambda Function URLs are blocked in this AWS account.** With
   `authType: NONE` and a policy allowing `Principal: "*"`, requests still return
   `AccessDeniedException`, and there is no Organization SCP explaining it. Hence
   the API Gateway HTTP API. Don't "simplify" back to a Function URL without
   testing it first.
9. **Amplify's default `/<*>` → `/index.html` `404-200` rewrite doesn't work.**
   `/admin` gets 301'd to `/admin/` first and then serves index.html with a 404.
   The working rule is the extensionless-path regex in
   [README § Deployment](README.md#first-time).

## Data integrity

Five historical seasons (£6,965.70) are committed in `data/history/` and
asserted by tests. **Read [docs/data-provenance.md](docs/data-provenance.md)
before touching them** — it records the one repair made, and what is genuinely
missing:

- **2021-22 does not exist.** Don't invent it.
- **2025-26 stops at 38 rounds** though the season ran to May 2026. The last ~12
  rounds are unrecorded anywhere. If they turn up, append to the CSV and re-run
  the migration.
- **Imported seasons have no fixtures** — the CSVs record returns only. Never
  fabricate teams, dates or scores for them.
- **Rosters change.** 2020-21 had five players including Taz. Stakes come from
  each season's own `playerIds`.

## Quick commands

```bash
npm run dev:api      # local API on :3000, seeded with real history + a live sync
npm run dev          # SPA (Vite proxies /api to :3000)
npm test             # 194 tests
npm run typecheck    # app, server, scripts and infrastructure
npm run sync:local -- --twice   # hit the real Super 6 API; proves idempotency
npx ampx sandbox --once         # deploy a throwaway backend
```

The local admin password is `fourfold-dev` (override with `FOURFOLD_DEV_PASSWORD`).
The real one exists only as a scrypt hash in SSM and cannot be recovered —
re-run `scripts/hash-password.ts` and overwrite the parameter if it's lost.
