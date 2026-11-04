import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeading } from '../PageHeading'
import { Link } from 'react-router-dom'
import { loadSession } from '../auth/api'
import { listCompetitions } from '../competitions/api'
import { CompetitionCover } from '../competitions/CompetitionCover'
import { formatTime } from '../competitions/time'
import { MealFeedCard } from '../meals/MealCard'
import { formatInches } from '../meals/measurement'
import * as api from './api'

function SampleFeed() {
  return (
    <section className="sample-feed" aria-label="Sample feed">
      <h2>A taste of the feed</h2>
      <p className="form-note">
        Example data, not real people or competition scores. Choose a card to
        learn how to get started. Your crew's meals will replace these examples.
      </p>
      <div className="meal-feed">
        {[
          {
            title: 'Start a competition',
            path: '/learn/competitions',
            description:
              'See a sample competition, its rules, and its leaderboard.',
            count: 2,
            inches: '12.00',
            picnic: false,
          },
          {
            title: 'Log in or create an account',
            path: '/learn/account',
            description:
              'See the benefits of joining and how your private meal log works.',
            count: 1,
            inches: '8.00',
            picnic: true,
          },
        ].map((sample) => (
          <article
            className="competition-card meal-feed-card"
            key={sample.title}
          >
            <Link
              className="tutorial-link"
              to={sample.path}
              aria-label={sample.title}
            >
              <header className="feed-card-heading">
                <span className="feed-avatar" aria-hidden="true">
                  GG
                </span>
                <div>
                  <h2>glizzy gauntlet</h2>
                  <span className="eyebrow">Getting started / Sample meal</span>
                </div>
              </header>
              <svg
                className="sample-meal-image"
                viewBox="0 0 640 320"
                role="img"
                aria-label={
                  sample.picnic
                    ? 'Hot dog at a picnic, sample illustration'
                    : 'Hot dog with mustard, sample illustration'
                }
              >
                <rect
                  width="640"
                  height="320"
                  fill={sample.picnic ? '#dce8d3' : '#f3e0bb'}
                />
                <ellipse cx="320" cy="175" rx="240" ry="105" fill="#fffaf0" />
                <g
                  transform={
                    sample.picnic ? 'rotate(8 320 160)' : 'rotate(-8 320 160)'
                  }
                >
                  <rect
                    x="125"
                    y="106"
                    width="390"
                    height="112"
                    rx="56"
                    fill="#c58b45"
                  />
                  <rect
                    x="125"
                    y="96"
                    width="390"
                    height="104"
                    rx="52"
                    fill="#edc88c"
                  />
                  <rect
                    x="112"
                    y="123"
                    width="416"
                    height="62"
                    rx="31"
                    fill="#a73228"
                  />
                  <path
                    d="M155 154 Q175 128 195 154 T235 154 T275 154 T315 154 T355 154 T395 154 T435 154 T475 154"
                    fill="none"
                    stroke="#f7c74d"
                    strokeWidth="9"
                    strokeLinecap="round"
                  />
                  {sample.picnic && (
                    <path
                      d="M175 178 l12 -9 m42 12 l12 -9 m42 12 l12 -9 m42 12 l12 -9 m42 12 l12 -9"
                      stroke="#53804c"
                      strokeWidth="9"
                      strokeLinecap="round"
                    />
                  )}
                </g>
              </svg>
              <h3>{sample.title}</h3>
              <p className="meal-totals">
                <strong>
                  {sample.count} {sample.count === 1 ? 'hot dog' : 'hot dogs'}
                </strong>
                {' / '}
                {sample.inches} inches
              </p>
              <p className="form-note">{sample.description}</p>
            </Link>
          </article>
        ))}
      </div>
    </section>
  )
}

function MealCard({ item, userId }: { item: api.FeedItem; userId: string }) {
  const cache = useQueryClient()
  const ownMeal = item.competitionId === null
  const reaction = useMutation({
    mutationFn: (reacted: boolean) => api.setReaction(item.id, reacted),
    onSuccess: (result) => {
      cache.setQueriesData<api.FeedPage>(
        { queryKey: ['feed', userId] },
        (previous) =>
          previous && {
            ...previous,
            items: previous.items.map((entry) =>
              entry.id === item.id && entry.competitionId === item.competitionId
                ? { ...entry, ...result }
                : entry,
            ),
          },
      )
    },
  })
  return (
    <MealFeedCard
      label={
        ownMeal
          ? `${item.displayName}'s meal`
          : `${item.displayName}'s meal in ${item.competitionName}`
      }
      displayName={item.displayName}
      profilePhotoId={item.profilePhotoId}
      subtitle={
        ownMeal ? (
          <span className="form-note">Your meal</span>
        ) : (
          <Link to={`/competitions/${item.competitionId}`}>
            {item.competitionName}
          </Link>
        )
      }
      revision={item.revision}
      actions={
        ownMeal ? (
          <Link className="text-link" to={`/meals/${item.id}`}>
            View meal
          </Link>
        ) : (
          <div className="feed-card-likes">
            <span aria-live="polite">
              {item.reactionCount} {item.reactionCount === 1 ? 'like' : 'likes'}
            </span>
            <button
              type="button"
              className="like-button"
              aria-pressed={item.reacted}
              disabled={reaction.isPending}
              onClick={() => reaction.mutate(!item.reacted)}
            >
              <span aria-hidden="true">&#128077;</span>{' '}
              {item.reacted ? 'Liked' : 'Like'}
            </button>
          </div>
        )
      }
    >
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
      {reaction.error && (
        <p role="alert" className="form-error">
          {reaction.error.message}
        </p>
      )}
    </MealFeedCard>
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
      <PageHeading title="Your feed">
        <button
          className="text-button"
          disabled={feed.isFetching}
          onClick={() => (page ? setPage(0) : void feed.refetch())}
        >
          Refresh feed
        </button>
        <Link className="button" to="/meals/new">
          Log a meal
        </Link>
      </PageHeading>
      <p>
        Your meals and meals from your competitions, newest first. Like a
        competitor's post to cheer them on; likes never change scores.
      </p>
      {feed.isPending && <p role="status">Loading meals...</p>}
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
                {page ? 'No older meals.' : 'Your feed is quiet for now.'}
              </h2>
              <p>Log a meal or join a competition to see meals here.</p>
              <Link to="/competitions">Find a competition</Link>
            </div>
          )}
          {page === 0 && feed.data.items.length === 0 && <SampleFeed />}
          <div className="meal-feed">
            {feed.data.items.map((item) => (
              <MealCard
                key={`${item.competitionId ?? 'own'}:${item.id}`}
                item={item}
                userId={userId}
              />
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
        Your meals appear once; other members' meals can appear in each shared
        competition, with separate likes.
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
        <PageHeading title="Your feed starts here.">
          <Link className="button" to="/sign-in">
            Sign in to see your feed
          </Link>
        </PageHeading>
        <p>
          Sign in to see your competitors' latest meals, track your own bites,
          and send a glizzy when someone deserves a cheer.
        </p>
        <p className="form-note">
          Meal details and photos stay within joined competitions.
        </p>
      </div>
      <SampleFeed />
      <PageHeading title="Explore public competitions" level={2}>
        <Link to="/competitions">Browse all competitions</Link>
      </PageHeading>
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
            <CompetitionCover competition={competition} thumbnail />
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
        <PageHeading title="Your crew is waiting." />
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
