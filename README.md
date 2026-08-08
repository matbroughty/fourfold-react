# FourFold

The permanent record of a small private football competition, based on the six
matches Sky Super 6 picks each round.

Rounds and fixtures import themselves from Super 6. When somebody wins, an
administrator types one number into `/admin` and the site works out the rest.

- Production: <https://fourfold.co.uk>
- Staging: <https://new.fourfold.co.uk>

## The game

Each round, Sky Super 6 selects six football matches. Every player:

1. picks **five** of the six matches,
2. predicts each one as **home win**, **draw** or **away win**,
3. places a **"fourfold" system bet** — the five possible four-from-five
   combinations (`ABCD`, `ABCE`, `ABDE`, `ACDE`, `BCDE`) at £1 each.

So the stake is **£5 per player per round**. There is no fivefold.

Players place their own bets with their own bookmaker and post a screenshot into
the WhatsApp group before the first kick-off. **WhatsApp is the audit trail** for
what everyone actually backed and at what odds.

FourFold therefore does **not** record selections, odds or screenshots, and does
not calculate winnings. It records the money that came back.

### Return vs profit

A **return** is what the bookmaker paid back. If the stake was £5 and the payout
was £18.40, the return is **£18.40** and the profit is £13.40. The admin form
takes the return; the site derives profit itself. Getting this the wrong way round
is the easiest mistake to make, so the form says so explicitly.

If nobody wins a round, there is nothing to enter — the site shows "No returns
this round."

### Standings

Ranked on **total returns**, highest first. This is the competition's long-standing
rule and is preserved deliberately; profit, stake and ROI are displayed but do not
affect the order. Players level on returns share a position.

