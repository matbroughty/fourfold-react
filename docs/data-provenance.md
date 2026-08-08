# Historical data: where it came from, and what is uncertain

FourFold's history predates this rebuild. This note records exactly where each
season's numbers came from, every correction made during the import, and the
questions that could not be answered from the data alone. Nothing here was
guessed at silently.

## Sources

Two old repositories held the competition's results:

| Repo | Serves | Format |
| --- | --- | --- |
| `matbroughty/fffc` | `fourfold.co.uk` | Static HTML with the standings hardcoded per season, plus CSVs in `data/archive/` |
| `matbroughty/fourfold-react` | `new.fourfold.co.uk` | Vite/React app reading one CSV from S3 via CloudFront |

The CSVs are named "kent" in both repos. Each is a matrix: the header row is the
season's roster, one row per round, and each cell is that player's **return** for
that round in pounds. `0.00` means no return.

**The authoritative copy is the one on CloudFront** (`d39p7vg8kswmae.cloudfront.net`),
not the copy in git. The S3 object was updated during each season without the
change being committed, so the repository copies had drifted badly:

- `s3/kent.csv` in git held **1 round** of 2025-26. The live object held **38**.
- `data/archive/kent-24-25.csv` in `fffc` held **50** rounds. The live object held **51**.

All five seasons in `data/history/` were taken from CloudFront on 2026-08-08 and
are now committed, so the history no longer depends on that S3 bucket.

## What was imported

| Season | File | Rounds | Total returns | Winning entries |
| --- | --- | --- | --- | --- |
| 2020/21 | `data/history/2020-21.csv` | 54 | £1,351.69 | 38 |
| 2022/23 | `data/history/2022-23.csv` | 56 | £1,335.44 | 65 |
| 2023/24 | `data/history/2023-24.csv` | 55 | £2,105.00 | 82 |
| 2024/25 | `data/history/2024-25.csv` | 51 | £1,154.38 | 64 |
| 2025/26 | `data/history/2025-26.csv` | 38 | £1,019.19 | 49 |

Total across all five seasons: **£6,965.70**. These figures are asserted in
`shared/migration/csv.test.ts`, so a future change that alters the history will
fail the build.

## Corrections made

**One data repair, in 2022-23 round 6.** The row read:

```
0.00,0,00,13.90,0.00,0.00,0.00,0.00
```

A comma had been typed instead of a decimal point, so the row split into 8
fields against a 7-player header. Repairing `0,00` to `0.00` yields exactly seven
fields and is the only reading that does, which makes the intent unambiguous. The
£13.90 belongs to **Paul S**.

This matters because the previous tooling silently mis-assigned it: naive
column-zipping truncated at the shortest sequence and credited the £13.90 to
**Paul V**. Corrected per-player 2022-23 totals are therefore Paul S £50.21 and
Paul V £217.89, not £36.31 and £231.79.

The file in `data/history/2022-23.csv` is the corrected version; the original is
in git history. It was the only malformed cell in all five files — every other
cell matches `N.NN`.

## Known gaps and ambiguities

These are recorded rather than resolved, because the data does not settle them.

**2021-22 is missing entirely.** There is no `kent-21-22.csv` in either repo and
CloudFront returns 403 for it. A `killer-21-22.html` exists, but that is a
different game. Either FourFold did not run that season or the file was lost. The
site simply does not list a 2021/22 season.

**2025-26 stops at 38 rounds.** The season ran to May 2026, so a complete season
should have ~50 rounds. The CSV appears to have stopped being updated around
February 2026 (the repo's last commit is 2026-01-24). The final ~12 rounds of
2025/26 are **not recorded anywhere I could find**. If you have the missing rows,
append them to `data/history/2025-26.csv` and re-run the import — the numbers
will update automatically.

**2024/25's archived page disagrees with its CSV.** `index-24-25.html` in `fffc`
shows 50 rounds, £1,140.05, Frank £96.65 and 63 wins. The live CSV has 51 rounds,
£1,154.38, Frank £110.98 and 64 wins. The difference is one extra round
containing a single £14.33 return for Frank. The CSV is treated as authoritative
because it is the more recent and more complete source; the page was evidently
archived before that last round was added.

**That same page is mislabelled.** Its hero text says "2025 - 2026 Season" while
its filename and CSV both say 24-25. The filename is treated as correct, since
the file's contents match the 24-25 CSV exactly.

**No fixtures exist for any historical season.** The CSVs record returns only —
no dates, no teams, no scores, no Super 6 round ids. Imported rounds are stored
with `source: 'csv-import'`, an empty `fixtures` array and `externalRoundId: null`,
and the UI states that no fixture record exists rather than implying Sky failed.
Round numbers are row positions, which is the only identity these files carry.

**Rosters change between seasons.** 2020-21 has five players — Dan, Mat, Paul S,
Paul V and **Taz** — with no Frank, Jase or Ash. Taz appears in no later season.
Each season therefore stores its own `playerIds`, and stakes are computed from
that season's roster rather than from today's.

## Stake assumption

Every player is assumed to have staked £5 in every round of every season they
appear in, because the CSVs record returns only. Nobody's stake is reduced
anywhere in the imported data. If it turns out someone sat rounds out, a
`Participation` record with `participated: false` will correct their stake, total
and ROI without any schema change — the calculation already honours it.
