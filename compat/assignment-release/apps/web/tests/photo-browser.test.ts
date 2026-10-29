// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { Photo } from '../src/local/photos'
import { visibleBrowserPhotos, type BrowserCollection } from '../src/photo-browser/model'
import { createAppRouter } from '../src/router'
import { createMemoryHistory } from 'vue-router'

const collection: BrowserCollection = {
  id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  assignments: [
    { id: 'task-1', name: 'Survey' },
    { id: 'task-2', name: 'Facade' },
  ],
  expiresAt: 2_000_000,
  canRevoke: false,
}
function photo(overrides: Partial<Photo> = {}): Photo {
  return {
    id: 'one', accountId: 'current', encrypted: true,
    workspaceAssignmentId: 'task-1', remoteRevision: 1,
    createdAt: 1_000_000, expiresAt: 1_900_000,
    title: 'Private title', note: 'PRIVATE NOTE',
    metadata: { location: { latitude: 11, longitude: 22 } },
    width: 600, height: 400, bytes: 12_000,
    mime: 'image/jpeg', method: 'image-capture', favorite: false,
    workspaceAccess: { role: 'viewer', read: true, thumbnail: true,
      edit: false, delete: false, share: false, shareExternal: false },
    ...overrides,
  } as Photo
}
describe('R1-12 scoped browser projection', () => {
  it('never carries original data, notes, GPS or editable Photo into the cache', () => {
    const items = visibleBrowserPhotos(collection, [photo()], 'current', 1_000_000)
    expect(items).toEqual([{ id: 'one', assignmentId: 'task-1',
      label: 'Private title', createdAt: 1_000_000, expiresAt: 1_900_000 }])
    expect(JSON.stringify(items)).not.toContain('PRIVATE NOTE')
    expect(JSON.stringify(items)).not.toContain('latitude')
    expect(items[0]).not.toHaveProperty('metadata')
    expect(items[0]).not.toHaveProperty('workspaceAccess')
  })
  it('hides private title and metadata from thumbnail-only recipients', () => {
    const limited = photo({ workspaceAccess: {
      role: 'viewer', read: false, thumbnail: true, edit: false,
      delete: false, share: false, shareExternal: false,
    }, shortId: 'ABCD1234' })
    expect(visibleBrowserPhotos(collection, [limited], 'current', 1_000_000)[0]).toMatchObject({
      label: 'ABCD1234', createdAt: 0,
    })
    expect(visibleBrowserPhotos(collection, [{ ...limited, shortId: undefined }], 'current', 1_000_000)[0]?.label).toBe('')
  })
  it('excludes other accounts, tasks, receipts, deleted/expired and unverified local rows', () => {
    const base = photo()
    const input = [
      photo({ id: 'foreign', accountId: 'other' }),
      photo({ id: 'wrong-assignment', workspaceAssignmentId: 'task-3' }),
      photo({ id: 'deleted', deleteRequested: true }),
      photo({ id: 'expired', expiresAt: 1 }),
      photo({ id: 'receipt', uploadOnly: true }),
      photo({ id: 'delivery', deliveryOnly: true }),
      photo({ id: 'local', remoteRevision: undefined }),
      photo({ id: 'denied', workspaceAccess: { ...base.workspaceAccess!, thumbnail: false } }),
      photo({ id: 'second-task', workspaceAssignmentId: 'task-2' }),
    ]
    expect(visibleBrowserPhotos(collection, input, 'current', 1_000_000).map(p => p.id))
      .toEqual(['second-task'])
    expect(visibleBrowserPhotos({ ...collection, expiresAt: 1 }, [base], 'current', 1_000_000)).toEqual([])
  })
  it('has distinct authenticated collection routes, never aliasing public card links', () => {
    const router = createAppRouter(createMemoryHistory())
    expect(router.resolve('/browser').name).toBe('photo-browser-new')
    expect(router.resolve('/browser/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa').name).toBe('photo-browser')
    expect(router.resolve('/c/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa').name).toBe('shared-card')
  })
})
