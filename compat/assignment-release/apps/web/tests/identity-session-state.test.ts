// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Account } from '../src/identity/store'
import type { DeviceCredential } from '../src/identity/keys'

const fake = vi.hoisted(() => ({
  rows: new Map<string, unknown>(), devices: [] as DeviceCredential[],
  request: vi.fn(), proof: vi.fn(), bind: vi.fn(), reserve: vi.fn(), resetPin: vi.fn(),
}))
vi.mock('../src/identity/api', () => ({
  identityRequest: fake.request, bindIdentity: fake.bind,
  IdentityError: class extends Error { constructor(public status: number) { super('identity.request_failed') } },
}))
vi.mock('../src/identity/keys', () => ({
  credentials: async () => fake.devices,
  forgetCredentials: async () => { fake.devices = [] },
  automaticDeviceName: () => 'QA device', onboardingDevice: fake.reserve,
  completeOnboardingDevice: async () => {}, reconcileOnboardingDevice: async () => {},
  prove: fake.proof, parseKit: async () => ({ publicKey: 'root-b', privateKey: {} }),
}))
vi.mock('../src/crypto/database', () => ({
  get: async (key: string) => fake.rows.get(key),
  put: async (key: string, value: unknown) => { fake.rows.set(key, value) },
  remove: async (key: string) => { fake.rows.delete(key) },
  entries: async () => [],
}))
vi.mock('../src/messages/store', () => ({ stopMessaging: vi.fn() }))
vi.mock('../src/messages/keys', () => ({ forgetMessageStorage: async () => {} }))
vi.mock('../src/messages/durable-outbox', () => ({ eraseDurableOutbox: async () => {} }))
vi.mock('../src/crypto/store', () => ({ hardLock: vi.fn() }))
vi.mock('../src/server/api', () => ({ forgetLegacyLibraryAccess: vi.fn() }))
vi.mock('../src/app/lock', () => ({ resetAppPinAfterRecovery: fake.resetPin }))

type Store = typeof import('../src/identity/store')
let store: Store
let IdentityError: typeof import('../src/identity/api').IdentityError
const session = (id = 'a') => ({
  account: {
    id, publicId: 'pb_' + id, rootKey: 'root-' + id,
    fields: {}, visibility: {}, revision: 1, matrix: { state: 'ready', userId: '@' + id },
  } as Account,
  deviceId: 'device-' + id, expiresAt: null,
})
function device(id = 'a') {
  return { id: 'device-' + id, publicId: 'pb_' + id, name: 'QA device', privateKey: { extractable: false } } as DeviceCredential
}
function held<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.clearAllMocks()
  localStorage.clear()
  fake.rows.clear()
  fake.devices = []
  fake.request.mockReset()
  fake.proof.mockReset()
  fake.reserve.mockReset()
  fake.resetPin.mockReset()
  vi.stubGlobal('BroadcastChannel', class { addEventListener() {} postMessage() {} })
  ;({ IdentityError } = await import('../src/identity/api'))
  store = await import('../src/identity/store')
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('keeps confirmed screens mounted and coalesces concurrent forced refreshes without a replay loop', async () => {
  fake.request.mockResolvedValueOnce(session())
  await store.loadIdentity()
  const response = held<ReturnType<typeof session>>()
  fake.request.mockReturnValue(response.promise)
  const first = store.loadIdentity(true)
  const second = store.loadIdentity(true)
  expect(second).toBe(first)
  expect(store.sessionState.value).toBe('authenticated')
  expect(store.hasConfirmedIdentity()).toBe(true)
  response.resolve(session())
  await first
  await vi.advanceTimersByTimeAsync(0)
  expect(fake.request).toHaveBeenCalledTimes(2)
})

it('warms the scoped local context even when another startup service already began /me', async () => {
  const response = held<ReturnType<typeof session>>()
  fake.request.mockReturnValue(response.promise)
  fake.devices = [device()]
  fake.rows.set('capture-current', { accountId: 'a', publicId: 'pb_a', deviceId: 'device-a' })
  const check = store.loadIdentity()
  store.startIdentityBootstrap()
  await vi.waitFor(() => expect(store.offlineCaptureIdentity.value).toBe(true))
  expect(store.account.value?.id).toBe('a')
  expect(store.hasConfirmedIdentity()).toBe(false)
  expect(fake.bind).toHaveBeenLastCalledWith('a')
  response.resolve(session())
  await check
  expect(store.hasConfirmedIdentity()).toBe(true)
  expect(fake.request).toHaveBeenCalledTimes(1)
})

