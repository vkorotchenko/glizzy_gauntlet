import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { UserAvatar } from './UserAvatar'
import * as api from './api'

export function ProfilePhotoEditor({ user }: { user: api.Profile }) {
  const cache = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const preview = useRef<HTMLImageElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const save = useMutation({
    mutationFn: (selected: File | null) =>
      selected
        ? api.uploadProfilePhoto(selected, user.profilePhotoId ?? null)
        : api.removeProfilePhoto(user.profilePhotoId ?? null),
    onSuccess: async (profile) => {
      setFile(null)
      cache.setQueryData<Awaited<ReturnType<typeof api.loadSession>>>(
        ['session'],
        (previous) =>
          previous?.user?.id === profile.id
            ? { ...previous, user: profile }
            : previous,
      )
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['session'] }),
        cache.invalidateQueries({ queryKey: ['feed'] }),
      ])
    },
  })
  useEffect(() => {
    if (!file) {
      if (input.current) input.current.value = ''
      return
    }
    const url = URL.createObjectURL(file)
    if (preview.current) preview.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])
  return (
    <section aria-label="Profile picture">
      <h2>Profile picture</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (file) save.mutate(file)
        }}
      >
        <fieldset className="profile-photo-picker" disabled={save.isPending}>
          <legend className="sr-only">Manage profile picture</legend>
          <div className="profile-photo-previews">
            <UserAvatar
              displayName={user.displayName}
              photoId={user.profilePhotoId}
              className="profile-avatar"
            />
            {file && (
              <img
                ref={preview}
                className="profile-photo-preview"
                alt="Selected profile picture preview"
                width={96}
                height={96}
              />
            )}
          </div>
          <label htmlFor="profile-photo">Choose profile picture</label>
          <input
            ref={input}
            id="profile-photo"
            type="file"
            accept="image/jpeg,image/png"
            aria-describedby="profile-photo-hint"
            onChange={(event) => {
              const next = event.target.files?.[0]
              save.reset()
              setFile(null)
              setError('')
              if (!next) return
              if (!['image/jpeg', 'image/png'].includes(next.type)) {
                setError('Choose a JPEG or PNG image.')
                event.target.value = ''
                return
              }
              if (next.size === 0 || next.size > 5 * 1024 * 1024) {
                setError('Choose a JPEG or PNG no larger than 5 MiB.')
                event.target.value = ''
                return
              }
              setFile(next)
            }}
          />
          <p className="form-note" id="profile-photo-hint">
            JPEG or PNG, up to 5 MiB.
          </p>
          <p className="form-note">
            Visible to signed-in members of competitions you share.
          </p>
          <div className="competition-actions">
            {file && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setFile(null)
                  save.reset()
                }}
              >
                Clear selected picture
              </button>
            )}
            {user.profilePhotoId && (
              <button
                type="button"
                className="text-button"
                onClick={() => save.mutate(null)}
              >
                Remove profile picture
              </button>
            )}
            <button className="button" disabled={!file || save.isPending}>
              {save.isPending ? 'Saving picture...' : 'Save profile picture'}
            </button>
          </div>
        </fieldset>
        {(error || save.error) && (
          <p role="alert" className="form-error">
            {error || save.error?.message}
          </p>
        )}
        {save.isSuccess && <p role="status">Profile picture updated.</p>}
      </form>
    </section>
  )
}
