import { useState } from 'react'
import { profilePhotoUrl } from './api'

export function UserAvatar({
  displayName,
  photoId,
  className = '',
  decorative = false,
}: {
  displayName: string
  photoId?: string | null
  className?: string
  decorative?: boolean
}) {
  const [failedPhoto, setFailedPhoto] = useState<string>()
  return (
    <span
      className={`feed-avatar user-avatar ${className}`}
      aria-hidden={decorative || undefined}
    >
      {photoId && failedPhoto !== photoId ? (
        <img
          key={photoId}
          src={profilePhotoUrl(photoId)}
          alt={decorative ? '' : `${displayName}'s profile picture`}
          onError={() => setFailedPhoto(photoId)}
          width={400}
          height={400}
        />
      ) : (
        <span aria-hidden="true">
          {displayName.trim().slice(0, 1).toUpperCase() || '?'}
        </span>
      )}
    </span>
  )
}
