import { describe, expect, it } from 'vitest'
import { formatTime, fromInstant, supportsTimeZone, toInstant } from './time'

describe('competition time input', () => {
  it('keeps pages readable if the browser lacks a server-supported zone', () => {
    expect(supportsTimeZone('Unknown/Zone')).toBe(false)
    expect(formatTime('2026-07-01T16:00:00Z', 'Unknown/Zone')).toContain(
      'UTC fallback',
    )
  })
  it('uses the selected IANA zone instead of the device zone', () => {
    expect(toInstant('2026-07-01T12:00', 'America/New_York', 'reject')).toBe(
      '2026-07-01T16:00:00Z',
    )
  })

  it('preserves milliseconds when editing a stored instant', () => {
    const instant = '2026-07-01T16:00:00.123Z'
    const editing = fromInstant(instant, 'America/New_York')
    expect(
      toInstant(editing.local, 'America/New_York', editing.occurrence),
    ).toBe(instant)
  })

  it('rejects skipped hours even when an occurrence was selected', () => {
    for (const occurrence of ['reject', 'earlier', 'later'] as const)
      expect(() =>
        toInstant('2026-03-08T02:30', 'America/New_York', occurrence),
      ).toThrow('Skipped daylight-saving')
  })

  it('requires an explicit choice for repeated hours and preserves it when editing', () => {
    expect(() =>
      toInstant('2026-11-01T01:30', 'America/New_York', 'reject'),
    ).toThrow('repeated hours')
    expect(toInstant('2026-11-01T01:30', 'America/New_York', 'earlier')).toBe(
      '2026-11-01T05:30:00Z',
    )
    const later = toInstant('2026-11-01T01:30', 'America/New_York', 'later')
    expect(later).toBe('2026-11-01T06:30:00Z')
    const editing = fromInstant(later, 'America/New_York')
    expect(editing.occurrence).toBe('later')
    expect(
      toInstant(editing.local, 'America/New_York', editing.occurrence),
    ).toBe(later)
  })
})
