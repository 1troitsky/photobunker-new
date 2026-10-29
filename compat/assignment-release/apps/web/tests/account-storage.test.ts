// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { account, logout } from '../src/identity/store'
import { identityRequest } from '../src/identity/api'
import * as encrypted from '../src/crypto/database'
import { clearScope } from '../src/studio/repository'
import { listPhotos, deletePhoto } from '../src/local/photos'
import { eraseDurableOutbox } from '../src/messages/durable-outbox'
import { eraseTeamCache } from '../src/workspace/team-local'
import { eraseBrowsersForAccount } from '../src/photo-browser/cache'
import { purgeAccountPins } from '../src/app/pin-store'
import { purgeNames } from '../src/local/photo-names'
import { purgeCardShareIntents } from '../src/crypto/card-share-outbox'
import { erasePresencePreferences } from '../src/profiles/presence'
import { deleteAccountData, purgeAccountFromDevice, pendingDeviceCleanup } from '../src/identity/storage'
vi.mock('../src/identity/store', async () => ({ account: (await import('vue')).ref({ id: 'owner' }), logout: vi.fn() }))
vi.mock('../src/identity/api', () => ({ identityRequest: vi.fn() }))
vi.mock('../src/crypto/database', () => ({ entries: vi.fn(), remove: vi.fn() }))
vi.mock('../src/studio/repository', () => ({ clearScope: vi.fn() }))
vi.mock('../src/local/photos', () => ({ listPhotos: vi.fn(), deletePhoto: vi.fn() }))
vi.mock('../src/local/library', () => ({ libraryChanged: vi.fn() }))
vi.mock('../src/messages/durable-outbox', () => ({ eraseDurableOutbox: vi.fn() }))
vi.mock('../src/workspace/team-local', () => ({ eraseTeamCache: vi.fn() }))
vi.mock('../src/photo-browser/cache', () => ({ eraseBrowsersForAccount: vi.fn() }))
vi.mock('../src/app/pin-store', () => ({ purgeAccountPins: vi.fn() }))
vi.mock('../src/local/photo-names', () => ({ purgeNames: vi.fn() }))
vi.mock('../src/crypto/card-share-outbox', () => ({ purgeCardShareIntents: vi.fn() }))
vi.mock('../src/profiles/presence', () => ({ erasePresencePreferences: vi.fn() }))
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); pendingDeviceCleanup.value = null
  account.value = { id: 'owner' } as never
  vi.mocked(logout).mockResolvedValue(undefined)
  vi.mocked(encrypted.entries).mockResolvedValue([{ key: 'job:owner:one', value: {} }, { key: 'context:other:personal', value: {} }, { key: 'job:owner-extra:two', value: {} }])
  vi.mocked(listPhotos).mockResolvedValue([{ id: 'one', accountId: 'owner' }, { id: 'two', accountId: 'other' }] as never)
  vi.stubGlobal('indexedDB', {})
})
afterEach(() => vi.unstubAllGlobals())
it('clears only the deleted account scope and removes the completed retry indicator', async () => {
  localStorage.setItem('pb-deleted-account-cleanup', 'owner'); pendingDeviceCleanup.value = 'owner'
  await purgeAccountFromDevice('owner')
  expect(eraseDurableOutbox).toHaveBeenCalledExactlyOnceWith('owner')
  expect(eraseTeamCache).toHaveBeenCalledExactlyOnceWith('owner')
  expect(eraseBrowsersForAccount).toHaveBeenCalledExactlyOnceWith('owner')
  expect(purgeAccountPins).toHaveBeenCalledExactlyOnceWith('owner')
  expect(purgeNames).toHaveBeenCalledExactlyOnceWith('owner')
  expect(purgeCardShareIntents).toHaveBeenCalledExactlyOnceWith('owner')
  expect(erasePresencePreferences).toHaveBeenCalledExactlyOnceWith('owner')
  expect(encrypted.remove).toHaveBeenCalledExactlyOnceWith('job:owner:one')
  expect(clearScope).toHaveBeenCalledExactlyOnceWith('account:owner')
  expect(deletePhoto).toHaveBeenCalledExactlyOnceWith('one')
  expect(pendingDeviceCleanup.value).toBeNull()
  expect(localStorage.getItem('pb-deleted-account-cleanup')).toBeNull()
})
it('leaves the account and local data untouched when the server rejects deletion', async () => {
  vi.mocked(identityRequest).mockRejectedValue(new Error('network'))
  await expect(deleteAccountData()).rejects.toThrow('network')
  expect(logout).not.toHaveBeenCalled(); expect(encrypted.remove).not.toHaveBeenCalled()
  expect(localStorage.getItem('pb-deleted-account-cleanup')).toBeNull()
})
it('keeps the device cleanup retry marker after a local deletion failure', async () => {
  vi.mocked(clearScope).mockRejectedValue(new Error('storage'))
  await expect(deleteAccountData()).rejects.toThrow('storage')
  expect(identityRequest).toHaveBeenCalledWith('/account', 'DELETE', { accountId: 'owner', confirmation: 'DELETE' })
  expect(logout).toHaveBeenCalledOnce()
  expect(pendingDeviceCleanup.value).toBe('owner')
  expect(localStorage.getItem('pb-deleted-account-cleanup')).toBe('owner')
})
