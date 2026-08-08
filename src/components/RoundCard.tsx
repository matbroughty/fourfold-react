/**
 * One Super 6 round: its six fixtures, results, and any FourFold returns.
 */
import { formatPenceWithSeparators } from '../../shared/domain/money'
import { fixtureOutcome } from '../../shared/super6/normalize'
import type { Fixture } from '../../shared/domain/types'
import type { RoundView } from '../api'

const ROUND_STATUS_LABEL: Record<string, string> = {
  future: 'Not open yet',
  open: 'Open for entries',
  inplay: 'In play',
  complete: 'Complete',
  unknown: '',
}

function formatKickOff(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatRoundDate(round: RoundView): string {
  // Prefer the first kick-off: a round's startsAt is when entries opened, which
  // can be weeks earlier and reads oddly as "the date of the round".
  const firstKickOff = round.fixtures.find((f) => f.kickOffAt)?.kickOffAt
  const iso = firstKickOff ?? round.startsAt
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function FixtureRow({ fixture }: { fixture: Fixture }) {
  const outcome = fixtureOutcome(fixture)
  const played = fixture.homeScore !== null && fixture.awayScore !== null

  return (
    <li className={`fixture${fixture.void ? ' fixture-void' : ''}`}>
      <span className="fixture-position">{fixture.position}</span>
      <span className={`fixture-team${outcome === 'home' ? ' fixture-winner' : ''}`}>
        {fixture.homeTeam}
      </span>
      <span className="fixture-score">
        {played ? `${fixture.homeScore}–${fixture.awayScore}` : 'v'}
      </span>
      <span className={`fixture-team fixture-away${outcome === 'away' ? ' fixture-winner' : ''}`}>
        {fixture.awayTeam}
      </span>
      <span className="fixture-meta subtle">
        {fixture.status === 'live' && <span className="live-dot" aria-label="in play" />}
        {fixture.void
          ? 'Void'
          : fixture.status === 'postponed'
            ? 'Postponed'
            : fixture.status === 'abandoned'
              ? 'Abandoned'
              : outcome === 'draw'
                ? 'Draw'
                : formatKickOff(fixture.kickOffAt)}
      </span>
    </li>
  )
}

export default function RoundCard({
  round,
  /** Optional marker, e.g. "Current round", shown next to the round name. */
  badge = null,
}: {
  round: RoundView
  badge?: string | null
}) {
  const date = formatRoundDate(round)
  const statusLabel = ROUND_STATUS_LABEL[round.status] ?? ''

  return (
    <div className={`card${badge ? ' card-current' : ''}`}>
      <div className="round-header">
        <div>
          <h2>
            {round.name}
            {badge && <span className="badge badge-current">{badge}</span>}
          </h2>
          <div className="subtle">
            {date}
            {statusLabel && ` · ${statusLabel}`}
          </div>
        </div>
        {round.returns.length > 0 && (
          <span className="badge badge-win">
            {round.returns.length === 1 ? '1 winner' : `${round.returns.length} winners`}
          </span>
        )}
      </div>

      {round.fixtures.length > 0 ? (
        <ul className="fixtures">
          {round.fixtures.map((fixture) => (
            <FixtureRow key={`${round.id}-${fixture.position}`} fixture={fixture} />
          ))}
        </ul>
      ) : (
        <p className="subtle">
          {round.source === 'csv-import'
            ? 'No fixture record for this round — imported from the historical results, which recorded winnings only.'
            : 'Fixtures have not been published yet.'}
        </p>
      )}

      <div className="round-returns">
        {round.returns.length > 0 ? (
          <ul className="returns-list">
            {round.returns.map((entry) => (
              <li key={entry.playerId}>
                <span>{entry.playerName}</span>
                <span className="strong money-up">
                  {formatPenceWithSeparators(entry.amountPence)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="subtle no-returns">No returns this round.</p>
        )}
      </div>
    </div>
  )
}
