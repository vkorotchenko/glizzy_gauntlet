import { useEffect, useRef, useState } from 'react'
import type { Map as LibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Venue } from './api'

export default function VenueMap({ venues }: { venues: Venue[] }) {
  const container = useRef<HTMLDivElement>(null)
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => {
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
          const link = document.createElement('a')
          link.href = `/venues/${encodeURIComponent(venue.id)}`
          link.textContent = venue.name
          const marker = new Marker()
            .setLngLat(point)
            .setPopup(new Popup().setDOMContent(link))
            .addTo(map)
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
    }
  }, [venues])
  return (
    <>
      {unavailable && (
        <p role="status">
          Map unavailable. All venues are still in the list below.
        </p>
      )}
      <div
        className="venue-map"
        ref={container}
        role="region"
        aria-label="Approved venue map"
      />
      <p className="form-note">
        Map shows only this page&apos;s listings. Tiles:{' '}
        <a href="https://openfreemap.org/">OpenFreeMap</a>. Data: &copy;{' '}
        <a href="https://www.openstreetmap.org/copyright">
          OpenStreetMap contributors
        </a>
        .
      </p>
    </>
  )
}
