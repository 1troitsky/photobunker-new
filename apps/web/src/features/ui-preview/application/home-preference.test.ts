import { afterEach, describe, expect, it, vi } from 'vitest'
import { homeSection, setHomeSection } from './home-preference'

afterEach(() => vi.unstubAllGlobals())

describe('startup section preference', () => {
  it('defaults to camera without localStorage access', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') } })
    expect(homeSection()).toBe('/camera')
  })

  it('ignores invalid or malformed stored paths', () => {
    vi.stubGlobal('localStorage', { getItem: () => '/photos/secret-photo-id' })
    expect(homeSection()).toBe('/camera')
  })

  it('persists only allowlisted section paths', () => {
    const entries = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { entries.set(key, value) },
    })
    expect(setHomeSection('/assignments')).toBe(true)
    expect(homeSection()).toBe('/assignments')
    expect(setHomeSection('/photos/private-id' as '/photos')).toBe(false)
    expect(homeSection()).toBe('/assignments')
  })

  it('reports blocked writes without interrupting launch', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('blocked') } })
    expect(setHomeSection('/browser')).toBe(false)
    expect(homeSection()).toBe('/camera')
  })
})
