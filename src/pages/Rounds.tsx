/**
 * Round history for one season. Defaults to the current season.
 */
import { useParams } from 'react-router-dom'
import { currentRoundBadge } from '../../shared/domain/rounds'
import RoundCard from '../components/RoundCard'
import { useApi } from '../useApi'
import { api } from '../api'

export default function Rounds() {
  const { seasonId } = useParams<{ seasonId?: string }>()
  const { data, error, loading } = useApi(
    () => (seasonId ? api.getSeason(seasonId) : api.getCurrent()),
    [seasonId],
  )

  if (loading) return <p className="subtle">Loading…</p>
  if (error) {
    return (
      <div className="card card-error">
        <strong>Could not load rounds.</strong>
        <p className="subtle">{error.message}</p>
      </div>
    )
  }
  if (!data?.season) return <p className="subtle">No season found.</p>

  return (
    <>
      <div className="section-heading">
        <h2>{data.season.name} rounds</h2>
        <span className="subtle">
          {data.rounds.length} round{data.rounds.length === 1 ? '' : 's'}, newest first
        </span>
      </div>

      {data.rounds.length === 0 ? (
        <div className="card">
          <p className="subtle">No rounds recorded for this season.</p>
        </div>
      ) : (
        <div className="grid">
          {data.rounds.map((round) => (
            <RoundCard
              key={round.id}
              round={round}
              badge={
                round.id === data.currentRoundId && data.currentRoundKind
                  ? currentRoundBadge(data.currentRoundKind)
                  : null
              }
            />
          ))}
        </div>
      )}
    </>
  )
}
