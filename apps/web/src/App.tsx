import { useQuery } from '@tanstack/react-query'
import { PageHeading } from './PageHeading'
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom'
import {
  AccountLayout,
  AccountPage,
  ConfirmLinkPage,
  SignInPage,
} from './auth/AuthPages'
import { loadSession } from './auth/api'
import { RoleManagementPage } from './auth/RoleManagementPage'
import { HomePage } from './feed/FeedPage'
import {
  CompetitionEditorPage,
  CompetitionPage,
  CompetitionsPage,
  MyCompetitionsPage,
  InvitationPage,
} from './competitions/CompetitionPages'
import {
  ContributionEditorPage,
  ContributionPage,
  ContributionsPage,
  DirectoryPage,
  VenuePage,
} from './directory/DirectoryPages'
import { MealEditorPage, MealPage, MealsPage } from './meals/MealPages'
import { ProgressPage } from './progress/ProgressPages'
import { CorrectionsPage, RecapPage } from './recaps/RecapPages'
import {
  AccountTutorialPage,
  CompetitionTutorialPage,
} from './feed/TutorialPages'

export default function App() {
  const session = useQuery({
    queryKey: ['session'],
    queryFn: ({ signal }) => loadSession(signal),
    retry: false,
  })
  const signedIn = Boolean(session.data?.user)
  const privatePage = (page: ReactElement) =>
    session.isPending ? (
      <p role="status">Loading your account...</p>
    ) : signedIn ? (
      page
    ) : (
      <section className="auth-card">
        <PageHeading title="Sign in to continue">
          <Link className="button" to="/sign-in">
            Sign in or create an account
          </Link>
        </PageHeading>
        <p>This page is available after you sign in.</p>
      </section>
    )

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
          <NavLink className="account-link" to="/" end>
            Feed
          </NavLink>
          {signedIn && (
            <NavLink className="account-link" to="/venues">
              Venues
            </NavLink>
          )}
          <NavLink className="account-link" to="/competitions">
            Competitions
          </NavLink>
          {signedIn ? (
            <NavLink className="account-link" to="/account">
              My account
            </NavLink>
          ) : (
            <NavLink className="button" to="/sign-in">
              Sign in
            </NavLink>
          )}
        </nav>
      </header>
      <main id="main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route
            path="/learn/competitions"
            element={<CompetitionTutorialPage />}
          />
          <Route path="/learn/account" element={<AccountTutorialPage />} />
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/sign-in/confirm" element={<ConfirmLinkPage />} />
          <Route path="/account" element={<AccountLayout />}>
            <Route index element={<AccountPage />} />
            <Route
              path="competitions"
              element={privatePage(<MyCompetitionsPage />)}
            />
            <Route
              path="contributions"
              element={privatePage(<ContributionsPage />)}
            />
            <Route
              path="contributions/review"
              element={privatePage(<ContributionsPage scope="pending" />)}
            />
            <Route
              path="contributions/all"
              element={privatePage(<ContributionsPage scope="all" />)}
            />
            <Route path="meals" element={privatePage(<MealsPage />)} />
            <Route path="roles" element={privatePage(<RoleManagementPage />)} />
          </Route>
          <Route
            path="/meals"
            element={<Navigate to="/account/meals" replace />}
          />
          <Route path="/meals/new" element={<MealEditorPage />} />
          <Route path="/meals/:id" element={<MealPage />} />
          <Route path="/meals/:id/edit" element={<MealEditorPage />} />
          <Route path="/venues" element={privatePage(<DirectoryPage />)} />
          <Route
            path="/venues/new"
            element={privatePage(<ContributionEditorPage />)}
          />
          <Route path="/venues/:id" element={privatePage(<VenuePage />)} />
          <Route
            path="/venues/:id/suggest"
            element={privatePage(<ContributionEditorPage />)}
          />
          <Route
            path="/directory/contributions/:id"
            element={privatePage(<ContributionPage />)}
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
                <PageHeading title="This spot is not on the menu.">
                  <Link className="button" to="/">
                    Back home
                  </Link>
                </PageHeading>
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
import type { ReactElement } from 'react'
