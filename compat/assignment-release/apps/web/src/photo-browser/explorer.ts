import type { Photo } from '../local/photos'
import type { BrowserOrganizer } from './cache'
import { clockTime, isExpired } from '../delivery/clock'

export type BrowserSection = 'all' | 'personal' | 'assignments' | 'archive'
export type BrowserScope = 'personal' | `assignment:${string}`
export type BrowserSort = 'name' | 'newest' | 'oldest'
export type ExplorerEntry = {
  key: string; id: string; name: string
  kind: 'section' | 'assignment' | 'folder' | 'photo'
  parent?: string; scope?: BrowserScope; photo?: Photo
  createdAt: number; count: number; recovered?: boolean; archived?: boolean
  readable?: boolean; editable?: boolean; deletable?: boolean; shareable?: boolean
}
export type Explorer = { entries: Map<string, ExplorerEntry>; children: Map<string, ExplorerEntry[]> }
export type ExplorerLabels = Record<BrowserSection, string> & { assignment: string; photo: string }
export type ExplorerTask = { id: string; name: string; accountId?: string }
export const assignmentOf = (photo: Photo) =>
  photo.workspaceAssignmentId || photo.uiAssignmentId || photo.assignmentId || photo.spaceId || ''
export const folderKey = (id: string) => 'folder:' + id
export const photoKey = (id: string) => 'photo:' + id
export const isSection = (value: string): value is BrowserSection =>
  ['all', 'personal', 'assignments', 'archive'].includes(value)

/** One scoped projection supplies list, grid, tree, counts and action validation. */
export function buildExplorer(owner: string, tasks: ExplorerTask[], organizer: BrowserOrganizer,
  photos: Photo[], labels: ExplorerLabels, now?: number): Explorer {
  const entries = new Map<string, ExplorerEntry>(), children = new Map<string, ExplorerEntry[]>()
  const add = (entry: ExplorerEntry) => { entries.set(entry.key, entry); return entry }
  for (const key of ['all', 'personal', 'assignments', 'archive'] as const)
    add({ key, id: key, name: labels[key], kind: 'section', count: 0, createdAt: 0,
      ...(key === 'all' ? {} : { parent: 'all' }),
      ...(key === 'personal' || key === 'archive' ? { scope: 'personal' as const } : {}) })
  const clocks = new Map<string, number>()
  const timeFor = (photo: Photo) => {
    if (now !== undefined) return now
    const library = photo.remoteLibraryId ?? ''
    if (!clocks.has(library)) clocks.set(library, clockTime(library).now)
    return clocks.get(library)!
  }
  const allowed = photos.filter(photo => !!owner && photo.accountId === owner &&
    !photo.deleteRequested && !photo.deliveryOnly && !photo.uploadOnly && !photo.uiVersionOf &&
    !isExpired(photo, timeFor(photo)) && (!photo.workspaceAccess || photo.workspaceAccess.read || photo.workspaceAccess.thumbnail))
  const taskMap = new Map(tasks.filter(task => !task.accountId || task.accountId === owner).map(task => [task.id, task]))
  for (const folder of organizer.folders) {
    if (folder.parentId?.startsWith('assignment:')) {
      const id = folder.parentId.slice('assignment:'.length)
      if (id && !taskMap.has(id)) taskMap.set(id, { id, name: labels.assignment, accountId: owner })
    }
  }
  for (const photo of allowed) {
    const id = assignmentOf(photo)
    if (id && !taskMap.has(id)) taskMap.set(id, { id, name: labels.assignment, accountId: owner })
  }
  for (const task of taskMap.values()) {
    const key = `assignment:${task.id}` as const
    add({ key, id: task.id, name: task.name, parent: 'assignments', scope: key,
      kind: 'assignment', count: 0, createdAt: 0 })
  }
  const folders = new Map(organizer.folders.map(folder => [folder.id, folder]))
  const resolving = new Set<string>()
  function resolve(id: string): ExplorerEntry | undefined {
    const key = folderKey(id), saved = entries.get(key)
    if (saved) return saved
    const folder = folders.get(id)
    if (!folder || resolving.has(id)) return
    resolving.add(id)
    let parent = entries.get('personal')!, recovered = false
    if (folder.parentId) {
      const candidate = folder.parentId.startsWith('assignment:')
        ? entries.get(folder.parentId) : resolve(folder.parentId)
      if (candidate?.scope) parent = candidate
      else recovered = true
    }
    resolving.delete(id)
    return add({ key, id, name: folder.name, kind: 'folder', parent: parent.key,
      scope: parent.scope, count: 0, createdAt: folder.createdAt, recovered })
  }
  for (const folder of organizer.folders) resolve(folder.id)
  const membership = new Map<BrowserScope, Map<string, string>>()
  for (const folder of organizer.folders) {
    const node = entries.get(folderKey(folder.id))
    if (!node?.scope) continue
    let index = membership.get(node.scope)
    if (!index) { index = new Map(); membership.set(node.scope, index) }
    for (const id of folder.photoIds) if (!index.has(id)) index.set(id, node.key)
  }
  const archived = new Set(organizer.archivedPhotoIds ?? [])
  for (const photo of allowed) {
    const assignment = assignmentOf(photo)
    const scope: BrowserScope = assignment ? `assignment:${assignment}` : 'personal'
    const archivedPhoto = scope === 'personal' && archived.has(photo.id)
    const folder = membership.get(scope)?.get(photo.id)
    const readable = !photo.thumbnailOnly && (photo.workspaceAccess?.read ?? true)
    add({ key: photoKey(photo.id), id: photo.id, name: readable
      ? photo.title?.trim() || photo.shortId || labels.photo : photo.shortId || labels.photo,
      kind: 'photo', scope, photo, createdAt: readable ? photo.createdAt : 0, count: 0, archived: archivedPhoto,
      parent: archivedPhoto ? 'archive' : folder ?? scope,
      readable, editable: readable && (photo.workspaceAccess?.edit ?? photo.access?.role !== 'viewer'),
      deletable: photo.workspaceAccess?.delete ?? photo.access?.role !== 'viewer',
      shareable: photo.workspaceAccess?.shareExternal === true })
  }
  for (const entry of entries.values()) {
    if (entry.parent) {
      let siblings = children.get(entry.parent)
      if (!siblings) { siblings = []; children.set(entry.parent, siblings) }
      siblings.push(entry)
    }
  }
  function count(key: string): number {
    const entry = entries.get(key)!
    entry.count = (children.get(key) ?? []).reduce((sum, child) => sum +
      (child.kind === 'photo' ? 1 : count(child.key)), 0)
    return entry.count
  }
  count('all')
  return { entries, children }
}

