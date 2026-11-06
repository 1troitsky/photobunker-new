// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { Photo } from '../src/local/photos'
import type { BrowserOrganizer } from '../src/photo-browser/cache'
import { buildExplorer, changeExplorer, canMove, explorerRows, folderKey, photoKey } from '../src/photo-browser/explorer'

const labels = { all: 'All', personal: 'Personal', assignments: 'Assignments', archive: 'Archive', assignment: 'Assignment', photo: 'Photo' }
const tasks = [{ id: 'A', name: 'A', accountId: 'owner' }, { id: 'B', name: 'B', accountId: 'owner' }]
const photo = (id: string, assignment?: string, changes: Partial<Photo> = {}): Photo => ({
  id, accountId: 'owner', title: id, note: '', favorite: false, createdAt: 100, expiresAt: 2000,
  mime: 'image/jpeg', bytes: 1, width: 1, height: 1, method: 'demo', workspaceAssignmentId: assignment, ...changes,
})
const initial = (): BrowserOrganizer => ({ version: 1, folders: [
  { id: 'af', name: 'A folder', parentId: 'assignment:A', photoIds: [], createdAt: 1 },
  { id: 'bf', name: 'B folder', parentId: 'assignment:B', photoIds: ['a'], createdAt: 1 },
  { id: 'personal', name: 'Personal folder', photoIds: [], createdAt: 1 },
  { id: 'nested', name: 'Nested', parentId: 'personal', photoIds: [], createdAt: 1 },
] })
const data = () => [photo('a', 'A'), photo('b', 'B'), photo('p')]
const model = (value = initial(), photos = data()) => buildExplorer('owner', tasks, value, photos, labels, 1000)

describe('Approved Browser audit regressions, synthetic data only', () => {
  it('never displays a stale A reference in a B or personal folder', () => {
    const m = model()
    expect(m.entries.get(photoKey('a'))?.parent).toBe('assignment:A')
    expect(m.entries.get(folderKey('bf'))?.count).toBe(0)
    expect(canMove(m, [photoKey('a')], folderKey('bf'))).toBe(false)
    expect(canMove(m, [photoKey('a')], 'personal')).toBe(false)
    expect(() => changeExplorer(initial(), m, { type: 'move', keys: [photoKey('a')], target: folderKey('bf') })).toThrow('browser.scope')
  })
  it('moves within A without changing photo identity, assignment or TTL', () => {
    const photos = data(), m = model(initial(), photos)
    const before = JSON.stringify(photos)
    const next = changeExplorer(initial(), m, { type: 'move', keys: [photoKey('a')], target: folderKey('af') })
    expect(model(next, photos).entries.get(photoKey('a'))?.parent).toBe(folderKey('af'))
    expect(next.folders.find(folder => folder.id === 'bf')?.photoIds).not.toContain('a')
    expect(JSON.stringify(photos)).toBe(before)
  })
  it('rejects an unknown destination and exposes old orphan folders without rewriting storage', () => {
    const value = initial()
    value.folders.push({ id: 'orphan', name: 'Saved orphan', parentId: 'missing', photoIds: [], createdAt: 1 })
    const before = JSON.stringify(value), m = model(value)
    expect(() => changeExplorer(value, m, { type: 'create', parent: folderKey('missing'), name: 'No', id: 'new' })).toThrow('browser.location')
    expect(m.entries.get(folderKey('orphan'))).toMatchObject({ parent: 'personal', recovered: true })
    expect(JSON.stringify(value)).toBe(before)
  })
  it('creates in the current folder, rejects duplicate names and prevents folder cycles', () => {
    let value = changeExplorer(initial(), model(), { type: 'create', parent: folderKey('af'), name: 'Child', id: 'child' })
    expect(value.folders.find(folder => folder.id === 'child')?.parentId).toBe('af')
    expect(() => changeExplorer(value, model(value), { type: 'create', parent: folderKey('af'), name: 'child', id: 'other' })).toThrow('browser.duplicate')
    expect(canMove(model(value), [folderKey('af')], folderKey('child'))).toBe(false)
    value = changeExplorer(value, model(value), { type: 'rename', key: folderKey('child'), name: 'Renamed' })
    expect(value.folders.find(folder => folder.id === 'child')?.name).toBe('Renamed')
  })
  it('tree reveals nested rows only after expanding their actual parent', () => {
    const m = model(), base = { tree: true, sort: 'name' as const, query: '', tag: '' }
    expect(explorerRows(m, 'personal', { ...base, expanded: new Set() }).map(row => row.entry.key)).not.toContain(folderKey('nested'))
    expect(explorerRows(m, 'personal', { ...base, expanded: new Set([folderKey('personal')]) })
      .find(row => row.entry.key === folderKey('nested'))?.depth).toBe(1)
  })
  it('archive is a reversible organizer mark and never changes photo data or expiry', () => {
    const photos = data(), before = JSON.stringify(photos)
    let value = changeExplorer(initial(), model(), { type: 'archive', keys: [photoKey('p')], archived: true })
    expect(model(value).entries.get(photoKey('p'))?.parent).toBe('archive')
    expect(() => changeExplorer(value, model(value), { type: 'archive', keys: [photoKey('a')], archived: true })).toThrow('browser.scope')
    value = changeExplorer(value, model(value), { type: 'archive', keys: [photoKey('p')], archived: false })
    expect(model(value).entries.get(photoKey('p'))?.parent).toBe('personal')
    expect(JSON.stringify(photos)).toBe(before)
  })
  it('excludes foreign/expired/deleted data and redacts thumbnail-only metadata', () => {
    const m = model(initial(), [...data(), photo('foreign', '', { accountId: 'other' }), photo('expired', '', { expiresAt: 1 }),
      photo('deleted', '', { deleteRequested: true }), photo('thumb', 'A', { thumbnailOnly: true, title: 'SECRET', tags: ['SECRET'],
        workspaceAccess: { role: 'viewer', read: false, thumbnail: true, edit: false, delete: false, share: false, shareExternal: false } })])
    for (const id of ['foreign', 'expired', 'deleted']) expect(m.entries.has(photoKey(id))).toBe(false)
    expect(m.entries.get(photoKey('thumb'))).toMatchObject({ name: 'Photo', createdAt: 0, readable: false, editable: false, deletable: false })
    expect(explorerRows(m, 'assignment:A', { tree: false, expanded: new Set(), sort: 'name', query: 'SECRET', tag: '' })).toHaveLength(0)
  })
  it('removing a folder preserves its photos and reparents surviving subfolders', () => {
    let value = initial()
    value.folders.find(folder => folder.id === 'personal')!.photoIds = ['p']
    value = changeExplorer(value, model(value), { type: 'removeFolders', keys: [folderKey('personal')] })
    expect(value.folders.some(folder => folder.id === 'personal')).toBe(false)
    expect(model(value).entries.get(photoKey('p'))?.parent).toBe('personal')
    expect(model(value).entries.get(folderKey('nested'))?.parent).toBe('personal')
  })
})
