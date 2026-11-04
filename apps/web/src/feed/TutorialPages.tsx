import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { PageHeading } from '../PageHeading'
import { loadSession } from '../auth/api'
import { ResultsTable } from '../progress/ProgressPages'

function useAccount() {
  return useQuery({
    queryKey: ['session'],
    queryFn: ({ signal }) => loadSession(signal),
    retry: false,
  })
}

export function CompetitionTutorialPage() {
  return (
    <section className="competition-page">
      <Link to="/">Back to feed</Link>
      <span className="eyebrow">Getting started</span>
      <PageHeading title="Start a competition">
        <Link className="button" to="/competitions">
          View competitions
        </Link>
      </PageHeading>
      <p>
        Choose a name, dates, and rules for a friendly rivalry. Track hot dog
        count, inches, or both, and eat at your own pace.
      </p>
      <article className="competition-card">
        <span className="eyebrow">Example only / Not a real competition</span>
        <h2>The weekend crew</h2>
        <p>Public or invitation-only / Your chosen dates / Hot dog count</p>
        <h3>Example rules</h3>
        <p>
          Log what you actually ate. Photos, location, and time are optional.
          Enjoy your food without rushing.
        </p>
        <ResultsTable
          trackingMode="COUNT"
          caption="Example competition standings"
          items={[
            {
              rank: 1,
              displayName: 'Mustard captain',
              totalHundredths: 0,
              wholeHotDogs: 5,
            },
            {
              rank: 2,
              displayName: 'Relish rookie',
              totalHundredths: 0,
              wholeHotDogs: 3,
            },
            {
              rank: 2,
              displayName: 'Bun buddy',
              totalHundredths: 0,
              wholeHotDogs: 3,
            },
          ]}
        />
        <p className="form-note">
          These display names and scores are made up. Nothing in this preview
          joins a competition or changes a score.
        </p>
      </article>
    </section>
  )
}

export function AccountTutorialPage() {
  const session = useAccount()
  return (
    <section className="competition-page narrow">
      <Link to="/">Back to feed</Link>
      <span className="eyebrow">Getting started</span>
      <PageHeading title="Log in or create an account">
        <Link
          className="button"
          to={session.data?.user ? '/account' : '/sign-in'}
        >
          {session.data?.user
            ? 'Go to your profile'
            : 'Sign in or create your account'}
        </Link>
      </PageHeading>
      <p>
        The same sign-in flow welcomes new and returning members. Use email or
        Google when configured; your first confirmed sign-in creates your
        account.
      </p>
      <h2>Your seat at the table</h2>
      <ul className="member-list">
        <li>
          <strong>A simple private meal log.</strong> Record hot dog count or
          measured inches. Add photos, location, and time only if you want.
        </li>
        <li>
          <strong>Your crew's feed.</strong> See meals shared in joined
          competitions and like a post to cheer someone on.
        </li>
        <li>
          <strong>Competitions and progress.</strong> Create your own event,
          accept invitations, and follow your personal totals.
        </li>
        <li>
          <strong>A venue map.</strong> Find community-listed spots and suggest
          venues from your profile.
        </li>
        <li>
          <strong>An all-time leaderboard.</strong> Accounts join by default,
          but meals are shared only when you explicitly submit them. You can
          leave and rejoin.
        </li>
      </ul>
      <p>
        Your email is not your public display name. Private source meals stay
        private; submitted details and photos are visible to that competition's
        members, and public standings show nicknames and totals.
      </p>
    </section>
  )
}
