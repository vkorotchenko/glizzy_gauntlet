import type { Revision } from './api'
import { toHundredths } from './measurement'

export type HotDogRow = {
  key: string
  name: string
  inches: string
  wholeQuantity: number
  partialHundredths: number
  condiments: string[]
}

export const newHotDog = (): HotDogRow => ({
  key: crypto.randomUUID(),
  name: '',
  inches: '',
  wholeQuantity: 1,
  partialHundredths: 0,
  condiments: [],
})

export function rowItems(rows: HotDogRow[]): Revision['items'] {
  if (!rows.length) throw new Error('Add at least one hot dog before saving.')
  return rows.map((row) => {
    const unitHundredths = toHundredths(row.inches || '0')
    if (row.partialHundredths > 0 && row.partialHundredths >= unitHundredths)
      throw new Error(
        'The hot dog length must be greater than its recorded partial length.',
      )
    return {
      name: row.name.trim() || 'Hotdog',
      wholeQuantity: row.wholeQuantity,
      unitHundredths,
      partialHundredths: row.partialHundredths,
      condiments: row.condiments,
    }
  })
}
