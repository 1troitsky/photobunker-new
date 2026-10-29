// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'

const fixtures = vi.hoisted(() => ({
  data: new Map<string, unknown>(),
  legacy: new Map<string, unknown>(),
  fails: false,
  owner: { value: { id: 'alice' } as { id: string } | undefined },
  device: { value: 'device-1' },
}))
vi.mock('../src/identity/store', () => ({
  account: fixtures.owner, deviceId: fixtures.device,
}))
vi.mock('../src/app/pin-store', () => ({
  readPin: vi.fn(async (id: string) => {
    if (fixtures.fails) throw new Error('pin.storage_failed')
    return fixtures.data.get(id)
  }),
  writePin: vi.fn(async (id: string, mutate: (value: unknown) => unknown) => {
    if (fixtures.fails) throw new Error('pin.storage_failed')
    const next = mutate(fixtures.data.get(id))
    if (next === undefined) fixtures.data.delete(id)
    else fixtures.data.set(id, next)
    return next
  }),
  readLegacyPin: vi.fn(async (id: string) => fixtures.legacy.get(id)),
  clearLegacyPin: vi.fn(async (id: string) => { fixtures.legacy.delete(id) }),
}))
import {
  appPinEnabled, appPinLegacy, appLocked, appLockFailure, appLockReady,
  loadAppLock, setAppPin, unlockApp, lockApp, removeAppPin,
} from '../src/app/lock'

const pinScope = () => `app-pin:${fixtures.owner.value!.id}:${fixtures.device.value}`
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  fixtures.owner.value = { id: 'alice' }
  fixtures.device.value = 'device-1'
  fixtures.data.clear()
  fixtures.legacy.clear()
  fixtures.fails = false
  vi.restoreAllMocks()
})
describe('R1-06 D3 PIN security boundary', () => {
  it('writes versioned PBKDF2, rejects new 4 digits, requires old PIN for change and disable', async () => {
    await loadAppLock()
    expect(appLockReady.value).toBe(true)
    await expect(setAppPin('1234')).rejects.toThrow('pin.length')
    await setAppPin('123456')
    const value = fixtures.data.get(pinScope()) as { version: number; salt: string; verifier: string; iterations: number }
    expect(value.version).toBe(2)
    expect(value.iterations).toBeGreaterThanOrEqual(100000)
    expect(value.salt).toMatch(/^[a-f0-9]{32}$/)
    expect(value.verifier).toMatch(/^[a-f0-9]{64}$/)
    expect(value).not.toHaveProperty('digest')
    await expect(setAppPin('234567')).rejects.toThrow('pin.confirm_required')
    await expect(removeAppPin('')).rejects.toThrow('pin.confirm_required')
    await expect(removeAppPin('000000')).rejects.toThrow('pin.wrong')
    await setAppPin('234567', '123456')
    expect(appPinEnabled.value).toBe(true)
    lockApp()
    expect(appLocked.value).toBe(true)
    await expect(unlockApp('123456')).rejects.toThrow('pin.wrong')
    await unlockApp('234567')
    expect(appLocked.value).toBe(false)
    await removeAppPin('234567')
    expect(appPinEnabled.value).toBe(false)
    expect(fixtures.data.get(pinScope())).toEqual({ version: 0 })
  })
  it('keeps cooldown after reload, prevents wall-clock rollback and scopes attempts to account/device', async () => {
    const original = Date.now
    let wall = 2_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => wall)
    await loadAppLock()
    await setAppPin('123456')
    lockApp()
    for (let i = 0; i < 3; i++) await expect(unlockApp('999999')).rejects.toThrow('pin.wrong')
    await loadAppLock()
    await expect(unlockApp('123456')).rejects.toThrow('pin.cooldown')
    wall -= 30_000
    await expect(unlockApp('123456')).rejects.toThrow('pin.clock_rollback')
    fixtures.owner.value = { id: 'bob' }
    await loadAppLock()
    expect(appPinEnabled.value).toBe(false)
    expect(appLocked.value).toBe(false)
    fixtures.owner.value = { id: 'alice' }
    fixtures.device.value = 'device-2'
    await loadAppLock()
    expect(appPinEnabled.value).toBe(false)
    fixtures.device.value = 'device-1'
    wall = 2_060_000
    await loadAppLock()
    await unlockApp('123456')
    expect(appLocked.value).toBe(false)
    Date.now = original
  })
  it('migrates a legacy 4-digit verifier only after successful unlock, without changing the code', async () => {
    const salt = 'legacy-uuid'
    const hash = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':1234'))
    const digest = Buffer.from(hash).toString('hex')
    fixtures.legacy.set(pinScope(), { salt, digest, failures: 0, until: 0 })
    await loadAppLock()
    expect(appPinLegacy.value).toBe(true)
    expect(fixtures.data.get(pinScope())).toHaveProperty('digest')
    await expect(unlockApp('0000')).rejects.toThrow('pin.wrong')
    expect(fixtures.data.get(pinScope())).toHaveProperty('digest')
    await unlockApp('1234')
    expect(appPinLegacy.value).toBe(true) // v2 supports old 4-digit value until changed
    expect(fixtures.data.get(pinScope())).toMatchObject({ version: 2, length: 4 })
    lockApp()
    await loadAppLock()
    await unlockApp('1234')
    expect(appLocked.value).toBe(false)
    await setAppPin('987654', '1234')
    expect(appPinLegacy.value).toBe(false)
  })
  it('fails closed without data deletion when PIN storage becomes unavailable', async () => {
    fixtures.data.set(pinScope(), { version: 2, salt: '0'.repeat(32),
      verifier: '0'.repeat(64), iterations: 100000,
      length: 6, failures: 0, until: 0, lastWall: 1 })
    fixtures.fails = true
    await loadAppLock()
    expect(appLockReady.value).toBe(true)
    expect(appLockFailure.value).toBe(true)
    expect(appLocked.value).toBe(true)
    await expect(unlockApp('123456')).rejects.toThrow('pin.storage_failed')
    expect(fixtures.data.size).toBe(1)
  })
})
