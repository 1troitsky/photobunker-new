import { describe, expect, it } from 'vitest'
import { isNewRelease } from '../src/app/pwa-update'

describe('PWA release marker', () => {
  it('does not reload without a valid release or for the current build', () => {
    expect(isNewRelease(undefined, 'current-release')).toBe(false)
    expect(isNewRelease({ buildId: 'current-release' }, 'current-release')).toBe(false)
  })

  it('detects a different build marker', () => {
    expect(isNewRelease({ buildId: 'q1-dock-20261106-1' }, 'previous-release')).toBe(true)
  })
})
