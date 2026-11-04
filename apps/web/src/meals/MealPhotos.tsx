import * as api from './api'
import { InfoPopup } from './MealInputs'
import { MAX_MEAL_PHOTOS, type useMealPhotos } from './useMealPhotos'

type Photos = Omit<ReturnType<typeof useMealPhotos>, 'connectInput'>

export function MealPhotoDropzone({
  selected,
  photos,
}: {
  selected: string[]
  photos: Photos
}) {
  return (
    <button
      type="button"
      className={`meal-photo-dropzone${selected.length ? ' has-photos' : ''}`}
      aria-label="Add meal photos: choose or drag and drop"
      disabled={photos.upload.isPending || photos.discard.isPending}
      onClick={photos.choose}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(event) => {
        event.preventDefault()
        photos.uploadFiles(Array.from(event.dataTransfer.files))
      }}
    >
      {selected.length ? (
        <span className="meal-preview-photos">
          {selected.map((id, index) => (
            <img
              key={id}
              src={api.photoUrl(id)}
              alt={`Meal preview photo ${index + 1}`}
            />
          ))}
        </span>
      ) : (
        <span className="meal-photo-placeholder">
          <svg
            viewBox="0 0 48 48"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <rect x="5" y="12" width="38" height="29" rx="4" />
            <path d="m15 12 4-6h10l4 6" />
            <circle cx="24" cy="26" r="8" />
            <path d="M37 18v6m-3-3h6" />
          </svg>
          <strong>Add your meal photos</strong>
          <span>Click or drag and drop up to 3 photos</span>
        </span>
      )}
      <span className="meal-photo-caption">
        {photos.upload.isPending
          ? 'Uploading photos...'
          : `${selected.length} / 3 photos`}
      </span>
    </button>
  )
}

export function MealPhotoPicker({
  selected,
  change,
  photos,
  connectInput,
}: {
  selected: string[]
  change: (ids: string[]) => void
  photos: Photos
  connectInput: (element: HTMLInputElement | null) => void
}) {
  const available = [...new Set([...selected, ...(photos.staged.data ?? [])])]
  return (
    <section
      className="competition-section meal-photo-picker"
      aria-label="Meal photos"
    >
      <div className="meal-section-heading">
        <h2>Photos</h2>
        <InfoPopup title="About meal photos">
          <p>
            Attach up to 3 JPEG or PNG photos per meal, no larger than 5 MiB and
            12 megapixels each (6000 pixels per side). Metadata is removed.
          </p>
          <p>
            Photos stay private unless shared with a selected competition.
            Removing a photo here does not change older revisions or
            submissions.
          </p>
          <p>Unattached uploads can be reused or discarded below.</p>
        </InfoPopup>
      </div>
      <label htmlFor="meal-photo-file">Add photos (up to 3)</label>
      <input
        ref={connectInput}
        id="meal-photo-file"
        type="file"
        multiple
        accept="image/jpeg,image/png"
        disabled={photos.upload.isPending || selected.length >= MAX_MEAL_PHOTOS}
        onChange={photos.onChange}
      />
      {photos.upload.isPending && <p role="status">Uploading photos...</p>}
      {[photos.upload.error, photos.staged.error, photos.discard.error].map(
        (error, index) =>
          error ? (
            <p key={index} role="alert" className="form-error">
              {error.message}
            </p>
          ) : null,
      )}
      {selected.length > MAX_MEAL_PHOTOS && (
        <p role="alert">
          This older meal has more than 3 photos; remove photos before saving a
          new revision.
        </p>
      )}
      {available.length > 0 && (
        <div className="meal-photo-options">
          {available.map((id, index) => (
            <div className="meal-photo-option" key={id}>
              <img
                src={api.photoUrl(id)}
                alt={`Available meal photo ${index + 1}`}
              />
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={selected.includes(id)}
                  disabled={
                    photos.upload.isPending ||
                    (!selected.includes(id) &&
                      selected.length >= MAX_MEAL_PHOTOS)
                  }
                  onChange={(event) =>
                    change(
                      event.target.checked
                        ? [...selected, id]
                        : selected.filter((photo) => photo !== id),
                    )
                  }
                />
                Attach photo {index + 1}
              </label>
              {photos.staged.data?.includes(id) && (
                <button
                  type="button"
                  className="text-button"
                  disabled={photos.discard.isPending || photos.upload.isPending}
                  onClick={() => photos.discard.mutate(id)}
                >
                  Discard unattached photo {index + 1}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
