// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { formatNameId, isNameId } from '../src/local/photo-names'

describe('R1-02 / immutable readable photo codes', () => {
  it('formats an allocated four-letter prefix and fixed-width sequence', () => {
    expect(formatNameId('ABCD', 1)).toBe('ABCD0001')
    expect(formatNameId('ABCD', 9999)).toBe('ABCD9999')
    expect(formatNameId('AAAA', 14)).toBe('AAAA0014')
  })
  it('never emits an out-of-range, random or temporary ID as a permanent one', () => {
    for (const number of [0, -1, 10000, NaN, Infinity, 0.25]) {
      expect(() => formatNameId('ABCD', number)).toThrow()
    }
    for (const prefix of ['abcD', 'ABC', 'ABCDE', '1BCD', 'AB-D']) {
      expect(() => formatNameId(prefix, 1)).toThrow()
    }
    expect(isNameId('ABCD0001')).toBe(true)
    expect(isNameId('ABCD9999')).toBe(true)
    expect(isNameId('ABCD-X7K9P2M5QR')).toBe(false)
    expect(isNameId('12345678-1234-4234-a234-123456789abc')).toBe(false)
    expect(isNameId('ABCD10000')).toBe(false)
    expect(isNameId('')).toBe(false)
  })
})
