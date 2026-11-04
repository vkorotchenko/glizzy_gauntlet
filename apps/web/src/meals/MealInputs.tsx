import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { formatInches } from './measurement'
import { newHotDog, type HotDogRow } from './mealRows'

export function Popup({
  title,
  children,
  close,
}: {
  title: string
  children: ReactNode
  close: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current!
    const previousFocus = document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      if (previousFocus instanceof HTMLElement) previousFocus.focus()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className="meal-popup"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className="meal-popup-content">
        <h2 id={titleId}>{title}</h2>
        {children}
        <button type="button" className="button" onClick={close}>
          Done
        </button>
      </div>
    </dialog>
  )
}

export function InfoPopup({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="info-button"
        aria-label={title}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">i</span>
      </button>
      {open && (
        <Popup title={title} close={() => setOpen(false)}>
          {children}
        </Popup>
      )}
    </>
  )
}

const condiments = [
  'Ketchup',
  'Mustard',
  'Relish',
  'Onions',
  'Sauerkraut',
  'Pickles',
  'Jalapenos',
  'Chili',
  'Cheese',
  'Mayonnaise',
  'BBQ sauce',
  'Hot sauce',
]

export function HotDogInputs({
  rows,
  change,
  tracksLength,
}: {
  rows: HotDogRow[]
  change: (rows: HotDogRow[]) => void
  tracksLength: boolean
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const current = rows.find((row) => row.key === editing)
  const update = (key: string, patch: Partial<HotDogRow>) =>
    change(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  return (
    <section className="hot-dog-inputs" aria-label="Hot dogs">
      <div className="meal-section-heading">
        <h2>Your hot dogs</h2>
        <InfoPopup title="About hot dog rows">
          <p>
            Each new row is one whole hot dog. Add or duplicate rows to log
            more.
          </p>
          <p>
            Inches are the length of that hot dog, with at most two decimal
            places. Condiments are descriptive and never change your score.
          </p>
          <p>
            Older measured rows retain their original quantities and partial
            lengths.
          </p>
        </InfoPopup>
      </div>
      <ol className="hot-dog-rows">
        {rows.map((row, index) => (
          <li
            key={row.key}
            className={`hot-dog-row${tracksLength ? ' with-inches' : ''}`}
          >
            <label className="hot-dog-description">
              <span>
                Description{' '}
                <span className="sr-only">for hot dog {index + 1}</span>
              </span>
              <input
                placeholder="hotdog"
                maxLength={120}
                value={row.name}
                onChange={(event) =>
                  update(row.key, { name: event.target.value })
                }
              />
            </label>
            {tracksLength && (
              <label>
                <span>
                  Inches{' '}
                  <span className="sr-only">for hot dog {index + 1}</span>
                </span>
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={row.inches}
                  onChange={(event) =>
                    update(row.key, { inches: event.target.value })
                  }
                />
              </label>
            )}
            <button
              type="button"
              className="row-icon-button condiment-button"
              aria-label={`Condiments for hot dog ${index + 1}${row.condiments.length ? ` (${row.condiments.length} selected)` : ''}`}
              aria-haspopup="dialog"
              onClick={() => setEditing(row.key)}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M10 3h4v4l3 4v9H7v-9l3-4V3Z"
                  fill="#efc34d"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M10 3V1h4v2M7 13h10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
              {row.condiments.length > 0 && (
                <span className="condiment-count">{row.condiments.length}</span>
              )}
            </button>
            <button
              type="button"
              className="row-icon-button"
              aria-label={`Remove hot dog ${index + 1}`}
              disabled={rows.length === 1}
              onClick={() =>
                change(rows.filter((item) => item.key !== row.key))
              }
            >
              <span aria-hidden="true">&#215;</span>
            </button>
            <button
              type="button"
              className="row-icon-button"
              aria-label={`Duplicate hot dog ${index + 1}`}
              disabled={rows.length >= 20}
              onClick={() =>
                change([
                  ...rows.slice(0, index + 1),
                  {
                    ...row,
                    key: crypto.randomUUID(),
                    condiments: [...row.condiments],
                  },
                  ...rows.slice(index + 1),
                ])
              }
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <rect x="8" y="8" width="12" height="12" rx="2" />
                <path d="M15 5V4H4v11h1" />
              </svg>
            </button>
            {(row.wholeQuantity !== 1 || row.partialHundredths > 0) && (
              <span className="hot-dog-legacy-quantity">
                Recorded row: {row.wholeQuantity} whole
                {row.partialHundredths > 0 &&
                  ` + ${formatInches(row.partialHundredths)} partial inches`}
              </span>
            )}
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="add-hot-dog"
        disabled={rows.length >= 20}
        onClick={() => change([...rows, newHotDog()])}
      >
        <span aria-hidden="true">+</span> Add hot dog
      </button>
      {rows.length >= 20 && (
        <p className="form-note">Maximum 20 rows per meal.</p>
      )}
      {current && (
        <Popup
          title={`Condiments for hot dog ${rows.indexOf(current) + 1}`}
          close={() => setEditing(null)}
        >
          <div className="condiment-options">
            {[...new Set([...condiments, ...current.condiments])].map(
              (name) => (
                <label key={name} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={current.condiments.includes(name)}
                    disabled={
                      !current.condiments.includes(name) &&
                      current.condiments.length >= 12
                    }
                    onChange={(event) =>
                      update(current.key, {
                        condiments: event.target.checked
                          ? [...current.condiments, name]
                          : current.condiments.filter((item) => item !== name),
                      })
                    }
                  />
                  {name}
                </label>
              ),
            )}
          </div>
        </Popup>
      )}
    </section>
  )
}
