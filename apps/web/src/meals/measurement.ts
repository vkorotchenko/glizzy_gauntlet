export function toHundredths(value: string) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value))
    throw new Error(
      'Use inches with at most two decimal places, not rounding or scientific notation.',
    )
  const [whole, fraction = ''] = value.split('.')
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(result) || result > 10000)
    throw new Error('Enter a length no greater than 100 inches.')
  return result
}

export function formatInches(hundredths: number) {
  return `${Math.trunc(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`
}

export function wholeQuantity(value: string) {
  if (!/^(?:0|[1-9]\d*)$/.test(value) || Number(value) > 100)
    throw new Error('Use a whole quantity from 0 to 100 for each item.')
  return Number(value)
}
