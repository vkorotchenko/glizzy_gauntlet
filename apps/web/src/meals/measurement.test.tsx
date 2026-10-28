import { describe, expect, it } from 'vitest'
import { formatInches, toHundredths, wholeQuantity } from './measurement'

describe('measurement boundaries', () => {
  it('converts decimal input exactly without rounding binary floats', () => {
    expect(toHundredths('8')).toBe(800)
    expect(toHundredths('0.29')).toBe(29)
    expect(toHundredths('12.3')).toBe(1230)
    expect(formatInches(1900)).toBe('19.00')
    expect(formatInches(1929)).toBe('19.29')
  })
  it('rejects unsupported precision, rounding, unsafe values and nondecimal notation', () => {
    for (const value of [
      '1.234',
      '-1',
      '1e2',
      'NaN',
      ' 8 ',
      '',
      '100.01',
      '9999999999999999999',
    ])
      expect(() => toHundredths(value)).toThrow()
    for (const value of ['1.5', '-1', '101', '', '1e2'])
      expect(() => wholeQuantity(value)).toThrow()
    expect(wholeQuantity('0')).toBe(0)
  })
})
