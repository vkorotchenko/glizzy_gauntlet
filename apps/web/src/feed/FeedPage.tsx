import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { loadSession } from '../auth/api'
import { listCompetitions } from '../competitions/api'
import { formatTime } from '../competitions/time'
import { MealSummary } from '../meals/MealPages'
import { formatInches } from '../meals/measurement'
import * as api from './api'

function MealCard({ item, userId }: { item: api.FeedItem; userId: string }) {
  const cache = useQueryClient()
  const reaction = useMutation({
    mutationFn: (reacted: boolean) => api.setReaction(item.id, reacted),
    onSuccess: (result) => {
      cache.setQueriesData<api.FeedPage>(
        { queryKey: ['feed', userId] },
        (previous) =>
          previous && {
            ...previous,
            items: previous.items.map((entry) =>
              entry.id === item.id ? { ...entry, ...result } : entry,
            ),
          },
      )
    },
  })
  return (
    <article
      className="competition-card meal-feed-card"
      aria-label={`${item.displayName}'s meal in ${item.competitionName}`}
    >
      <header className="feed-card-heading">
        <span className="feed-avatar" aria-hidden="true">
          {item.displayName.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <h2>{item.displayName}</h2>
          <Link to={`/competitions/${item.competitionId}`}>
            {item.competitionName}
          </Link>
        </div>
      </header>
      <MealSummary revision={item.revision} />
      {item.scoreExcluded ? (
        <p className="form-note">Excluded from this competition's scoring.</p>
      ) : (
        (item.totalHundredths !== item.revision.totalHundredths ||
          item.wholeHotDogs !== item.revision.wholeHotDogs) && (
          <p className="form-note">
            Corrected competition score: {formatInches(item.totalHundredths)}{' '}
            inches / {item.wholeHotDogs} whole hot dogs.
          </p>
        )
      )}
      <div className="feed-card-actions">
        <button
          type="button"
          className="glizzy-button"
          aria-pressed={item.reacted}
          disabled={reaction.isPending}
          onClick={() => reaction.mutate(!item.reacted)}
        >
          <span aria-hidden="true">&#127789;</span>{' '}
          {item.reacted ? 'Glizzy sent' : 'Send a glizzy'}
        </button>
        <span aria-live="polite">
          {item.reactionCount}{' '}
          {item.reactionCount === 1 ? 'glizzy' : 'glizzies'}
        </span>
      </div>
      {reaction.error && (
        <p role="alert" className="form-error">
          {reaction.error.message}
        </p>
      )}
    </article>
  )
}

function CompetitorFeed({ userId }: { userId: string }) {
  const [page, setPage] = useState(0)
  const feed = useQuery({
    queryKey: ['feed', userId, page],
    queryFn: ({ signal }) => api.listFeed(page, signal),
  })
  return (
    <section className="competition-page feed-page">
      <span className="eyebrow">Fresh from your crew</span>
      <h1>The latest bites.</h1>
      <p>
        Recent meals from competitors across your joined competitions. Send a
        glizzy to cheer them on; reactions never change scores.
      </p>
      <div className="competition-actions">
        <Link className="button" to="/meals/new">
          Log a meal
        </Link>
        <button
          className="text-button"
          disabled={feed.isFetching}
          onClick={() => (page ? setPage(0) : void feed.refetch())}
        >
          Refresh feed
        </button>
      </div>
      {feed.isPending && <p role="status">Loading your crew's meals...</p>}
      {feed.error && (
        <p role="alert" className="form-error">
          {feed.error.message}
        </p>
      )}
      {!feed.isError && feed.data && (
        <>
          {feed.data.items.length === 0 && (
            <div className="competition-card">
              <h2>
                {page ? 'No older meals.' : 'Your crew is quiet for now.'}
              </h2>
              <p>
                Meals appear here when other members submit them to a
                competition you have joined.
              </p>
              <Link to="/competitions">Find a competition</Link>
            </div>
          )}
          <div className="meal-feed">
            {feed.data.items.map((item) => (
              <MealCard key={item.id} item={item} userId={userId} />
            ))}
          </div>
        </>
      )}
      <div className="page-controls" aria-label="Feed pages">
        <button
          className="text-button"
          disabled={page === 0 || feed.isFetching}
          onClick={() => setPage(page - 1)}
        >
          Newer meals
        </button>
        <span aria-live="polite">Page {page + 1}</span>
        <button
          className="text-button"
          disabled={!feed.data?.hasMore || page >= 1000 || feed.isFetching}
          onClick={() => setPage(page + 1)}
        >
          Older meals
        </button>
      </div>
      <p className="form-note">
        Each card belongs to its named competition. A meal shared with multiple
        competitions can appear in each, with separate glizzies.
      </p>
    </section>
  )
}

function GuestHome() {
  const competitions = useQuery({
    queryKey: ['home-public-competitions'],
    queryFn: ({ signal }) => listCompetitions('public', 0, signal),
  })
  return (
    <section className="competition-page">
      <div className="competition-section feed-welcome">
        <span className="eyebrow">Good dogs. Good company.</span>
        <h1>Your crew's next chapter starts here.</h1>
        <p>
          Sign in to see your competitors' latest meals, track your own bites,
          and send a glizzy when someone deserves a cheer.
        </p>
        <Link className="button" to="/sign-in">
          Sign in to see your feed
        </Link>
        <p className="form-note">
          Meal details and photos stay within joined competitions.
        </p>
      </div>
      <div className="section-heading">
        <h2>Explore public competitions</h2>
        <Link to="/competitions">Browse all competitions</Link>
      </div>
      {competitions.isPending && (
        <p role="status">Loading public competitions...</p>
      )}
      {competitions.error && (
        <div role="alert" className="form-error">
          <p>{competitions.error.message}</p>
          <button
            className="text-button"
            disabled={competitions.isFetching}
            onClick={() => void competitions.refetch()}
          >
            Try competitions again
          </button>
        </div>
      )}
      {competitions.data?.items.length === 0 && (
        <p>No public competitions yet. Sign in to start your own.</p>
      )}
      <div className="competition-grid">
        {competitions.data?.items.slice(0, 2).map((competition) => (
          <article className="competition-card" key={competition.id}>
            <span className="eyebrow">Public competition</span>
            <h2>
              <Link to={`/competitions/${competition.id}`}>
                {competition.name}
              </Link>
            </h2>
            <p>{competition.memberCount} participants</p>
            <p>
              Starts {formatTime(competition.startsAt, competition.timeZone)}
            </p>
          </article>
        ))}
      </div>
    </section>
  )
}

export function HomePage() {
  const session = useQuery({
    queryKey: ['session'],
    queryFn: ({ signal }) => loadSession(signal),
    retry: false,
  })
  if (session.isPending)
    return (
      <section className="competition-page">
        <p role="status">Loading your account...</p>
      </section>
    )
  if (session.isError)
    return (
      <section className="competition-page">
        <h1>Your crew is waiting.</h1>
        <p role="alert" className="form-error">
          {session.error.message}
        </p>
        <button className="text-button" onClick={() => void session.refetch()}>
          Try your account again
        </button>{' '}
        <Link to="/sign-in">Sign in</Link>
      </section>
    )
  return session.data.user ? (
    <CompetitorFeed key={session.data.user.id} userId={session.data.user.id} />
  ) : (
    <GuestHome />
  )
}
