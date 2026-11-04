import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import VenueMap from './VenueMap'
import type { Venue } from './api'

const state = vi.hoisted(() => ({
  maps: [] as { remove: ReturnType<typeof vi.fn> }[],
  contents: [] as HTMLElement[],
}))

vi.mock('maplibre-gl', () => {
  class Map {
    container: HTMLElement
    remove = vi.fn(() => this.container.replaceChildren())
    constructor({ container }: { container: HTMLElement }) {
      this.container = container
      state.maps.push(this)
    }
    on() {}
    fitBounds() {}
  }
  class Popup {
    setDOMContent(content: HTMLElement) {
      state.contents.push(content)
      return this
    }
  }
  class Marker {
    element: HTMLElement
    constructor(options?: { element: HTMLElement }) {
      this.element = options?.element ?? document.createElement('div')
    }
    setLngLat() {
      return this
    }
    setPopup() {
      return this
    }
    addTo(map: Map) {
      map.container.append(this.element)
      return this
    }
    getElement() {
      return this.element
    }
  }
  class LngLatBounds {
    extend() {}
  }
  return { Map, Marker, Popup, LngLatBounds }
})

const venues: Venue[] = [
  {
    id: 'map-venue',
    revision: 'map-revision',
    name: 'Map stand',
    address: 'Main street',
    description: '',
    latitude: 40,
    longitude: -74,
    photos: [],
    menuItems: [],
  },
]

beforeEach(() => {
  state.maps.length = 0
  state.contents.length = 0
})

describe('venue map selection', () => {
  it('selects venues without submitting or navigating and updates selection without resetting the map', async () => {
    const choose = vi.fn()
    const view = render(<VenueMap venues={venues} onSelect={choose} />)
    const marker = await screen.findByRole('button', {
      name: 'Select Map stand',
    })
    expect(marker).toHaveAttribute('type', 'button')
    expect(marker).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(marker)
    expect(choose).toHaveBeenCalledWith(venues[0])
    expect(
      screen.queryByRole('link', { name: 'Map stand' }),
    ).not.toBeInTheDocument()
    const updated = vi.fn()
    view.rerender(
      <VenueMap
        venues={venues}
        selectedId={venues[0]!.id}
        onSelect={updated}
      />,
    )
    expect(marker).toHaveAttribute('aria-pressed', 'true')
    expect(state.maps).toHaveLength(1)
    fireEvent.click(marker)
    expect(updated).toHaveBeenCalledWith(venues[0])
    view.unmount()
    expect(state.maps[0]!.remove).toHaveBeenCalledOnce()
  })

  it('retains venue detail links when used as the directory map', async () => {
    render(<VenueMap venues={venues} />)
    await waitFor(() => expect(state.contents).toHaveLength(1))
    expect(state.contents[0]).toHaveAttribute('href', '/venues/map-venue')
    expect(state.contents[0]).toHaveTextContent('Map stand')
  })
})
