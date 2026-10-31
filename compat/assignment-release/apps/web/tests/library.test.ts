// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { Photo } from '../src/local/photos'
vi.mock('../src/identity/store', () => ({ account: ref<{id: string} | undefined>({id: 'synthetic-account'}) }))
vi.mock('../src/crypto/store', () => ({ protectionEnabled: ref(false), protectionReady: ref(true), photoReadAllowed: () => true }))
vi.mock('../src/workspace/api', () => ({ photoIndex: vi.fn() }))
vi.mock('../src/crypto/photos', () => ({ index: vi.fn() }))
vi.mock('../src/local/photos', () => ({ localPrototype: true, listPhotos: vi.fn(), deletePhoto: vi.fn(async () => {}), patchPhoto: vi.fn(async () => ({})) }))
import { account } from '../src/identity/store'
import { photoIndex } from '../src/workspace/api'
import { listPhotos, patchPhoto } from '../src/local/photos'
import { photos, refreshLibrary, serverError } from '../src/local/library'
const photo = { id: 'synthetic', createdAt: 1, accountId: 'synthetic-account' } as Photo
beforeEach(() => { vi.clearAllMocks(); account.value = { id: 'synthetic-account' } as never; vi.mocked(photoIndex).mockResolvedValue({photos: [], deleted: [], receipts: []}); vi.mocked(listPhotos).mockResolvedValue([]) })
it('shows account server photos when browser storage is denied', async () => {
  vi.mocked(listPhotos).mockRejectedValue(new DOMException('Denied', 'SecurityError'))
  vi.mocked(photoIndex).mockResolvedValue({photos: [photo], deleted: [], receipts: []})
  await refreshLibrary(); expect(photos.value).toEqual([photo])
})
it('keeps own pending photos and reports an unavailable account server', async () => {
  vi.mocked(listPhotos).mockResolvedValue([{...photo, uploadRequested: true}])
  vi.mocked(photoIndex).mockRejectedValue(new TypeError('Offline'))
  await refreshLibrary(); expect(photos.value).toHaveLength(1); expect(serverError.value).toBe(true)
})
it('hides photos and never loads legacy guest data after logout', async () => {
  account.value = undefined; photos.value = [photo]
  await refreshLibrary(); expect(photos.value).toEqual([])
  expect(listPhotos).not.toHaveBeenCalled(); expect(photoIndex).not.toHaveBeenCalled()
})
it('does not expose another account’s pending photos', async () => {
  vi.mocked(listPhotos).mockResolvedValue([{...photo, accountId: 'different-account', uploadRequested: true}])
  await refreshLibrary(); expect(photos.value).toEqual([])
})
it('retains pending description changes while applying the shorter server deadline', async () => {
  const local = {...photo, title: 'Offline edit', uploadRequested: true, metadataDirty: true, expiresAt: Date.now() + 100000}
  const remote = {...photo, title: 'Server title', expiresAt: Date.now() + 50000}
  vi.mocked(listPhotos).mockResolvedValue([local]); vi.mocked(photoIndex).mockResolvedValue({photos: [remote], deleted: [], receipts: []})
  await refreshLibrary(); expect(photos.value[0]).toMatchObject({title: 'Offline edit', expiresAt: remote.expiresAt})
  expect(patchPhoto).toHaveBeenCalledWith(photo.id, {expiresAt: remote.expiresAt})
})
