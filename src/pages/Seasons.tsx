/**
 * Previous seasons: the list, and one season's final table.
 */
import { Link, useParams } from 'react-router-dom'
import { formatPenceWithSeparators } from '../../shared/domain/money'
import StandingsTable from '../components/StandingsTable'
import { useApi } from '../useApi'
import { api } from '../api'

function SeasonList() {
  const { data, error, loading } = useApi(api.getSeasons, [])

  if (loading) return <p className="subtle">Loading…</p>
  if (error) {
    return (
      <div className="card card-error">
        <strong>Could not load seasons.</strong>
        <p className="subtle">{error.message}</p>
      </div>
    )
  }

  const seasons = data?.seasons ?? []

  return (
    <div className="card">
      <h2>Seasons</h2>
      {seasons.length === 0 ? (
        <p className="subtle">No seasons yet.</p>
      ) : (
        <ul className="season-list">
          {seasons.map((season) => (
            <li key={season.id}>
              <div className="season-row-main">
                <Link to={`/seasons/${season.id}`}>{season.name}</Link>
                <span className="subtle">
                  {season.status === 'active' ? 'In progress' : 'Complete'}
                  {season.summary && ` · ${season.summary.playedRoundCount} rounds`}
                  {season.imported && ' · winnings only'}
                </span>
              </div>
              <div className="season-row-winner">
                {season.winner ? (
                  <>
                    <span className="season-winner-name">
                      {season.status === 'active' ? '🥇 Leading: ' : '🏆 '}
                      {season.winner.playerName}
                    </span>
                    <span className="subtle">
                      {formatPenceWithSeparators(season.winner.totalReturnPence)}
                    </span>
                  </>
                ) : (
                  <span className="subtle">
                    {season.status === 'active' ? 'No returns yet' : 'No winner recorded'}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="subtle footnote">
        2021/22 is missing: no results file for that season survives in either of
        the old sites. Seasons marked “winnings only” were imported from the
        historical spreadsheets, which recorded returns but no fixtures.
      </p>
    </div>
  )
}

function SeasonDetail({ seasonId }: { seasonId: string }) {
  const { data, error, loading } = useApi(() => api.getSeason(seasonId), [seasonId])

  if (loading) return <p className="subtle">Loading…</p>
  if (error) {
    return (
      <div className="card card-error">
        <strong>Could not load {seasonId}.</strong>
        <p className="subtle">{error.message}</p>
      </div>
    )
  }
  if (!data) return null

  return (
    <>
      <div className="card">
        <div className="round-header">
          <div>
            <h2>{data.season.name}</h2>
            <div className="subtle">
              {data.summary.playedRoundCount} rounds played ·{' '}
              {formatPenceWithSeparators(data.summary.totalReturnPence)} returned ·{' '}
              {data.summary.winningEntries} winning entries
            </div>
          </div>
          <Link to="/seasons" className="button">
            All seasons
          </Link>
        </div>
        <StandingsTable standings={data.standings} />
      </div>

      <div className="section-heading">
        <h2>Rounds</h2>
        <Link to={`/seasons/${seasonId}/rounds`}>View all {data.rounds.length} rounds →</Link>
      </div>
    </>
  )
}

export default function Seasons() {
  const { seasonId } = useParams<{ seasonId?: string }>()
  return seasonId ? <SeasonDetail seasonId={seasonId} /> : <SeasonList />
}