export function ancestors(model: Explorer, key: string): ExplorerEntry[] {
  const result: ExplorerEntry[] = [], seen = new Set<string>()
  let entry = model.entries.get(key)
  while (entry && !seen.has(entry.key)) {
    seen.add(entry.key); result.unshift(entry)
    entry = entry.parent ? model.entries.get(entry.parent) : undefined
  }
  return result
}
export function descendants(model: Explorer, key: string): ExplorerEntry[] {
  return (model.children.get(key) ?? []).flatMap(entry =>
    [entry, ...descendants(model, entry.key)])
}
export function writable(entry?: ExplorerEntry): boolean {
  return !!entry?.scope && (entry.kind === 'folder' || entry.kind === 'assignment' || entry.key === 'personal')
}
export function sortEntries(entries: ExplorerEntry[], sort: BrowserSort): ExplorerEntry[] {
  return [...entries].sort((a, b) => Number(a.kind === 'photo') - Number(b.kind === 'photo') ||
    (a.kind === 'section' && b.kind === 'section' ? ['personal', 'assignments', 'archive'].indexOf(a.key) - ['personal', 'assignments', 'archive'].indexOf(b.key) : 0) ||
    (sort === 'name' ? a.name.localeCompare(b.name, undefined, { numeric: true }) :
      (sort === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt)) || a.key.localeCompare(b.key))
}
export type ExplorerRow = { entry: ExplorerEntry; depth: number; expanded: boolean; expandable: boolean }
export function explorerRows(model: Explorer, location: string, options: {
  tree: boolean; expanded: Set<string>; sort: BrowserSort; query: string; tag: string
}): ExplorerRow[] {
  const query = options.query.trim().toLocaleLowerCase(), filtered = !!query || !!options.tag
  const matches = (entry: ExplorerEntry) => {
    const tags = entry.readable ? entry.photo?.tags ?? [] : []
    return (!options.tag || tags.includes(options.tag)) && (!query ||
      `${entry.name} ${entry.readable ? entry.photo?.shortId ?? '' : ''} ${tags.join(' ')}`.toLocaleLowerCase().includes(query))
  }
  const found = new Set<string>()
  if (filtered) for (const entry of descendants(model, location).filter(matches)) {
    found.add(entry.key)
    if (options.tree) for (const parent of ancestors(model, entry.key)) found.add(parent.key)
  }
  const row = (entry: ExplorerEntry, depth: number): ExplorerRow => ({ entry, depth,
    expanded: options.expanded.has(entry.key) || filtered,
    expandable: (model.children.get(entry.key)?.length ?? 0) > 0 })
  if (!options.tree) return sortEntries(filtered ? descendants(model, location).filter(matches)
    : model.children.get(location) ?? [], options.sort).map(entry => row(entry, 0))
  function walk(key: string, depth: number): ExplorerRow[] {
    return sortEntries(model.children.get(key) ?? [], options.sort)
      .filter(entry => !filtered || found.has(entry.key)).flatMap(entry => {
        const current = row(entry, depth)
        return [current, ...(current.expanded ? walk(entry.key, depth + 1) : [])]
      })
  }
  return walk(location, 0)
}

