// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { readPhoto, readThumbnail, saveOnServer, syncMetadata, updatePhoto } from '../src/server/photos'
import * as local from '../src/local/photos'
import { accessCode, accessLibraryId, serverPhoto, serverContent, updateServerPhoto, ServerError } from '../src/server/api'
import type { Photo } from '../src/local/photos'
vi.mock('../src/local/photos', () => ({ localPrototype: true, readMetadata: vi.fn(), readPhoto: vi.fn(), readThumbnail: vi.fn(), patchPhoto: vi.fn(), updatePhoto: vi.fn(), acceptServerMetadata: vi.fn(async () => {}) }))
vi.mock('../src/server/api', async importOriginal => ({ ...await importOriginal<typeof import('../src/server/api')>(), serverPhoto: vi.fn(), serverContent: vi.fn(), updateServerPhoto: vi.fn() }))
beforeEach(() => { vi.resetAllMocks(); accessCode.value = 'synthetic'; accessLibraryId.value = 'library' })
it.each([{ deleteRequested: true }, { expiresAt: Date.now() - 1000 }, { uploadOnly: true }, { deliveryOnly: true }])('denies local originals and thumbnails without falling back to a server replica: %j', async policy => {
  vi.mocked(local.readMetadata).mockResolvedValue({ id: 'photo', remoteLibraryId: 'library', ...policy } as Photo)
  await expect(readPhoto('photo')).rejects.toMatchObject({ status: 410 })
  await expect(readThumbnail('photo')).rejects.toMatchObject({ status: 410 })
  expect(serverPhoto).not.toHaveBeenCalled(); expect(serverContent).not.toHaveBeenCalled()
})
function saved() {
  const photo = { id: 'photo', remoteLibraryId: 'library', remoteRevision: 1, title: '', note: 'Saved note', favorite: false, metadata: { capturedAt: 1, resolutionLimited: false }, metadataDirty: true } as Photo
  vi.mocked(local.readPhoto).mockImplementation(async () => ({ photo, blob: new Blob() }))
  vi.mocked(local.readMetadata).mockImplementation(async () => photo)
  vi.mocked(local.patchPhoto).mockImplementation(async (_, changes) => Object.assign(photo, changes))
  return photo
}
it('recognizes a committed metadata update after its response is lost', async () => {
  const photo = saved()
  vi.mocked(updateServerPhoto).mockRejectedValue(new ServerError(409))
  vi.mocked(serverPhoto).mockResolvedValue({ ...photo, tags: [], category: '', remoteRevision: 2, metadata: { resolutionLimited: false, capturedAt: 1 } })
  await syncMetadata(photo.id)
  expect(photo.remoteRevision).toBe(2); expect(photo.metadataDirty).toBe(false)
  expect(updateServerPhoto).toHaveBeenCalledOnce()
})
it('keeps genuine remote metadata conflicts unresolved and preserves local edits', async () => {
  const photo = saved()
  vi.mocked(updateServerPhoto).mockRejectedValue(new ServerError(409))
  vi.mocked(serverPhoto).mockResolvedValue({ ...photo, note: 'Different remote edit', remoteRevision: 2 })
  await expect(syncMetadata(photo.id)).rejects.toMatchObject({ status: 409 })
  expect(local.patchPhoto).not.toHaveBeenCalled(); expect(photo.note).toBe('Saved note')
})
it('allows a local action when only its own delivery acknowledgement advanced the revision', async () => {
  const photo = saved(); const expected = { ...photo }
  photo.remoteRevision = 2; photo.metadataDirty = false
  vi.mocked(local.updatePhoto).mockImplementation(async (_, changes) => Object.assign(photo, changes))
  await updatePhoto(photo.id, { title: photo.title, note: photo.note, favorite: true }, 1, expected)
  expect(local.updatePhoto).toHaveBeenCalledWith(photo.id, expect.objectContaining({ favorite: true }))
})

it('reads and edits UI photos locally and rejects upload or sync through legacy adapters', async () => {
  const photo = saved(); photo.uiOnly = true
  vi.mocked(local.updatePhoto).mockImplementation(async (_, changes) => Object.assign(photo, changes))
  await readPhoto(photo.id); await readThumbnail(photo.id)
  await updatePhoto(photo.id, { title: '', note: 'Local edit', favorite: false })
  expect(photo.metadataDirty).toBe(false)
  await expect(saveOnServer(photo.id)).rejects.toMatchObject({ status: 409 })
  await expect(syncMetadata(photo.id)).rejects.toMatchObject({ status: 409 })
  expect(serverPhoto).not.toHaveBeenCalled(); expect(serverContent).not.toHaveBeenCalled(); expect(updateServerPhoto).not.toHaveBeenCalled()
})

it('denies UI photos belonging to a different workspace scope', async () => {
  const photo = saved(); photo.uiOnly = true; photo.remoteLibraryId = 'another-library'
  await expect(readPhoto(photo.id)).rejects.toMatchObject({ status: 403 })
  await expect(readThumbnail(photo.id)).rejects.toMatchObject({ status: 403 })
  await expect(updatePhoto(photo.id, { title: '', note: '', favorite: false })).rejects.toMatchObject({ status: 403 })
  expect(local.updatePhoto).not.toHaveBeenCalled(); expect(serverPhoto).not.toHaveBeenCalled()
})
