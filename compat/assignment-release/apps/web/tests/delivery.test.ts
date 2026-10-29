// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Photo } from '../src/local/photos'
import * as local from '../src/local/photos'
import { accessCode, accessLibraryId, deleteServerPhoto, fetchClock, ServerError } from '../src/server/api'
import { saveOnServer, syncMetadata } from '../src/server/photos'
import { flushDelivery, retryDelivery } from '../src/delivery/queue'
import { captureRetention, clockTime, rememberAnchor } from '../src/delivery/clock'
import { removePhotoVersions } from '../src/studio/versions'

vi.mock('../src/studio/versions', () => ({ removePhotoVersions: vi.fn(async () => {}) }))

vi.mock('../src/local/photos', () => ({ localPrototype: true, listPhotos: vi.fn(), readMetadata: vi.fn(), patchPhoto: vi.fn(), revokePhoto: vi.fn(), deletePhoto: vi.fn() }))
vi.mock('../src/server/api', async () => {
  const { ref } = await import('vue')
  const accessCode = ref(''); const accessLibraryId = ref('')
  return { accessCode, accessLibraryId, belongsToServer: (photo: Photo) => !!accessCode.value && photo.remoteLibraryId === accessLibraryId.value,
    ensureAccess: vi.fn(async () => { if (!accessCode.value) { accessCode.value = 'synthetic'; accessLibraryId.value = crypto.randomUUID() } }), fetchClock: vi.fn(), deleteServerPhoto: vi.fn(), ServerError: class extends Error { constructor(public status: number) { super('test') } } }
})
vi.mock('../src/server/photos', () => ({ saveOnServer: vi.fn(), syncMetadata: vi.fn() }))
let rows: Photo[]
let online: boolean
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(1_800_000_000_000)
  online = true
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
  accessCode.value = 'synthetic'; accessLibraryId.value = crypto.randomUUID()
  rows = []
  vi.mocked(local.listPhotos).mockImplementation(async () => [...rows])
  vi.mocked(local.readMetadata).mockImplementation(async id => rows.find(photo => photo.id === id))
  vi.mocked(local.patchPhoto).mockImplementation(async (id, changes) => {
    const photo = rows.find(photo => photo.id === id)!
    Object.assign(photo, changes); return photo
  })
  vi.mocked(local.revokePhoto).mockImplementation(async id => { const photo = rows.find(item => item.id === id)!; photo.deleteRequested = true; photo.uploadRequested = false })
  vi.mocked(local.deletePhoto).mockImplementation(async id => { rows = rows.filter(photo => photo.id !== id) })
  vi.mocked(fetchClock).mockImplementation(async () => ({ id: crypto.randomUUID(), issuedAt: Date.now() }))
  vi.mocked(saveOnServer).mockImplementation(async id => { const photo = rows.find(photo => photo.id === id)!; photo.uploadRequested = false; return photo })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