export type OrganizerAction =
  | { type: 'create'; parent: string; name: string; id: string }
  | { type: 'rename'; key: string; name: string }
  | { type: 'move'; keys: string[]; target: string }
  | { type: 'removeFolders'; keys: string[] }
  | { type: 'archive'; keys: string[]; archived: boolean }

function storedParent(entry: ExplorerEntry): string | undefined {
  return entry.kind === 'folder' ? entry.id : entry.kind === 'assignment' ? entry.key : undefined
}
export function canMove(model: Explorer, keys: string[], targetKey: string): boolean {
  const target = model.entries.get(targetKey)
  return writable(target) && keys.length > 0 && keys.every(key => {
    const entry = model.entries.get(key)
    return !!entry && (entry.kind === 'folder' || entry.kind === 'photo') && !entry.archived &&
      entry.scope === target?.scope && !ancestors(model, targetKey).some(item => item.key === key)
  })
}
export function changeExplorer(value: BrowserOrganizer, model: Explorer, action: OrganizerAction): BrowserOrganizer {
  const folders = value.folders.map(folder => ({ ...folder, photoIds: [...folder.photoIds] }))
  const result = { ...value, folders }
  const requireEntry = (key: string) => {
    const entry = model.entries.get(key)
    if (!entry) throw new Error('browser.location')
    return entry
  }
  const requireName = (name: string, parent: string, excluded?: string) => {
    name = name.trim()
    if (!name || name.length > 80 || /[\\/\x00-\x1f\x7f]/.test(name) || name === '.' || name === '..')
      throw new Error('browser.name')
    if ((model.children.get(parent) ?? []).some(entry => entry.key !== excluded &&
      entry.kind !== 'photo' && entry.name.toLocaleLowerCase() === name.toLocaleLowerCase()))
      throw new Error('browser.duplicate')
    return name
  }
  if (action.type === 'create') {
    const parent = requireEntry(action.parent)
    if (!writable(parent)) throw new Error('browser.location')
    const name = requireName(action.name, parent.key)
    if (folders.length >= 200 || folders.some(folder => folder.id === action.id)) throw new Error('browser.limit')
    folders.push({ id: action.id, name, photoIds: [], createdAt: Date.now(), parentId: storedParent(parent) })
  } else if (action.type === 'rename') {
    const entry = requireEntry(action.key)
    if (entry.kind !== 'folder') throw new Error('browser.denied')
    folders.find(folder => folder.id === entry.id)!.name = requireName(action.name, entry.parent!, entry.key)
  } else if (action.type === 'move') {
    if (!canMove(model, action.keys, action.target)) throw new Error('browser.scope')
    const target = requireEntry(action.target), selected = new Set(action.keys)
    const names = new Set((model.children.get(target.key) ?? []).filter(entry =>
      entry.kind !== 'photo' && !selected.has(entry.key)).map(entry => entry.name.toLocaleLowerCase()))
    const entries = action.keys.map(requireEntry).filter(entry =>
      !ancestors(model, entry.key).slice(0, -1).some(parent => selected.has(parent.key)))
    for (const entry of entries) {
      if (entry.kind === 'folder') {
        requireName(entry.name, target.key, entry.key)
        if (names.has(entry.name.toLocaleLowerCase())) throw new Error('browser.duplicate')
        names.add(entry.name.toLocaleLowerCase())
        folders.find(folder => folder.id === entry.id)!.parentId = storedParent(target)
      } else {
        for (const folder of folders) folder.photoIds = folder.photoIds.filter(id => id !== entry.id)
        if (target.kind === 'folder') folders.find(folder => folder.id === target.id)!.photoIds.push(entry.id)
      }
    }
  } else if (action.type === 'archive') {
    const ids = new Set(value.archivedPhotoIds ?? [])
    for (const entry of action.keys.map(requireEntry)) {
      if (entry.kind !== 'photo' || entry.scope !== 'personal') throw new Error('browser.scope')
      if (action.archived) ids.add(entry.id); else ids.delete(entry.id)
    }
    result.archivedPhotoIds = [...ids]
  } else {
    const removed = new Set(action.keys.map(requireEntry).map(entry => {
      if (entry.kind !== 'folder') throw new Error('browser.denied')
      return entry.key
    }))
    for (const entry of model.entries.values()) {
      if (!entry.parent || !removed.has(entry.parent)) continue
      const parent = ancestors(model, entry.key).slice(0, -1).reverse().find(item => !removed.has(item.key))!
      if (entry.kind === 'folder' && !removed.has(entry.key))
        folders.find(folder => folder.id === entry.id)!.parentId = storedParent(parent)
      if (entry.kind === 'photo' && parent.kind === 'folder')
        folders.find(folder => folder.id === parent.id)!.photoIds.push(entry.id)
    }
    result.folders = folders.filter(folder => !removed.has(folderKey(folder.id)))
  }
  return result
}
