import { useEffect, useRef, useState } from 'react'
import type { Map as LibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Venue } from './api'

export default function VenueMap({
  venues,
  selectedId,
  onSelect,
}: {
  venues: Venue[]
  selectedId?: string
  onSelect?: (venue: Venue) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const [unavailable, setUnavailable] = useState(false)
  const selection = useRef({ selectedId, onSelect })
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const selectable = Boolean(onSelect)
  useEffect(() => {
    selection.current = { selectedId, onSelect }
    for (const [id, button] of buttons.current)
      button.setAttribute('aria-pressed', String(id === selectedId))
  }, [selectedId, onSelect])
  useEffect(() => {
    const markerButtons = buttons.current
    let active = true
    let map: LibreMap | undefined
    void import('maplibre-gl')
      .then(({ Map, Marker, Popup, LngLatBounds }) => {
        if (!active || !container.current) return
        map = new Map({
          container: container.current,
          style:
            import.meta.env.VITE_MAP_STYLE_URL ??
            'https://tiles.openfreemap.org/styles/liberty',
          center: venues.length
            ? [venues[0].longitude, venues[0].latitude]
            : [0, 20],
          zoom: venues.length ? 11 : 1,
          attributionControl: { compact: false },
        })
        map.on('error', () => {
          if (active) setUnavailable(true)
        })
        const bounds = new LngLatBounds()
        for (const venue of venues) {
          const point: [number, number] = [venue.longitude, venue.latitude]
          const content = document.createElement(selectable ? 'span' : 'a')
          if (content instanceof HTMLAnchorElement)
            content.href = `/venues/${encodeURIComponent(venue.id)}`
          content.textContent = selectable
            ? `${venue.name} / ${venue.address}`
            : venue.name
          let element: HTMLButtonElement | undefined
          if (selectable) {
            element = document.createElement('button')
            element.type = 'button'
            element.className = 'venue-map-marker'
            element.setAttribute('aria-label', `Select ${venue.name}`)
            element.setAttribute(
              'aria-pressed',
              String(venue.id === selection.current.selectedId),
            )
            element.addEventListener('click', () =>
              selection.current.onSelect?.(venue),
            )
            markerButtons.set(venue.id, element)
          }
          const marker = new Marker(element ? { element } : undefined)
            .setLngLat(point)
            .setPopup(new Popup().setDOMContent(content))
            .addTo(map)
          if (!selectable)
            marker.getElement().setAttribute('aria-label', venue.name)
          bounds.extend(point)
        }
        if (venues.length > 1)
          map.fitBounds(bounds, { padding: 45, maxZoom: 13, duration: 0 })
      })
      .catch(() => {
        if (active) setUnavailable(true)
      })
    return () => {
      active = false
      map?.remove()
      markerButtons.clear()
    }
  }, [venues, selectable])
  return (
    <>
      {unavailable && (
        <p role="status">
          {selectable
            ? 'Map unavailable. Switch to List to choose a venue, or refresh to try again.'
            : 'Map unavailable. Refresh the page to try loading it again.'}
        </p>
      )}
      <div
        className="venue-map"
        ref={container}
        role="region"
        aria-label="Approved venue map"
      />
      <p className="form-note">
        Map shows the approved venue directory. Tiles:{' '}
        <a href="https://openfreemap.org/">OpenFreeMap</a>. Data: &copy;{' '}
        <a href="https://www.openstreetmap.org/copyright">
          OpenStreetMap contributors
        </a>
        .
      </p>
    </>
  )
}