function capture(extra: Partial<Photo> = {}) {
  const photo = { id: crypto.randomUUID(), remoteLibraryId: accessLibraryId.value, createdAt: Date.now(), uploadRequested: true, ...extra } as Photo
  rows.push(photo); return photo
}
it('keeps failed uploads durable and retries the same IDs after reconnection', async () => {
  const a = capture(); const b = capture()
  vi.mocked(saveOnServer).mockRejectedValueOnce(new ServerError(503))
  await flushDelivery()
  expect(a).toMatchObject({ uploadRequested: true, uploadError: 'network', uploadAttempts: 1 })
  expect(b.uploadRequested).toBe(false)
  online = false; await flushDelivery()
  expect(saveOnServer).toHaveBeenCalledTimes(2)
  online = true; await retryDelivery()
  expect(saveOnServer).toHaveBeenLastCalledWith(a.id)
  expect(a.uploadRequested).toBe(false)
})
it('removes expired captures offline and never sends them when the network returns', async () => {
  const photo = capture({ expiresAt: Date.now() - 1 })
  online = false; await flushDelivery()
  expect(local.revokePhoto).toHaveBeenCalledWith(photo.id)
  expect(saveOnServer).not.toHaveBeenCalled()
  online = true; vi.mocked(deleteServerPhoto).mockResolvedValue(true)
  await flushDelivery()
  expect(saveOnServer).not.toHaveBeenCalled()
  expect(local.deletePhoto).toHaveBeenCalledWith(photo.id)
})
it('retains deletion intent until server cleanup is verified', async () => {
  const photo = capture({ deleteRequested: true, uploadRequested: false })
  vi.mocked(deleteServerPhoto).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  await flushDelivery()
  expect(rows).toHaveLength(1); expect(local.deletePhoto).not.toHaveBeenCalled()
  vi.setSystemTime(Date.now() + 31_000); await flushDelivery()
  expect(rows).toHaveLength(0); expect(local.deletePhoto).toHaveBeenCalledWith(photo.id)
})
it('pauses quota failures until an explicit retry and keeps other libraries isolated', async () => {
  const photo = capture(); capture({ remoteLibraryId: 'another-library' })
  vi.mocked(saveOnServer).mockRejectedValueOnce(new ServerError(413))
  await flushDelivery(); vi.setSystemTime(Date.now() + 61_000); await flushDelivery()
  expect(saveOnServer).toHaveBeenCalledTimes(1); expect(photo.uploadError).toBe('quota')
  await retryDelivery(); expect(saveOnServer).toHaveBeenCalledTimes(2)
  expect(syncMetadata).not.toHaveBeenCalled()
})
it('does not substitute a new time anchor for a capture lacking its original one', async () => {
  const photo = capture({ expiresAt: Date.now() + 3600_000 })
  await flushDelivery(); await retryDelivery()
  expect(photo.uploadError).toBe('clock'); expect(saveOnServer).not.toHaveBeenCalled()
})
it('binds a first-ever private capture once without extending its offline deadline', async () => {
  accessCode.value = ''; accessLibraryId.value = ''
  const photo = capture({ initialCapture: true, remoteLibraryId: undefined, retentionSeconds: 1209600, expiresAt: Date.now() + 1209600_000 })
  const deadline = photo.expiresAt
  online = false; await flushDelivery()
  expect(saveOnServer).not.toHaveBeenCalled()
  vi.setSystemTime(Date.now() + 60_000); online = true; await flushDelivery()
  expect(photo.initialCapture).toBe(false)
  expect(photo.remoteLibraryId).toBe(accessLibraryId.value)
  expect(photo.retentionAnchor).toBeTruthy(); expect(photo.expiresAt).toBe(deadline)
  expect(saveOnServer).toHaveBeenCalledWith(photo.id)
  const anchor = photo.retentionAnchor
  await retryDelivery(); expect(photo.retentionAnchor).toBe(anchor)
})
it('expires an upload-only delivery receipt without deleting the curator archive', async () => {
  const photo = capture({ expiresAt: Date.now() - 1, deliveryOnly: true, uploadRequested: false })
  await flushDelivery()
  expect(local.deletePhoto).toHaveBeenCalledWith(photo.id)
  expect(local.revokePhoto).not.toHaveBeenCalled()
  expect(deleteServerPhoto).not.toHaveBeenCalled()
})
it('keeps elapsed time from moving backwards and preserves capture deadlines across time refreshes', () => {
  rememberAnchor(accessLibraryId.value, { id: 'original-anchor', issuedAt: Date.now() })
  const retention = captureRetention(accessLibraryId.value, Date.now(), 3600)
  vi.setSystemTime(Date.now() + 60_000)
  const highWater = clockTime(accessLibraryId.value).now
  vi.setSystemTime(Date.now() - 30_000)
  const rolledBack = clockTime(accessLibraryId.value)
  expect(rolledBack.certain).toBe(false); expect(rolledBack.now).toBeGreaterThanOrEqual(highWater)
  rememberAnchor(accessLibraryId.value, { id: 'fresh-anchor', issuedAt: Date.now() })
  expect(retention.retentionAnchor).toBe('original-anchor')
  expect(retention.expiresAt).toBe(1_800_003_600_000)
})

it('never uploads UI photos even if legacy delivery flags are present', async () => {
  capture({ uiOnly: true, initialCapture: true, metadataDirty: true })
  await flushDelivery(); await retryDelivery()
  expect(saveOnServer).not.toHaveBeenCalled(); expect(syncMetadata).not.toHaveBeenCalled()
})

it('expires UI originals and versions locally while offline', async () => {
  const photo = capture({ uiOnly: true, expiresAt: Date.now() - 1 })
  online = false; await flushDelivery()
  expect(removePhotoVersions).toHaveBeenCalledWith(photo)
  expect(local.deletePhoto).toHaveBeenCalledWith(photo.id)
  expect(local.revokePhoto).not.toHaveBeenCalled(); expect(deleteServerPhoto).not.toHaveBeenCalled(); expect(saveOnServer).not.toHaveBeenCalled()
})
