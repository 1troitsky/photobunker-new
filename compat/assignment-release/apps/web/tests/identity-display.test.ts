import { describe, expect, it } from 'vitest'
import { inAppId, personLabel, publicIdInput } from '../src/identity/display'

describe('human-facing account identifiers', () => {
  it('shows only the sequential eight-digit user number', () => {
    expect(inAppId('pb_internal', '10000042')).toBe('10000042')
    expect(inAppId('pb_internal')).toBe('—')
    expect(inAppId('1234567')).toBe('—')
  })

  it('keeps canonical IDs internal and accepts an eight-digit search value', () => {
    expect(publicIdInput(' 10000042 ')).toBe('10000042')
    expect(personLabel({ publicId: 'pb_internal', userId: '10000042' })).toBe('10000042')
  })
})
