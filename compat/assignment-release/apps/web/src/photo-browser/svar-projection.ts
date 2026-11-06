import type { Photo } from '../local/photos'
import type { BrowserFolder } from './cache'

/**
 * SVAR represents items by mutable paths. PhotoBunker NEVER uses those paths
 * as durable ids: this adapter maps each ephemeral SVAR path to an immutable
 * photo/assignment/folder id, scoped to the current account.
 */
export type BrowserScope = 'personal' | `assignment:${string}`
export const assignmentScope = (id: string): BrowserScope => `assignment:${id}`
export type BrowserEntry =
  | { kind: 'personal' | 'assignments'; id: string; scope: BrowserScope | '' }
  | { kind: 'assignment' | 'folder'; id: string; scope: BrowserScope }
  | { kind: 'photo'; id: string; scope: BrowserScope; readable: boolean }

export type SvarFile = {
  id: string
  type: 'folder' | 'file'
  date: Date
  size?: number
}
export type BrowserTask = { id: string; name: string }
export type BrowserProjection = {
  data: SvarFile[]
  byPath: Map<string, BrowserEntry>
  paths: Map<string, string>
  parent: Map<string, string>
}

export function photoAssignmentId(photo: Photo): string {
  return photo.workspaceAssignmentId || photo.uiAssignmentId || photo.assignmentId || ''
}

/** Path labels are only a UI convenience; collisions get a display suffix. */
function segment(value: string): string {
  const safe = value.replace(/[\\/\x00-\x1f\x7f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 80)
  return safe && safe !== '.' && safe !== '..' ? safe : 'Untitled'
}

export function buildSvarProjection(
  owner: string,
  tasks: BrowserTask[],
  folders: BrowserFolder[],
  photos: Photo[],
  labels: { personal: string; assignments: string; photo: string },
  now = Date.now(),
): BrowserProjection {
  const data: SvarFile[] = []
  const byPath = new Map<string, BrowserEntry>()
  const paths = new Map<string, string>()
  const parent = new Map<string, string>()
  const used = new Set<string>()
  const pathKey = (kind: BrowserEntry['kind'], id: string) => kind + ':' + id
  function add(base: string, label: string, entry: BrowserEntry,
    type: SvarFile['type'], at: number, size?: number): string {
    const name = segment(label)
    let path = (base === '/' ? '' : base) + '/' + name
    let next = 2
    while (used.has(path.toLocaleLowerCase())) {
      path = (base === '/' ? '' : base) + '/' + name + ' (' + next++ + ')'
    }
    used.add(path.toLocaleLowerCase())
    byPath.set(path, entry)
    paths.set(pathKey(entry.kind, entry.id), path)
    parent.set(path, base)
    data.push({ id: path, type, date: new Date(Number.isFinite(at) && at > 0 ? at : now),
      ...(size !== undefined && Number.isFinite(size) ? { size } : {}) })
    return path
  }
  const personal = add('/', labels.personal, { kind: 'personal', id: 'personal', scope: 'personal' }, 'folder', now)
  const assignments = add('/', labels.assignments, { kind: 'assignments', id: 'assignments', scope: '' }, 'folder', now)
  const knownTasks = new Set(tasks.map(task => task.id))
  for (const task of tasks) {
    if (!task.id) continue
    add(assignments, task.name, { kind: 'assignment', id: task.id, scope: assignmentScope(task.id) },
      'folder', now)
  }

  // Invalid/cyclic/orphaned folders are ignored instead of falling back to
  // Personal and thereby exposing contents under the wrong root.
  const seen = new Set<string>()
  let pending = folders.filter(folder => folder.id && folder.name && !folder.id.startsWith('assignment:'))
  for (let pass = 0; pass < folders.length + 1 && pending.length; pass++) {
    const remaining: BrowserFolder[] = []
    let progressed = false
    for (const folder of pending) {
      if (seen.has(folder.id)) continue
      let parentPath = personal
      let scope: BrowserScope = 'personal'
      if (folder.parentId?.startsWith('assignment:')) {
        const taskId = folder.parentId.slice('assignment:'.length)
        if (!knownTasks.has(taskId)) continue
        parentPath = paths.get(pathKey('assignment', taskId))!
        scope = assignmentScope(taskId)
      } else if (folder.parentId) {
        const target = paths.get(pathKey('folder', folder.parentId))
        if (!target) { remaining.push(folder); continue }
        parentPath = target
        scope = (byPath.get(target) as Extract<BrowserEntry, { kind: 'folder' }>).scope
      }
      add(parentPath, folder.name, { kind: 'folder', id: folder.id, scope }, 'folder', folder.createdAt)
      seen.add(folder.id)
      progressed = true
    }
    if (!progressed) break
    pending = remaining
  }

  const photoFolder = new Map<string, string>()
  // Folder membership never changes assignment or ACL. Index it by scope too,
  // so a stale cross-assignment reference cannot shadow a legitimate folder.
  for (const folder of folders) {
    const path = paths.get(pathKey('folder', folder.id))
    if (!path) continue
    const targetScope = (byPath.get(path) as Extract<BrowserEntry, { kind: 'folder' }>).scope
    for (const id of folder.photoIds) {
      const key = targetScope + ':' + id
      if (!photoFolder.has(key)) photoFolder.set(key, path)
    }
  }
  for (const photo of photos) {
    if (!owner || photo.accountId !== owner || photo.deleteRequested ||
      photo.deliveryOnly || photo.uploadOnly || photo.uiVersionOf ||
      (photo.expiresAt !== undefined && photo.expiresAt <= now)) continue
    if (photo.workspaceAccess && !photo.workspaceAccess.read && !photo.workspaceAccess.thumbnail)
      continue
    const assignmentId = photoAssignmentId(photo)
    if (assignmentId && !knownTasks.has(assignmentId)) continue
    const scope: BrowserScope = assignmentId ? assignmentScope(assignmentId) : 'personal'
    const defaultParent = assignmentId ? paths.get(pathKey('assignment', assignmentId))! : personal
    const specified = photoFolder.get(scope + ':' + photo.id)
    const base = specified || defaultParent
    const readable = !photo.thumbnailOnly && (!photo.workspaceAccess || photo.workspaceAccess.read)
    const label = readable ? (photo.title?.trim() || photo.shortId || labels.photo) :
      (photo.shortId || labels.photo)
    const suffix = photo.mime === 'image/png' ? '.png' :
      photo.mime === 'image/webp' ? '.webp' : '.jpg'
    const fileName = label.match(/\.(png|jpe?g|webp)$/i) ? label : label + suffix
    add(base, fileName, { kind: 'photo', id: photo.id, scope, readable },
      'file', photo.createdAt, photo.bytes)
  }
  return { data, byPath, paths, parent }
}
