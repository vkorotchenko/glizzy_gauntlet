import { useQuery } from '@tanstack/react-query'
import { Link, Route, Routes } from 'react-router-dom'
import { AccountPage, ConfirmLinkPage, SignInPage } from './auth/AuthPages'
import { loadSession } from './auth/api'
import { HomePage } from './feed/FeedPage'
import {
  CompetitionEditorPage,
  CompetitionPage,
  CompetitionsPage,
  InvitationPage,
} from './competitions/CompetitionPages'
import {
  ContributionEditorPage,
  ContributionPage,
  DirectoryPage,
  VenuePage,
} from './directory/DirectoryPages'
import { MealEditorPage, MealPage, MealsPage } from './meals/MealPages'
import { ProgressPage } from './progress/ProgressPages'
import { CorrectionsPage, RecapPage } from './recaps/RecapPages'

export default function App() {
  const session = useQuery({
    queryKey: ['session'],
    queryFn: ({ signal }) => loadSession(signal),
    retry: false,
  })
  const signedIn = Boolean(session.data?.user)

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
          {signedIn && (
            <Link className="account-link" to="/meals">
              My meals
            </Link>
          )}
          <Link className="account-link" to="/venues">
            Venues
          </Link>
          <Link className="account-link" to="/competitions">
            Competitions
          </Link>
          {signedIn ? (
            <Link className="account-link" to="/account">
              My account
            </Link>
          ) : (
            <Link className="button" to="/sign-in">
              Sign in
            </Link>
          )}
        </nav>
      </header>
      <main id="main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/sign-in/confirm" element={<ConfirmLinkPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/meals" element={<MealsPage />} />
          <Route path="/meals/new" element={<MealEditorPage />} />
          <Route path="/meals/:id" element={<MealPage />} />
          <Route path="/meals/:id/edit" element={<MealEditorPage />} />
          <Route path="/venues" element={<DirectoryPage />} />
          <Route path="/venues/new" element={<ContributionEditorPage />} />
          <Route path="/venues/:id" element={<VenuePage />} />
          <Route
            path="/venues/:id/suggest"
            element={<ContributionEditorPage />}
          />
          <Route
            path="/directory/contributions/:id"
            element={<ContributionPage />}
          />
          <Route path="/competitions" element={<CompetitionsPage />} />
          <Route path="/competitions/new" element={<CompetitionEditorPage />} />
          <Route path="/competitions/:id" element={<CompetitionPage />} />
          <Route path="/competitions/:id/progress" element={<ProgressPage />} />
          <Route path="/competitions/:id/recap" element={<RecapPage />} />
          <Route
            path="/competitions/:id/corrections"
            element={<CorrectionsPage />}
          />
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