it('restores a missing cookie with the same registered device proof instead of creating a device', async () => {
  localStorage.setItem('pb-active-device', 'device-a')
  fake.devices = [device()]
  fake.request.mockRejectedValue(new IdentityError(401))
  fake.proof.mockResolvedValue(session())
  await store.loadIdentity()
  expect(store.sessionState.value).toBe('authenticated')
  expect(store.deviceId.value).toBe('device-a')
  expect(fake.proof).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'login', deviceId: 'device-a' }), fake.devices[0]!.privateKey)
  expect(fake.reserve).not.toHaveBeenCalled()
})

it('ignores a delayed /me response after logout', async () => {
  const response = held<ReturnType<typeof session>>()
  fake.request.mockImplementation((path: string) => path === '/me' ? response.promise : Promise.resolve({}))
  const check = store.loadIdentity()
  await store.logout()
  response.resolve(session())
  await check
  expect(store.sessionState.value).toBe('signed-out')
  expect(store.account.value).toBeUndefined()
  expect(fake.bind).not.toHaveBeenCalledWith('a')
})

it('does not replace a newly recovered account with an old pending session response', async () => {
  const response = held<ReturnType<typeof session>>()
  fake.request.mockReturnValue(response.promise)
  fake.reserve.mockResolvedValue(device('b'))
  fake.proof.mockResolvedValue(session('b'))
  const check = store.loadIdentity()
  await store.recover('synthetic-root-b')
  response.resolve(session('a'))
  await check
  expect(store.account.value?.id).toBe('b')
  expect(store.sessionState.value).toBe('authenticated')
})

it('resets only the former device PIN after a fresh PB1 proof creates a new session', async () => {
  fake.request.mockResolvedValueOnce(session('a'))
  await store.loadIdentity()
  const recovered = { ...session('a'), deviceId: 'device-recovered' }
  fake.reserve.mockResolvedValue({ ...device('recovered'), publicId: 'pb_a' })
  fake.proof.mockResolvedValue(recovered)
  await store.recover('synthetic-root-a', undefined, true)
  expect(fake.proof).toHaveBeenCalledWith(
    expect.objectContaining({ purpose: 'recover', rootKey: 'root-b' }),
    expect.anything(),
  )
  expect(fake.resetPin).toHaveBeenCalledExactlyOnceWith('a', 'device-a')
  expect(store.deviceId.value).toBe('device-recovered')
})

it('does not let a late guest 401 cancel a new sign-in whose device proof is pending', async () => {
  const initial = held<ReturnType<typeof session>>()
  const proof = held<ReturnType<typeof session>>()
  fake.request.mockReturnValue(initial.promise)
  fake.reserve.mockResolvedValue(device('b'))
  fake.proof.mockReturnValue(proof.promise)
  const check = store.loadIdentity()
  const recovery = store.recover('synthetic-root-b')
  await vi.waitFor(() => expect(fake.proof).toHaveBeenCalledOnce())
  initial.reject(new IdentityError(401))
  await check
  proof.resolve(session('b'))
  await recovery
  expect(store.account.value?.id).toBe('b')
  expect(store.sessionState.value).toBe('authenticated')
})

it('bounds temporary-failure retries and preserves local data', async () => {
  fake.request.mockRejectedValue(new TypeError('offline'))
  fake.rows.set('private-synthetic-data', 'retained')
  await store.loadIdentity()
  await vi.advanceTimersByTimeAsync(2000)
  await vi.advanceTimersByTimeAsync(4000)
  await vi.advanceTimersByTimeAsync(60000)
  expect(fake.request).toHaveBeenCalledTimes(3)
  expect(store.sessionState.value).toBe('unavailable')
  expect(fake.rows.get('private-synthetic-data')).toBe('retained')
})

it('closes access on a rejected device proof without automatically registering again', async () => {
  fake.devices = [device()]
  localStorage.setItem('pb-active-device', 'device-a')
  fake.request.mockRejectedValue(new IdentityError(401))
  fake.proof.mockRejectedValue(new IdentityError(403))
  await store.loadIdentity()
  expect(store.sessionState.value).toBe('revoked')
  expect(store.account.value).toBeUndefined()
  expect(fake.reserve).not.toHaveBeenCalled()
})
