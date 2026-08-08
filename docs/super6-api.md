# The Sky Super 6 API, as discovered

Everything here was established by investigation on **2026-08-08**, not from
documentation Sky provides. The API is undocumented and not ours; treat this note
as a snapshot that may go stale. FourFold depends on four endpoints, all wrapped
by `shared/super6/client.ts`.

## Finding the specification

The Swagger UI at `https://api.s6.sbgservices.com/v2/docs/` is **unconfigured
boilerplate** — its `swagger-initializer.js` still points at
`https://petstore.swagger.io/v2/swagger.json`, so the page renders the Swagger
pet store demo, not Sky's API. That is a dead end.

The real specification is served, unadvertised, at:

```
https://api.s6.sbgservices.com/v2/swagger.json
```

It is a valid OpenAPI 3.0.0 document (`title: "Super6 API"`, `version: v2`,
server `https://api.s6.sbgservices.com/v2`) describing ~40 endpoints across
Round, Match, Score, Leaderboard, Predictions, Pundit, Odds and Users. Most
concern playing Super 6 itself and are irrelevant to us.

## Authentication

**None is required** for the round and fixture data FourFold reads.

`securityDefinitions` in the spec is empty, and every request below was made with
no credentials, no cookies and no API key. The API does advertise
`Access-Control-Allow-Headers: Authorization, X-Cust-Id, Content-Type,
X-Session-Id`, which suggests user-scoped endpoints (predictions, leaderboard
position) do need a session — but nothing FourFold uses does. We send only
`Accept: application/json`.

## Endpoints FourFold relies on

| Endpoint | Used for |
| --- | --- |
| `GET /round/active` | The anchor call. The only cheap request returning both the season and the six fixtures. |
| `GET /round` | Discovering which rounds exist this season. |
| `GET /round/{roundId}` | Fetching one round in full, including fixtures. |
| `GET /ping` | Liveness. Returns the bare string `healthy`. |

Nothing else is called, and no endpoint is ever written to.

### The critical finding: round ids restart every season

`GET /round` currently returns **three rounds, ids 1, 2 and 3**, for season
`2026-27`. The spec's own example shows ids 1–3 for 2018. Requesting `/round/100`
returns 404 and `/round/0` returns 400.

**Sky's `roundId` is unique only within a season.** It is therefore unusable as a
primary key: 2026-27 round 1 would collide with 2025-26 round 1. FourFold keys
rounds on the composite `"{season}:{roundId}"` (see `roundKey` in
`shared/super6/normalize.ts`), which is asserted in the tests.

A second consequence: **Sky serves only the current season.** Previous seasons are
not retrievable at all, so persisting rounds locally is not merely resilience —
it is the only way the history can exist.

### Round shape

`GET /round/active` and `GET /round/{id}` return:

```json
{
  "id": 1,
  "status": "open",
  "season": "2026-27",
  "isPaused": false,
  "isSingleWinner": false,
  "startDateTime": "2026-07-17T11:17:00Z",
  "endDateTime": "2026-08-22T14:00:00Z",
  "scoreChallenges": [ ... six of these ... ],
  "goldenGoalChallenge": { ... },
  "assets": { ... marketing imagery ... },
  "features": [],
  "heroes": []
}
```

`status` is one of `open | inplay | complete | future` (per the spec's `Round`
schema). `assets`, `heroes`, `features` and `goldenGoalChallenge` are ignored —
they are Super 6's own game and promotional artwork.

Note `GET /round` returns a **different, smaller** object per round: it has
`matchDates` but **no `season` and no `scoreChallenges`**. That is why
`normalizeRound` accepts a `fallbackSeasonId`, and why each round is fetched
individually to get its fixtures.

### Fixture shape

The six fixtures are under `scoreChallenges`, not `matches` or `fixtures`:

```json
{
  "id": 1,
  "void": false,
  "match": {
    "id": 89447,
    "eventId": null,
    "kickOffDateTime": "2026-08-22T14:00:00.000Z",
    "status": "Pre Live",
    "shortStatus": "",
    "isLocked": false,
    "competitionId": 1541,
    "competitionName": "Premier League",
    "homeTeam": { "id": 156, "score": 0, "name": "Everton", "shortname": "EVT", "badgeUri": "..." },
    "awayTeam": { "id": 178, "score": 0, "name": "Crystal Palace", "shortname": "PAL", "badgeUri": "..." }
  }
}
```

