// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '../src/router'
import { profileReturnTo } from '../src/identity/person'
import { photoCardPath, privatePhotoCard } from '../src/studio/private-photo-card'
import type { Photo } from '../src/local/photos'

function photo(overrides: Partial<Photo> = {}): Photo {
  return {
    id: '57f50fa9-0638-40b9-92e3-a7e6b990b7cd',
    accountId: 'account-a',
    createdAt: Date.now() - 5000,
    width: 1200, height: 900, bytes: 400000, mime: 'image/jpeg',
    method: 'image-capture', title: 'Edited title',
    shortId: 'ABCD0001', note: 'Public-facing description',
    favorite: false, expiresAt: Date.now() + 120000,
    metadata: {
      capturedAt: Date.now() - 5000,
      date: '2026-10-26', camera: 'Device camera',
      location: { latitude: 41.7151, longitude: 44.8271, source: 'gps',
        accuracy: 10, measuredAt: Date.now() - 5000 },
    },
    creatorId: 'pb_author',
    captureContext: { standard: true, presetName: 'Camera',
      author: { kind: 'account', publicId: 'pb_author' } },
    remoteRevision: 1,
    workspaceAccess: { role: 'owner', read: true, thumbnail: true,
      edit: true, delete: true, share: true, shareExternal: true },
    ...overrides,
  }
}
describe('R1-03A / private Photo Card', () => {
  it('has a stable private route by UUID, separate from gallery photo and editor', () => {
    const id = photo().id
    const router = createAppRouter(createMemoryHistory())
    expect(router.resolve(photoCardPath(id)).name).toBe('photo-card')
    expect(router.resolve('/gallery/' + id).name).toBe('photo')
    expect(router.resolve('/gallery/' + id + '/edit').name).toBe('photo-editor')
    expect(profileReturnTo(photoCardPath(id))).toBe(photoCardPath(id))
    expect(profileReturnTo('/gallery/../../people/other/card')).toBe('/profile')
    expect(profileReturnTo('//example.test/gallery/' + id + '/card')).toBe('/profile')
  })
  it('uses only approved full-read fields and never projects private Notes', () => {
    const input = { ...photo(), privateNotes: 'SENSITIVE PERSONAL NOTE' } as Photo & {
      privateNotes: string
    }
    const card = privatePhotoCard(input)
    expect(card.title).toBe('Edited title')
    expect(card.nameId).toBe('ABCD0001')
    expect(card.description).toBe('Public-facing description')
    expect(card.location).toEqual({ latitude: 41.7151, longitude: 44.8271 })
    expect(card.author).toEqual({ publicId: 'pb_author' })
    expect(card.capturedAt).toBeDefined()
    expect(JSON.stringify(card)).not.toContain('SENSITIVE PERSONAL NOTE')
    expect(card).not.toHaveProperty('note')
    expect(card).not.toHaveProperty('workspaceAccess')
  })
  it('hides GPS, author, description, capture time and technical metadata without read grant', () => {
    const input = photo({
      thumbnailOnly: true,
      workspaceAccess: { role: 'viewer', thumbnail: true, read: false,
        edit: false, delete: false, share: false, shareExternal: false },
    })
    const card = privatePhotoCard(input)
    expect(card.nameId).toBe('ABCD0001')
    expect(card.description).toBeUndefined()
    expect(card.location).toBeUndefined()
    expect(card.author).toBeUndefined()
    expect(card.capturedAt).toBeUndefined()
    expect(card.metadata).toBeUndefined()
  })
  it('does not synthesize a permanent code while waiting for offline assignment', () => {
    const card = privatePhotoCard(photo({ shortId: undefined, title: '', needsName: true }))
    expect(card.nameId).toBeUndefined()
    expect(card.namePending).toBe(true)
    expect(card.title).toBe('')
  })
  it('uses NAME-ID as the title fallback without replacing a user title', () => {
    expect(privatePhotoCard(photo({ title: '' })).title).toBe('ABCD0001')
    expect(privatePhotoCard(photo({ title: 'Facade' })).title).toBe('Facade')
  })
  it('rejects invalid GPS even with full read, and never reveals invalid authors', () => {
    const card = privatePhotoCard(photo({
      captureContext: { standard: true, presetName: 'Camera',
        author: { kind: 'account', publicId: 'unknown/url?token=abc' } },
      creatorId: undefined, remoteRevision: undefined,
      metadata: { location: { source: 'manual', latitude: 200, longitude: 44.8 } },
    }))
    expect(card.location).toBeUndefined()
    expect(card.author).toBeUndefined()
  })
  it('rejects expired, deleted, and denied photos before disclosure', () => {
    expect(() => privatePhotoCard(photo({ expiresAt: Date.now() - 10 }))).toThrow()
    expect(() => privatePhotoCard(photo({ deleteRequested: true }))).toThrow()
    expect(() => privatePhotoCard(photo({ workspaceAccess: {
      role: 'viewer', thumbnail: false, read: false,
      edit: false, delete: false, share: false, shareExternal: false,
    } }))).toThrow()
  })
})
