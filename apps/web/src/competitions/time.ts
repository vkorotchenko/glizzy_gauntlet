import { Temporal } from '@js-temporal/polyfill'

export type Occurrence = 'reject' | 'earlier' | 'later'

export function toInstant(local: string, zone: string, occurrence: Occurrence) {
  try {
    const plain = Temporal.PlainDateTime.from(local)
    const zoned = plain.toZonedDateTime(zone, { disambiguation: occurrence })
    if (!zoned.toPlainDateTime().equals(plain)) throw new RangeError()
    return zoned.toInstant().toString()
  } catch {
    throw new Error(
      'Check the time zone and dates. Skipped daylight-saving times do not exist; repeated hours need a first or second occurrence.',
    )
  }
}

export function fromInstant(instant: string, zone: string) {
  const zoned = Temporal.Instant.from(instant).toZonedDateTimeISO(zone)
  const plain = zoned.toPlainDateTime()
  const first = plain.toZonedDateTime(zone, { disambiguation: 'earlier' })
  return {
    local: plain.toString({ smallestUnit: 'millisecond' }),
    occurrence: (first.epochNanoseconds === zoned.epochNanoseconds
      ? 'earlier'
      : 'later') as Occurrence,
  }
}

export function formatTime(instant: string, zone: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      dateStyle: 'medium',
      timeStyle: 'long',
    }).format(new Date(instant))
  } catch {
    return `${new Date(instant).toISOString()} (UTC fallback; time zone unavailable)`
  }
}

export function supportsTimeZone(zone: string) {
  try {
    Temporal.Instant.from('2000-01-01T00:00:00Z').toZonedDateTimeISO(zone)
    return true
  } catch {
    return false
  }
}