`match.status` is one of `Pre Live | Kick Off | Half Time | Half Time Started |
Second Half Started | Full Time | Match Complete | Result | Abandoned |
Postponed`, mapped onto our own vocabulary in `normalizeFixture`.

Two traps here, both caught by real-data verification rather than by reading:

**`scoreChallenges[].id` is not a 1–6 position.** It increments across the whole
season, with gaps: round 1 uses 1–6, round 2 uses **8–13**, round 3 uses **15–20**
(7 and 14 are presumably consumed by each round's golden-goal challenge). Using it
as a fixture number labels round 2's first match "8". FourFold stores it as
`externalChallengeId` for traceability, orders by it, and assigns its own 1–6
`position`.

**Scores are `0`, not `null`, before kick-off.** Passing them through verbatim
makes every unplayed fixture look like a 0–0 draw. FourFold reports `null` unless
the match is live or finished.

### Stable identifiers worth persisting

| Field | Stability | Persisted as |
| --- | --- | --- |
| `match.id` (e.g. `89447`) | Appears globally unique and stable | `Fixture.externalMatchId` |
| `homeTeam.id` / `awayTeam.id` | Stable team ids | `Fixture.homeTeamId` / `awayTeamId` |
| `round.id` | **Unique only within a season** | `Round.externalRoundId`, keyed with the season |
| `round.season` | e.g. `"2026-27"` | `Season.id` |
| `scoreChallenges[].id` | Season-wide, gappy | `Fixture.externalChallengeId` (traceability only) |

## Rate limits and restrictions

No rate-limit headers of any kind are returned — no `X-RateLimit-*`, no
`Retry-After`. Nothing in the spec mentions quotas. That is not a licence to
hammer it: the infrastructure is CloudFront in front of Cloudflare
(`x-amz-cf-pop: LHR61-P5`, `server: cloudflare`), so an aggressive caller would
likely be throttled or blocked at the edge without a friendly error.

`Cache-Control: public, no-transform, max-age=1` — effectively uncached, so
responses are current.

FourFold polls every three hours (about 240 requests a month) and does up to three
attempts with exponential backoff per request. That is a rounding error in Sky's
traffic and well within anything they would consider reasonable.

## Hosts and versions

Only `api.s6.sbgservices.com` was found. The path prefix `/v2` is the version; no
`/v1` or `/v3` responded. `https://api.s6.sbgservices.com/` itself returns HTML.
There is no evidence of separate staging and production hosts — this appears to be
the live public API that the Super 6 apps themselves use, which is a reason to be
conservative with it.

## How FourFold limits its exposure

- **Two files only.** `shared/super6/client.ts` (HTTP) and
  `shared/super6/normalize.ts` (translation). Nothing else in the application
  knows Sky exists.
- **Nothing is trusted.** Every field is optional and nullable in
  `shared/super6/types.ts`. Unknown statuses become `unknown` rather than
  throwing; unknown fields are dropped. Normalisation is all-or-nothing, so a
  half-parsed round can never overwrite good data.
- **Sky's response is not our data model.** The raw payload is deliberately *not*
  persisted. It is large, mostly marketing assets, and storing it would invite
  reading from it later, which is exactly the coupling this design avoids. The
  fields we care about are captured in our own shape; anything else is
  recoverable from Sky while the API lives, and irrelevant once it does not.
  Sanitised sample responses are committed under
  `shared/super6/__fixtures__/` so the tests never call the real API.
- **Failure is survivable.** A sync that cannot reach Sky records the error and
  changes nothing. Rounds are never deleted because Sky forgot them, and a round
  that returns no fixtures never blanks fixtures we already hold.

## If Sky changes or withdraws the API

The public site keeps working: it reads only our DynamoDB table. Syncing stops,
the admin page shows the failure, and history is unaffected.

To replace the provider, implement the four methods of `Super6Client` against
something else and write a `normalizeRound` for it. Everything downstream —
storage, standings, the site — is unchanged. `npm run sync:local` exercises the
integration against the live API without deploying, which is the quickest way to
find out whether something has broken.
