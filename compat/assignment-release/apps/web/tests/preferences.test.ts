// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { initializePreferences, launchPath, preferencesSaved, rememberSection, setStartup, setTheme, theme } from '../src/app/preferences'

beforeEach(() => { localStorage.clear(); initializePreferences()() })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('application preferences', () => {
  it('persists appearance and launch section without storing private route IDs', () => {
    setTheme('light'); setStartup('last'); rememberSection('/gallery/81fc0686-b3b5-4d98-b59e-09ab1920398b')
    expect(document.documentElement.dataset.theme).toBe('light')
    initializePreferences()()
    expect(theme.value).toBe('light'); expect(launchPath()).toBe('/gallery')
    expect(localStorage.getItem('photobunker.app-preferences.v1')).not.toContain('81fc0686')
  })

  it('rejects invalid saved routes and recovers from damaged preference storage', () => {
    localStorage.setItem('photobunker.app-preferences.v1', JSON.stringify({ startup: 'https://other.example', last: '/gallery/private', theme: 'invalid' }))
    initializePreferences()()
    expect(launchPath()).toBe('/camera'); expect(theme.value).toBe('dark')
    localStorage.setItem('photobunker.app-preferences.v1', '{')
    expect(() => initializePreferences()()).not.toThrow()
    expect(launchPath()).toBe('/camera')
  })

  it('keeps preferences usable and reports denied persistence', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError') })
    setTheme('light'); setStartup('/assignments')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(launchPath()).toBe('/assignments'); expect(preferencesSaved.value).toBe(false)
  })
})
