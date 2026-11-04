import type { ReactNode } from 'react'
import type { Revision } from './api'
import { photoUrl } from './api'
import { formatInches } from './measurement'
import { UserAvatar } from '../auth/UserAvatar'

export function MealSummary({
  revision,
  showTotals = true,
  photos,
}: {
  revision: Revision
  showTotals?: boolean
  photos?: ReactNode
}) {
  return (
    <div className="meal-summary">
      {photos ?? (
        <div className="photo-gallery">
          {revision.photoIds.map((id, index) => (
            <a key={id} href={photoUrl(id, false)}>
              <img
                loading="lazy"
                src={photoUrl(id)}
                alt={`Meal photo ${index + 1}`}
              />
            </a>
          ))}
        </div>
      )}
      {showTotals && (
        <p className="meal-totals">
          {revision.totalHundredths > 0 && (
            <strong>{formatInches(revision.totalHundredths)} inches</strong>
          )}
          {revision.totalHundredths > 0 && revision.wholeHotDogs > 0 && ' / '}
          {revision.wholeHotDogs > 0 &&
            `${revision.wholeHotDogs} whole hot dogs`}
        </p>
      )}
      <p>
        {new Intl.DateTimeFormat(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
          hourCycle: 'h23',
        }).format(new Date(revision.eatenAt))}
        {revision.location && ` / ${revision.location}`}
      </p>
      <ul className="meal-item-list">
        {revision.items.map((item, index) => (
          <li key={index}>
            <strong>{item.name}</strong>
            {item.wholeQuantity !== 1 && ` / ${item.wholeQuantity} whole`}
            {item.unitHundredths > 0 &&
              ` / ${formatInches(item.unitHundredths)} inches${item.wholeQuantity > 1 ? ' each' : ''}`}
            {item.partialHundredths > 0 &&
              ` + ${formatInches(item.partialHundredths)} partial inches`}
            {!!item.condiments?.length && (
              <span className="meal-condiment-list">
                {item.condiments.join(', ')}
              </span>
            )}
          </li>
        ))}
      </ul>
      {revision.notes && <p className="competition-rules">{revision.notes}</p>}
    </div>
  )
}

export function MealFeedCard({
  displayName,
  profilePhotoId,
  subtitle,
  revision,
  photos,
  children,
  actions,
  label,
}: {
  displayName: string
  profilePhotoId?: string | null
  subtitle: ReactNode
  revision: Revision
  photos?: ReactNode
  children?: ReactNode
  actions?: ReactNode
  label: string
}) {
  return (
    <article className="competition-card meal-feed-card" aria-label={label}>
      <header className="feed-card-heading">
        <UserAvatar displayName={displayName} photoId={profilePhotoId} />
        <div>
          <h2>{displayName}</h2>
          {subtitle}
        </div>
      </header>
      <MealSummary revision={revision} showTotals={false} photos={photos} />
      {children}
      <footer
        className="feed-card-actions"
        role="group"
        aria-label="Meal totals and likes"
      >
        <p className="meal-totals">
          <strong>
            {revision.wholeHotDogs}{' '}
            {revision.wholeHotDogs === 1 ? 'hot dog' : 'hot dogs'}
          </strong>
          {revision.totalHundredths > 0 && (
            <>
              {' '}
              / <span>{formatInches(revision.totalHundredths)} inches</span>
            </>
          )}
        </p>
        {actions}
      </footer>
    </article>
  )
}
