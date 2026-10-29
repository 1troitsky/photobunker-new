// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
const entries = new Map<string, unknown>()
const pinFixtures = vi.hoisted(() => ({ records: new Map<string, unknown>() }))
vi.mock('../src/crypto/database', () => ({
  get: vi.fn(async (key: string) => entries.get(key)),
  put: vi.fn(async (key: string, value: unknown) => {
    entries.set(key, value)
  }),
  remove: vi.fn(async (key: string) => {
    entries.delete(key)
  }),
}))
vi.mock('../src/identity/store', async () => {
  const { ref } = await import('vue')
  return {
    account: ref({ id: 'synthetic-account' }),
    deviceId: ref('synthetic-device'),
  }
})
vi.mock('../src/app/pin-store', () => ({
  readPin: vi.fn(async (key: string) => pinFixtures.records.get(key)),
  writePin: vi.fn(async (key: string, mutate: (value: unknown) => unknown) => {
    const next = mutate(pinFixtures.records.get(key))
    if (next === undefined) pinFixtures.records.delete(key)
    else pinFixtures.records.set(key, next)
    return next
  }),
  readLegacyPin: vi.fn(async () => undefined),
  clearLegacyPin: vi.fn(async () => undefined),
}))
import { account, deviceId } from '../src/identity/store'
import { rememberKit, rememberedKit } from '../src/crypto/trusted'
import {
  loadAppLock,
  setAppPin,
  unlockApp,
  lockApp,
  removeAppPin,
  appLocked,
  appPinEnabled,
} from '../src/app/lock'
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  localStorage.clear()
  entries.clear()
  pinFixtures.records.clear()
  account.value = { id: 'synthetic-account' } as never
  deviceId.value = 'synthetic-device'
})
it('wraps photo recovery material with a nonextractable device key and binds its account/device context', async () => {
  await rememberKit('PB4.synthetic-public-test-only')
  const row = entries.values().next().value as {
    key: CryptoKey
    ciphertext: ArrayBuffer
  }
  expect(row.key.extractable).toBe(false)
  expect(new TextDecoder().decode(row.ciphertext)).not.toContain(
    'PB4.synthetic-public-test-only',
  )
  expect(await rememberedKit()).toBe('PB4.synthetic-public-test-only')
  deviceId.value = 'another-device'
  expect(await rememberedKit()).toBeUndefined()
})
it('rejects modified trusted-device ciphertext', async () => {
  await rememberKit('PB4.synthetic-public-test-only')
  const row = entries.values().next().value as { ciphertext: ArrayBuffer }
  new Uint8Array(row.ciphertext)[0] ^= 1
  await expect(rememberedKit()).rejects.toThrow()
})
it('keeps the optional PIN on the whole application across reload and locks again on background', async () => {
  await loadAppLock()
  await setAppPin('624817')
  await loadAppLock()
  expect(appLocked.value).toBe(true)
  await expect(unlockApp('000000')).rejects.toThrow('pin.wrong')
  expect(appLocked.value).toBe(true)
  await unlockApp('624817')
  expect(appLocked.value).toBe(false)
  lockApp()
  expect(appLocked.value).toBe(true)
  await unlockApp('624817')
  await removeAppPin('624817')
  await loadAppLock()
  expect(appPinEnabled.value).toBe(false)
  expect(appLocked.value).toBe(false)
})
it('persists a cooldown after repeated invalid PIN attempts', async () => {
  await loadAppLock()
  await setAppPin('624817')
  await loadAppLock()
  for (let i = 0; i < 3; i++)
    await expect(unlockApp('000000')).rejects.toThrow()
  await loadAppLock()
  await expect(unlockApp('624817')).rejects.toThrow('pin.cooldown')
  expect(appLocked.value).toBe(true)
})