Stake is `rounds × £5`. Everyone is assumed to play every round; see
[Skipped rounds](#skipped-rounds) for the exception mechanism.

## Architecture

```
Browser ──> Amplify Hosting (React SPA, Vite)
              │
              └─ fetch ──> API Gateway (HTTP API) ──> Lambda ──> DynamoDB
                                  ▲
            EventBridge (3h) ──> Sync Lambda ──> api.s6.sbgservices.com/v2
```

Everything deploys from this one repository. The backend is plain CDK inside
Amplify Gen 2's `amplify/backend.ts`.

Deliberate choices, and why:

- **API Gateway HTTP API, reluctantly.** The original design used a public Lambda
  Function URL — cheaper, and one service fewer. **This AWS account refuses
  anonymous Function URL invocations**: with `authType: NONE` and a resource
  policy allowing `Principal: "*"` on the exact function ARN, and no
  Organization SCP in play, every request returned `AccessDeniedException`. An
  HTTP API is the standard public entry point at $1 per million requests, so a
  few thousand requests a month costs fractions of a penny. If that account
  restriction is ever lifted, switching back is a ten-line change in
  `amplify/backend.ts`.
- **No Cognito, no `defineAuth`.** One administrator with one password does not
  need a user pool. Authentication is a scrypt hash in SSM plus an HMAC session
  token (`server/src/auth.ts`).
- **DynamoDB, not S3.** The site reads individual seasons, rounds and returns and
  writes single returns. That is key/value access, not whole-file rewriting — the
  previous "edit a CSV and re-upload it" approach is what this replaces.
- **One table.** Everything for a season shares a partition, so rendering a season
  is a single `Query`. See `server/src/repo/dynamo.ts`.
- **Money as integer pence, everywhere.** No floats touch money.
- **TypeScript throughout**, with the domain logic in `shared/` so the same
  standings and money code runs in the Lambda and in the browser.

Running cost is effectively zero: on-demand DynamoDB holding a few hundred KB,
~240 scheduled invocations a month, no always-on compute, no NAT gateway.

### Layout

```
amplify/backend.ts        AWS infrastructure (CDK inside Amplify Gen 2)
shared/domain/            money, types, players, standings — pure, tested
shared/super6/            the ONLY code that knows about Sky's API
shared/migration/         historical CSV parser
server/src/api.ts         HTTP routing, validation, authorisation
server/src/auth.ts        password hashing, session tokens, login throttle
server/src/sync.ts        idempotent Super 6 synchronisation
server/src/repo/          DynamoDB and in-memory storage
server/src/handler.ts     Lambda entry points (api, scheduledSync)
src/                      React SPA
scripts/                  migration, local sync, local API, password hashing
data/history/             the historical results, one CSV per season
docs/                     Super 6 API notes, data provenance
```

## Local development

Requires Node 20.11+.

```bash
npm install
npm run dev:api     # terminal 1 — API on :3000, seeded with real history
npm run dev         # terminal 2 — SPA on :5173
```

`dev:api` loads every season from `data/history/`, then does one live Super 6
sync to pull in the current round. Nothing is persisted — restart for a clean
slate. It prints the admin password (default `fourfold-dev`, override with
`FOURFOLD_DEV_PASSWORD`). Add `--offline` to skip the Super 6 call.

Vite proxies `/api` to `:3000`, so the SPA calls the same relative paths it uses
in production.

```bash
npm test            # 163 tests
npm run typecheck   # tsc across app, server, scripts and infrastructure
npm run build       # production build
```

## Environment variables and secrets

Nothing secret is committed, and nothing secret reaches the browser.

### Frontend (build time)

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Optional override for the API base URL. Normally unnecessary — the frontend reads `custom.apiBaseUrl` from `amplify_outputs.json`, which the backend build writes before the frontend build runs. Leave unset locally to use the Vite proxy. |

Only `VITE_*` variables are exposed to the browser, and neither of the two
secrets below is one.

### Backend (set by `amplify/backend.ts`, not by hand)

| Variable | Purpose |
| --- | --- |
| `FOURFOLD_TABLE_NAME` | DynamoDB table |
| `FOURFOLD_ADMIN_PASSWORD_HASH_PARAM` | SSM parameter *name* holding the hash |
| `FOURFOLD_TOKEN_SECRET_PARAM` | SSM parameter *name* holding the signing secret |
| `FOURFOLD_ALLOWED_ORIGINS` | Comma-separated exact origins allowed to call the API |

### The two secrets (created once, by hand)

SSM cannot create encrypted parameters from CloudFormation, so these are made
manually as `SecureString`s:

```bash
npx tsx scripts/hash-password.ts 'the-admin-password-you-want'
```

That prints the scrypt hash, a fresh token secret, and the two `aws ssm
put-parameter` commands to run. Store them at:

- `/fourfold/admin-password-hash`
- `/fourfold/token-secret`

The password itself is never stored anywhere. Rotating the token secret signs
everyone out. Put a space before the command so it stays out of your shell
history.

## Super 6 integration

See **[docs/super6-api.md](docs/super6-api.md)** for the full technical note: how
the specification was found, what is undocumented, and the two traps in the data.

The short version:

- The real OpenAPI spec is at `/v2/swagger.json`. The Swagger UI at `/v2/docs/` is
  unconfigured boilerplate pointing at the Swagger pet store.
- **No authentication** is needed for the data we read.
- FourFold uses exactly four endpoints: `GET /round/active`, `GET /round`,
  `GET /round/{roundId}`, `GET /ping`.
- **Round ids restart every season**, so rounds are keyed on `"{season}:{roundId}"`.
- **Sky only serves the current season**, so local persistence is the only reason
  history exists.

### Manual sync

`/admin` has a **Sync Super 6** button showing the latest known round, the last
successful sync, the last attempt and any error. It runs exactly the same code as
the schedule, and is the recovery path if the scheduled import fails.

From a terminal, against the live read-only API:

```bash
npm run sync:local            # in-memory, nothing persisted
npm run sync:local -- --twice # proves syncing is idempotent
FOURFOLD_TABLE_NAME=... npm run sync:local -- --write
```

### Scheduled sync

An EventBridge rule invokes the sync Lambda **every three hours** (~240 calls a
month). Rounds are weekly and results settle within a few hours of the last
fixture, so this is comfortably often enough. A live score can be up to three
hours stale; the Sync button covers impatience. There is deliberately no adaptive
schedule — it would be more to maintain than the staleness is worth.

Syncing is **idempotent and non-destructive**:

- rounds are keyed on season + Sky round id, so re-running creates nothing new
  (a second identical run performs exactly one write: the sync-state record);
- a round Sky has finished with is never rewritten;
- a response containing no fixtures never blanks fixtures already stored;
- local rounds are never deleted because Sky stopped serving them;
- one failing round does not abandon the others;
- a total failure records the error and changes nothing.

## Database structure

One DynamoDB table, on-demand, `PK`/`SK`:

| Item | PK | SK |
| --- | --- | --- |
| Season | `SEASON` | `SEASON#2026-27` |
| Round | `SEASON#2026-27` | `ROUND#0001` |
| Return | `SEASON#2026-27` | `RETURN#<uuid>` |
| Participation | `SEASON#2026-27` | `PART#0001#mat` |
| Sync state | `SYNC` | `STATE` |

All seasons share the `SEASON` partition, so listing them is one query; everything
within a season shares that season's partition, so rendering a season is one
query. Round numbers are zero-padded so lexical order matches numeric order.

### Returns are one record per entry

Not one per player/round. Several may exist for the same player and round and they
sum on read. This makes corrections easy (edit or delete a single line) and means
an accidental double entry is visible rather than silently overwriting. A £0.00
return is not counted as a win.

### Players

Configuration, not database rows (`shared/domain/players.ts`) — there are seven of
us and the list changes every few years. There is no registration.

Each season stores its own roster, because rosters change: **2020-21 had five
players including Taz**, with no Frank, Jase or Ash. Stakes are computed from the
season's own roster.

### Skipped rounds

Everyone is assumed to play every round, so nothing is written in the normal case.
A `Participation` record with `participated: false` records an exception and
reduces that player's stake, total and ROI. The calculation already honours it, so
representing a skipped round later needs no schema change.

## Historical migration

Five seasons of results were preserved from the two old repositories. **Read
[docs/data-provenance.md](docs/data-provenance.md)** — it records where each
season came from, the one data repair made, and what is genuinely missing.

| Season | Rounds | Total returns |
| --- | --- | --- |
| 2020/21 | 54 | £1,351.69 |
| 2022/23 | 56 | £1,335.44 |
| 2023/24 | 55 | £2,105.00 |
| 2024/25 | 51 | £1,154.38 |
| 2025/26 | 38 | £1,019.19 |

£6,965.70 in total, asserted in `shared/migration/csv.test.ts` so a future change
cannot quietly alter the history.

Two findings worth knowing: the **CSVs in git were badly stale** (the 2025-26 copy
had 1 round; the live CloudFront object had 38), and **2021-22 is missing
entirely**. Imported seasons have returns but **no fixtures** — the CSVs record no
dates, teams or scores, and none were invented. Those rounds are marked
`source: 'csv-import'` and the UI says so.

```bash
npm run migrate:history                                    # dry run, prints the standings
FOURFOLD_TABLE_NAME=<table> npm run migrate:history -- --write
```

Safe to re-run: record ids are derived from season, round and player, so a second
run overwrites rather than duplicates.

## Deployment

### First time

1. **Create the secrets** (see above) in the same region as the backend.
2. **Deploy the backend and hosting.** Amplify builds this repo on push. To deploy
   the backend from a terminal:
   ```bash
   npx ampx sandbox          # personal sandbox
   npx ampx pipeline-deploy --branch main --app-id <APP_ID>
   ```
3. **Nothing to configure for the API URL.** The backend build writes
   `custom.apiBaseUrl` into `amplify_outputs.json` and the frontend reads it from
   there. Set `VITE_API_BASE_URL` only if you need to point the SPA somewhere else.
4. **Add the SPA rewrite** in Amplify → Rewrites and redirects, so client-side
   routes like `/admin` work on refresh:

   | Source | Target | Type |
   | --- | --- | --- |
   | `/<*>` | `/index.html` | 200 (Rewrite) |

5. **Import the history** with `migrate:history -- --write`.
6. **Sync**, either by waiting for the schedule or pressing Sync Super 6.

### Ongoing

Push to `main`. Amplify builds the frontend and deploys the backend.

### Staging vs production

`new.fourfold.co.uk` is the staging branch and is where this rebuild should be
tested. **Nothing here changes production DNS or moves traffic.**

The cut-over to `fourfold.co.uk` is a deliberate manual step, written up
separately in **[docs/cutover.md](docs/cutover.md)**.

Note that staging and production must **not** share a DynamoDB table if you want
to experiment freely — `amplify/backend.ts` creates one table per Amplify
environment, so each branch gets its own.

## Backup and recovery

The table is the only irreplaceable thing here, because Sky does not serve past
seasons.

- **Point-in-time recovery is enabled** (35 days, restore to any second).
- **`removalPolicy: RETAIN`** — deleting the stack leaves the table behind.
- **The CSVs in `data/history/` are committed**, so every season up to 2025/26 can
  be rebuilt from this repository with `migrate:history` even if the table is lost
  entirely.
- Rounds and fixtures for the current season can be re-fetched from Super 6 with
  a sync, as long as the season is still current.

The gap: **returns recorded during the live season exist only in the table**. If
you want a belt-and-braces copy, `aws dynamodb scan` to a JSON file occasionally,
or export to S3 from the console. At this data size a scan is trivial.

## Security

Proportionate to a private hobby site, not to banking:

- secrets in SSM SecureString, never in git and never in frontend JavaScript;
- password stored as a salted scrypt hash; comparisons are constant-time;
- session tokens are HMAC-signed, expire after 12 hours, and carry no secrets;
- **every mutation checks the token** — verified by test;
- all input validated server-side regardless of the frontend;
- CORS reflects only exact configured origins, never `*`;
- the browser has no DynamoDB access at all; everything goes through the Lambda;
- errors return a generic message, with detail in CloudWatch only;
- HTTPS everywhere (Function URLs and Amplify are HTTPS-only);
- login throttled to 8 attempts per 15 minutes.

Known limitation: the login throttle lives in Lambda memory, so it is per-container
rather than global. The scrypt cost is the real defence; this stops casual
hammering. A DynamoDB write per login attempt was judged disproportionate.

## Testing

163 tests, no external calls — Super 6 responses come from sanitised captures in
`shared/super6/__fixtures__/`.

Coverage concentrates on the things that would actually hurt: money arithmetic,
Super 6 normalisation, sync idempotency, standings and ROI, zero-return rounds,
multiple winners in one round, several returns for one player in one round,
editing and deleting returns, authorisation on every mutation, historical season
totals, and Sky being unavailable.

```bash
npm test
```
