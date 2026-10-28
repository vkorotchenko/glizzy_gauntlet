import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { loadSession } from '../auth/api'
import { getCompetition } from '../competitions/api'
import { formatTime } from '../competitions/time'
import { formatInches } from '../meals/measurement'
import * as api from './api'

function ErrorNotice({
  error,
  retry,
}: {
  error: Error | null
  retry: () => void
}) {
  return error ? (
    <>
      <p role="alert" className="form-error">
        {error.message}
      </p>
      <button type="button" className="text-button" onClick={retry}>
        Try again
      </button>
    </>
  ) : null
}

export function ResultsTable({
  items,
  caption,
}: {
  items: api.Standing[]
  caption: string
}) {
  return (
    <div
      className="table-scroll"
      role="region"
      aria-label={caption}
      tabIndex={0}
    >
      <table className="results-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Display name</th>
            <th scope="col">Inches</th>
            <th scope="col">Whole hot dogs</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row, index) => (
            <tr key={index}>
              <td>{row.rank}</td>
              <th scope="row">{row.displayName}</th>
              <td>{formatInches(row.totalHundredths)}</td>
              <td>{row.wholeHotDogs}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Standings({ id }: { id: string }) {
  const [page, setPage] = useState(0)
  const results = useQuery({
    queryKey: ['meals', 'standings', id, page],
    queryFn: ({ signal }) => api.standings(id, page, signal),
    retry: false,
  })
  return (
    <section className="competition-section" aria-label="Competition standings">
      <h2>Standings</h2>
      <p>
        Ranked by inches alone. Equal totals share a rank (1, 1, 3); whole hot
        dogs are not a tie-breaker. Current members with no submissions score
        zero. Former members' retained submissions still count.
      </p>
      {results.isPending && <p role="status">Loading standings...</p>}
      <ErrorNotice error={results.error} retry={() => void results.refetch()} />
      {results.data && !results.isError && (
        <>
          {results.data.provisional ? (
            <p className="form-notice">
              Provisional standings. Closed submissions are not a finalized
              recap.
            </p>
          ) : (
            <p className="form-notice">
              Final standings from the latest final or revised recap. Earlier
              result revisions remain available.
            </p>
          )}
          <ResultsTable
            items={results.data.items}
            caption={
              results.data.provisional
                ? 'Provisional standings'
                : 'Final standings'
            }
          />
          {!results.data.items.length && <p>No participants on this page.</p>}
          <div className="page-controls">
            <button
              type="button"
              className="text-button"
              disabled={!page}
              onClick={() => setPage(page - 1)}
            >
              Previous standings page
            </button>
            <span>Page {page + 1}</span>
            <button
              type="button"
              className="text-button"
              disabled={!results.data.hasMore || page >= 1000}
              onClick={() => setPage(page + 1)}
            >
              Next standings page
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => void results.refetch()}
            >
              Refresh standings
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function DailyChart({ days, zone }: { days: api.Day[]; zone: string }) {
  const [mode, setMode] = useState<'daily' | 'cumulative'>('daily')
  const value = (day: api.Day) =>
    mode === 'daily' ? day.totalHundredths : day.cumulativeHundredths
  const maximum = Math.max(1, ...days.map(value))
  const points = days
    .map(
      (day, index) =>
        `${10 + (index * 580) / Math.max(1, days.length - 1)},${160 - (value(day) * 140) / maximum}`,
    )
    .join(' ')
  return (
    <>
      <h2>Daily and cumulative inches</h2>
      <p>
        Calendar days in {zone}. Zero days are included; cumulative totals
        include earlier pages.
      </p>
      <div className="competition-actions">
        <button
          type="button"
          className="text-button"
          aria-pressed={mode === 'daily'}
          onClick={() => setMode('daily')}
        >
          Daily chart
        </button>
        <button
          type="button"
          className="text-button"
          aria-pressed={mode === 'cumulative'}
          onClick={() => setMode('cumulative')}
        >
          Cumulative chart
        </button>
      </div>
      {days.length ? (
        <>
          <figure className="progress-chart">
            <figcaption>
              {mode === 'daily' ? 'Daily' : 'Cumulative'} inches: {days[0].date}{' '}
              to {days.at(-1)!.date}. Chart maximum: {formatInches(maximum)}{' '}
              inches.
            </figcaption>
            <svg
              viewBox="0 0 600 180"
              role="img"
              aria-label={`${mode === 'daily' ? 'Daily' : 'Cumulative'} inches in ${zone}; exact values in the table below`}
            >
              <path d="M10 10 V160 H590" fill="none" stroke="currentColor" />
              <polyline
                points={points}
                fill="none"
                stroke="#18583d"
                strokeWidth="3"
              />
              {days.length === 1 && (
                <circle
                  cx="10"
                  cy={160 - (value(days[0]) * 140) / maximum}
                  r="4"
                  fill="#18583d"
                />
              )}
            </svg>
          </figure>
          <div
            className="table-scroll"
            role="region"
            aria-label="Daily progress data"
            tabIndex={0}
          >
            <table className="results-table">
              <caption>Exact daily and cumulative totals</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Inches</th>
                  <th scope="col">Cumulative inches</th>
                  <th scope="col">Whole hot dogs</th>
                  <th scope="col">Meals</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day) => (
                  <tr key={day.date}>
                    <th scope="row">
                      <time dateTime={day.date}>{day.date}</time>
                    </th>
                    <td>{formatInches(day.totalHundredths)}</td>
                    <td>{formatInches(day.cumulativeHundredths)}</td>
                    <td>{day.wholeHotDogs}</td>
                    <td>{day.mealCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p>No eating days on this page yet.</p>
      )}
    </>
  )
}

function PersonalProgress({ id }: { id: string }) {
  const [dayPage, setDayPage] = useState(0)
  const [placePage, setPlacePage] = useState(0)
  const result = useQuery({
    queryKey: ['meals', 'progress', id, dayPage, placePage],
    queryFn: ({ signal }) => api.personal(id, dayPage, placePage, signal),
    retry: false,
  })
  const view = result.data
  return (
    <>
      {result.isPending && <p role="status">Loading your progress...</p>}
      <ErrorNotice error={result.error} retry={() => void result.refetch()} />
      {view && !result.isError && (
        <>
          {view.provisional ? (
            <p className="form-notice">
              Your progress is provisional until the submission deadline is
              processed.
            </p>
          ) : (
            <p className="form-notice">
              Final progress from the latest recap revision. Organizer
              corrections can publish a revised recap.
            </p>
          )}
          <dl
            className="competition-facts"
            aria-label="Your competition totals"
          >
            <dt>Inches</dt>
            <dd>{formatInches(view.totalHundredths)}</dd>
            <dt>Whole hot dogs</dt>
            <dd>{view.wholeHotDogs}</dd>
            <dt>Current rank</dt>
            <dd>{view.rank} (ties share a rank)</dd>
            <dt>Submitted meals</dt>
            <dd>{view.mealCount}</dd>
            <dt>Distinct venues</dt>
            <dd>{view.venueCount}</dd>
            <dt>Private labels</dt>
            <dd>{view.privateLocationCount}</dd>
          </dl>
          <button
            type="button"
            className="text-button"
            onClick={() => void result.refetch()}
          >
            Refresh progress
          </button>
          <section className="competition-section">
            <DailyChart days={view.days} zone={view.timeZone} />
            <div className="page-controls">
              <button
                type="button"
                className="text-button"
                disabled={!dayPage}
                onClick={() => setDayPage(dayPage - 1)}
              >
                Newer days
              </button>
              <span>Day window {dayPage + 1}</span>
              <button
                type="button"
                className="text-button"
                disabled={!view.daysHasMore || dayPage >= 1000}
                onClick={() => setDayPage(dayPage + 1)}
              >
                Older days
              </button>
            </div>
          </section>
          <section className="competition-section">
            <h2>Your visited places</h2>
            <p>
              Directory venues are counted by venue, private labels by exact
              text. Labels come from submitted snapshots, not the current
              directory.
            </p>
            {!view.places.length && <p>No visited places on this page.</p>}
            <ul className="member-list">
              {view.places.map((place, index) => (
                <li key={index}>
                  <strong>{place.location}</strong> /{' '}
                  {place.venueId ? 'Directory venue' : 'Private label'} /{' '}
                  {place.mealCount} meals /{' '}
                  {formatInches(place.totalHundredths)} inches
                </li>
              ))}
            </ul>
            <div className="page-controls">
              <button
                type="button"
                className="text-button"
                disabled={!placePage}
                onClick={() => setPlacePage(placePage - 1)}
              >
                Previous places page
              </button>
              <span>Place page {placePage + 1}</span>
              <button
                type="button"
                className="text-button"
                disabled={!view.placesHasMore || placePage >= 1000}
                onClick={() => setPlacePage(placePage + 1)}
              >
                Next places page
              </button>
            </div>
          </section>
          <section className="competition-section">
            <h2>Your recent submitted meals</h2>
            <p>
              The five most recent snapshots in this competition. Your private
              source may have newer revisions.
            </p>
            {!view.recentMeals.length && <p>No submitted meals yet.</p>}
            <ul className="member-list">
              {view.recentMeals.map((meal) => (
                <li key={meal.mealId}>
                  <strong>{formatInches(meal.totalHundredths)} inches</strong> /{' '}
                  {meal.wholeHotDogs} whole hot dogs
                  <p>
                    {formatTime(meal.eatenAt, view.timeZone)} / {meal.location}
                  </p>
                  <Link to={`/meals/${meal.mealId}`}>View private source</Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  )
}

export function ProgressPage() {
  const { id = '' } = useParams()
  const session = useQuery({
    queryKey: ['session'],
    queryFn: ({ signal }) => loadSession(signal),
    retry: false,
  })
  const competition = useQuery({
    queryKey: ['competitions', 'detail', id],
    queryFn: ({ signal }) => getCompetition(id, signal),
    enabled: Boolean(session.data?.user),
    retry: false,
  })
  return (
    <section className="competition-page">
      <Link to={`/competitions/${id}`}>Back to competition</Link>
      <h1>My competition progress</h1>
      <p>
        Only your nonwithdrawn submission snapshots in this competition count
        here. Private source edits and other competitions do not change these
        totals. Archived sources still count.
      </p>
      <ErrorNotice error={session.error} retry={() => void session.refetch()} />
      {session.isPending ? (
        <p role="status">Loading account...</p>
      ) : !session.data?.user ? (
        <p>
          <Link to="/sign-in">Sign in</Link> to view your competition progress.
        </p>
      ) : (
        <>
          <ErrorNotice
            error={competition.error}
            retry={() => void competition.refetch()}
          />
          {competition.isPending && <p role="status">Loading competition...</p>}
          {competition.data && !competition.isError && (
            <>
              <h2>{competition.data.name}</h2>
              {competition.data.viewerRole === 'NONE' ? (
                <p>Join this competition to view your own progress.</p>
              ) : (
                <PersonalProgress key={id} id={id} />
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}
