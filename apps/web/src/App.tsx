import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createApiClient } from '@glizzy/api-client'
import { Link, Route, Routes } from 'react-router-dom'
import { AccountPage, ConfirmLinkPage, SignInPage } from './auth/AuthPages'
import {
  CompetitionEditorPage,
  CompetitionPage,
  CompetitionsPage,
  InvitationPage,
} from './competitions/CompetitionPages'

function ServiceStatus() {
  const [api] = useState(() =>
    createApiClient(new URL('/api/v1', window.location.origin).href),
  )
  const status = useQuery({
    queryKey: ['service-status'],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET('/status', { signal })
      if (error || data?.status !== 'UP') throw new Error('API unavailable')
      return data
    },
  })

  return (
    <aside className="service-card" aria-label="Connection status">
      <span className="eyebrow">Local stack</span>
      <div role="status" aria-live="polite">
        <span
          className={`status-dot ${status.isSuccess ? 'connected' : ''}`}
          aria-hidden="true"
        />
        <strong>
          {status.isPending
            ? 'Checking the API...'
            : status.isSuccess
              ? 'API and database connected'
              : 'API unavailable'}
        </strong>
      </div>
      <p>
        {status.isError
          ? 'Start the local stack, then check the connection again.'
          : 'React to Node to Spring to PostgreSQL. One connected foundation.'}
      </p>
      {status.isError && (
        <button
          className="text-button"
          disabled={status.isFetching}
          onClick={() => void status.refetch()}
        >
          {status.isFetching ? 'Checking...' : 'Check again'}
        </button>
      )}
    </aside>
  )
}

function Home() {
  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <span className="eyebrow">Good dogs. Good company.</span>
          <h1 id="hero-title">Every inch has a story.</h1>
          <p className="lede">
            A friendly hot-dog rivalry, measured your way. Keep track of your
            meals, discover local spots, and bring the whole crew along.
          </p>
          <a className="button" href="#how-it-works">
            See the game plan <span aria-hidden="true">&rarr;</span>
          </a>
          <p className="preview-note">
            Project preview. Accounts and competitions are ready; saved meals
            and maps are still in development.
          </p>
        </div>
        <div className="score-card" aria-label="Scoring example">
          <div className="score-heading">
            <span className="eyebrow">The long and short of it</span>
            <span className="ticket">Scoring example</span>
          </div>
          <div className="hotdog" aria-hidden="true">
            <div className="sausage">
              <svg viewBox="0 0 300 60" fill="none">
                <path
                  d="M10 30 Q30 5 50 30 T90 30 T130 30 T170 30 T210 30 T250 30 T290 30"
                  stroke="currentColor"
                  strokeWidth="9"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>
          <p className="score-equation">Two 8-inch dogs + a 3-inch portion</p>
          <div className="score-totals">
            <div>
              <strong>19</strong>
              <span>inches eaten</span>
            </div>
            <div>
              <strong>2</strong>
              <span>whole hot dogs</span>
            </div>
          </div>
          <p className="fine-print">
            Actual lengths. Partial portions count. No standard size assumed.
            This illustration is not a saved meal.
          </p>
        </div>
      </section>

      <section
        id="how-it-works"
        className="playbook"
        aria-labelledby="playbook-title"
      >
        <div className="section-heading">
          <span className="eyebrow">The game plan</span>
          <h2 id="playbook-title">A little friendly competition.</h2>
        </div>
        <div className="feature-grid">
          <article>
            <span className="step">01</span>
            <h3>Bring your people</h3>
            <p>
              Public or invite-only competitions, with a start, a finish, and
              clear rules for everyone.
            </p>
          </article>
          <article>
            <span className="step">02</span>
            <h3>Keep a tasty record</h3>
            <p>
              Log what you ate and where. Track inches and whole dogs
              separately, with photos if you like.
            </p>
          </article>
          <article>
            <span className="step">03</span>
            <h3>Find your next spot</h3>
            <p>
              Explore community-added venues and menu photos, then look back on
              your progress and the final recap.
            </p>
          </article>
        </div>
      </section>
      <ServiceStatus />
    </>
  )
}

export default function App() {
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <Link className="brand" to="/" aria-label="Glizzy Gauntlet home">
          <span className="brand-mark" aria-hidden="true">
            GG
          </span>
          Glizzy Gauntlet
        </Link>
        <nav className="header-links" aria-label="Main navigation">
          <Link className="account-link" to="/competitions">
            Competitions
          </Link>
          <Link className="account-link" to="/account">
            My account
          </Link>
        </nav>
      </header>
      <main id="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/sign-in/confirm" element={<ConfirmLinkPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/competitions" element={<CompetitionsPage />} />
          <Route path="/competitions/new" element={<CompetitionEditorPage />} />
          <Route path="/competitions/:id" element={<CompetitionPage />} />
          <Route
            path="/competitions/:id/settings"
            element={<CompetitionEditorPage />}
          />
          <Route path="/join" element={<InvitationPage />} />
          <Route
            path="*"
            element={
              <section className="not-found">
                <h1>This spot is not on the menu.</h1>
                <Link className="button" to="/">
                  Back home
                </Link>
              </section>
            }
          />
        </Routes>
      </main>
      <footer className="site-footer">
        <span>Glizzy Gauntlet</span>
        <span>A friendly rivalry. Eat at your own pace.</span>
      </footer>
    </div>
  )
}
