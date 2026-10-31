import { localPrototype } from '../local/photos'

export const WORKSPACE_DB = 'photobunker-ui-workspace-v1'
type RecordValue = { id: string; revision: number }
type Entry<T> = { key: string; scope: string; collection: string; value: T }
export class WorkspaceConflict extends Error { constructor() { super('workspace.conflict') } }
async function open(): Promise<IDBDatabase> {
  if (!localPrototype || !globalThis.indexedDB) throw new DOMException('Local workspace unavailable', 'NotSupportedError')
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WORKSPACE_DB, 1)
    let blocked = false
    request.onupgradeneeded = () => request.result.createObjectStore('records', { keyPath: 'key' })
    request.onerror = () => reject(request.error)
    request.onblocked = () => { blocked = true; reject(new DOMException('Close other app tabs', 'InvalidStateError')) }
    request.onsuccess = () => { if (blocked) { request.result.close(); return }; request.result.onversionchange = () => request.result.close(); resolve(request.result) }
  })
}
export async function list<T>(scope: string, collection: string, prefix = false): Promise<T[]> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records'); const request = tx.objectStore('records').getAll()
    tx.oncomplete = () => { db.close(); resolve((request.result as Entry<T>[]).filter(row => row.scope === scope && (prefix ? row.collection.startsWith(collection) : row.collection === collection)).map(row => row.value)) }
    tx.onabort = () => { db.close(); reject(tx.error) }
  })
}
export async function save<T extends RecordValue>(scope: string, collection: string, value: T, expected: number): Promise<T> {
  const db = await open(); const key = `${scope}:${collection}:${value.id}`
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite'); const store = tx.objectStore('records'); const request = store.get(key)
    let conflict = false, failure: unknown
    const saved = { ...value, revision: expected + 1 }
    request.onsuccess = () => { if ((request.result?.value.revision ?? 0) !== expected) { conflict = true; tx.abort() } else { try { store.put({ key, scope, collection, value: saved }) } catch (error) { failure = error; tx.abort() } } }
    tx.onerror = () => { try { tx.abort() } catch {} }
    tx.oncomplete = () => { db.close(); resolve(saved) }
    tx.onabort = () => { db.close(); reject(conflict ? new WorkspaceConflict() : failure ?? tx.error ?? new DOMException('Aborted', 'AbortError')) }
  })
}
export async function remove(scope: string, collection: string, value: RecordValue): Promise<void> {
  const db = await open(); const key = `${scope}:${collection}:${value.id}`
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite'); const store = tx.objectStore('records'); const request = store.get(key); let conflict = false
    request.onsuccess = () => { if (request.result && request.result.value.revision !== value.revision) { conflict = true; tx.abort() } else store.delete(key) }
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onabort = () => { db.close(); reject(conflict ? new WorkspaceConflict() : tx.error) }
  })
}

export async function clearScope(scope: string): Promise<void> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite'), request = tx.objectStore('records').openCursor()
    request.onsuccess = () => { const cursor = request.result; if (cursor) { if (cursor.value.scope === scope) cursor.delete(); cursor.continue() } }
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onabort = () => { db.close(); reject(new Error('storage.cleanup_failed')) }
  })
}
