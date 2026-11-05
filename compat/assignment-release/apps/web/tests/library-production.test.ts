// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { Photo } from '../src/local/photos'

vi.mock('../src/identity/store', () => ({
  account: ref<{ id: string } | undefined>({ id: 'production-account' }),
}))
vi.mock('../src/app/lock', () => ({
  appLockReady: ref(true),
  appLocked: ref(false),
}))
vi.mock('../src/crypto/store', () => ({
  protectionEnabled: ref(true),
  protectionReady: ref(true),
  strongUnlocked: ref(true),
  warmLocked: ref(false),
  photoReadAllowed: () => true,
}))
vi.mock('../src/crypto/photos', () => ({ index: vi.fn() }))
vi.mock('../src/workspace/api', () => ({ photoIndex: vi.fn() }))
vi.mock('../src/local/photos', () => ({
  localPrototype: false,
  listPhotos: vi.fn(),
  deletePhoto: vi.fn(async () => {}),
  patchPhoto: vi.fn(async () => ({})),
}))

import { index as secureIndex } from '../src/crypto/photos'
import { listPhotos } from '../src/local/photos'
import { photos, refreshLibrary } from '../src/local/library'

const photo = {
  id: 'encrypted-capture',
  accountId: 'production-account',
  encrypted: true,
  createdAt: 1,
} as Photo

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(secureIndex).mockResolvedValue({
    photos: [photo],
    deleted: [],
    receipts: [],
  })
})

it('loads the encrypted gallery when the plaintext prototype is disabled', async () => {
  await refreshLibrary()

  expect(secureIndex).toHaveBeenCalledOnce()
  expect(listPhotos).not.toHaveBeenCalled()
  expect(photos.value).toEqual([photo])
})

it('shares one in-flight encrypted library refresh between callers', async () => {
  let finishFirst!: (value: { photos: Photo[]; deleted: string[]; receipts: [] }) => void
  vi.mocked(secureIndex)
    .mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve }))

  const first = refreshLibrary()
  const second = refreshLibrary()
  expect(second).toBe(first)
  finishFirst({ photos: [photo], deleted: [], receipts: [] })
  await Promise.all([first, second])

  expect(secureIndex).toHaveBeenCalledOnce()
  expect(photos.value).toEqual([photo])
})
