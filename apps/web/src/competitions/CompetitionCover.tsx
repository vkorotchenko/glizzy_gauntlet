import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from './api'

export function CompetitionCover({
  competition,
  thumbnail = false,
}: {
  competition: api.Competition
  thumbnail?: boolean
}) {
  return competition.coverPhotoId ? (
    <img
      className="competition-cover"
      src={api.coverPhotoUrl(competition, thumbnail)}
      alt={`${competition.name} cover photo`}
      loading={thumbnail ? 'lazy' : 'eager'}
      width={1600}
      height={900}
    />
  ) : null
}

export function CompetitionCoverInput({
  file,
  change,
  disabled,
}: {
  file: File | null
  change: (file: File | null) => void
  disabled: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const preview = useRef<HTMLImageElement>(null)
  const [error, setError] = useState('')
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
    <fieldset className="competition-cover-picker" disabled={disabled}>
      <legend>Cover photo (optional)</legend>
      {file && (
        <img
          ref={preview}
          className="competition-cover"
          alt="Selected cover photo preview"
          width={1600}
          height={900}
        />
      )}
      <label htmlFor="competition-cover">Choose cover photo</label>
      <input
        ref={input}
        id="competition-cover"
        type="file"
        accept="image/jpeg,image/png"
        aria-describedby="competition-cover-hint"
        onChange={(event) => {
          const next = event.target.files?.[0]
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
          setError('')
          change(next)
        }}
      />
      <p className="form-note" id="competition-cover-hint">
        Use a landscape JPEG or PNG up to 5 MiB.
      </p>
      {file && (
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setError('')
            change(null)
          }}
        >
          Clear selected photo
        </button>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </fieldset>
  )
}

export function CompetitionCoverEditor({
  competition,
}: {
  competition: api.Competition
}) {
  const cache = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const save = useMutation({
    mutationFn: (selected: File | null) =>
      selected
        ? api.uploadCompetitionCover(
            competition.id,
            competition.version,
            selected,
          )
        : api.removeCompetitionCover(competition.id, competition.version),
    onSuccess: async (result) => {
      setFile(null)
      cache.setQueryData(['competitions', 'detail', result.id], result)
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['competitions'] }),
        cache.invalidateQueries({ queryKey: ['home-public-competitions'] }),
      ])
    },
  })
  return (
    <details className="competition-cover-editor">
      <summary>Manage cover photo</summary>
      <form
        className="competition-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (file) save.mutate(file)
        }}
      >
        <CompetitionCoverInput
          file={file}
          change={setFile}
          disabled={save.isPending}
        />
        <p className="form-note">
          Covers follow competition visibility and can change after settings
          lock.
        </p>
        <div className="competition-actions">
          {competition.coverPhotoId && (
            <button
              type="button"
              className="text-button"
              disabled={save.isPending}
              onClick={() => save.mutate(null)}
            >
              Remove cover photo
            </button>
          )}
          <button className="button" disabled={!file || save.isPending}>
            {save.isPending ? 'Saving cover...' : 'Save cover photo'}
          </button>
        </div>
        {save.error && (
          <p role="alert" className="form-error">
            {save.error.message}
          </p>
        )}
        {save.isSuccess && <p role="status">Cover photo updated.</p>}
      </form>
    </details>
  )
}
