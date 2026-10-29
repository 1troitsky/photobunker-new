import { spaceAccess } from '../collaboration/access'
import type { Space } from '../collaboration/model'
import { ref } from 'vue'
import { localPrototype } from '../local/photos'
import type { Photo, PhotoChanges } from '../local/photos'
const KEY = 'photobunker-prototype-access'
export const accessCode = ref('')
export const accessLibraryId = ref('')
export const accessSaved = ref(true)
if (localPrototype) {
  try { accessCode.value = localStorage.getItem(KEY) ?? ''; accessLibraryId.value = localStorage.getItem(`${KEY}-library`) ?? '' } catch { accessSaved.value = false }
}
export function belongsToServer(photo: Photo) { return !!accessCode.value && photo.remoteLibraryId === accessLibraryId.value }
export class ServerError extends Error {
  constructor(public readonly status: number) { super('prototype.server_request_failed') }
}
async function request(path: string, init: RequestInit = {}, code = accessCode.value): Promise<Response> {
  if (!localPrototype) throw new ServerError(404)
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (code) headers.set('Authorization', `Bearer ${code}`)
  const response = await fetch(`/api/v1/prototype${path}`, { ...init, headers, cache: 'no-store', credentials: 'omit', signal: init.signal ?? AbortSignal.timeout(60_000) })
  if (!response.ok) throw new ServerError(response.status)
  return response
}
export const prototypeRequest = request
function remember(code: string, library: string) {
  spaceAccess.value = undefined
  accessCode.value = code
  accessLibraryId.value = library
  try { localStorage.setItem(KEY, code); localStorage.setItem(`${KEY}-library`, library); accessSaved.value = true } catch { accessSaved.value = false }
}
let creating: Promise<void> | undefined
export async function ensureAccess() {
  if (accessCode.value) return
  if (!creating) creating = (async () => {
    const response = await request('/libraries', { method: 'POST' }, '')
    const data = await response.json() as { accessCode: string; libraryId: string }
    if (!/^[a-f0-9]{64}$/.test(data.accessCode)) throw new Error('prototype.invalid_response')
    // A library restored while this request was in flight must win.
    if (!accessCode.value) remember(data.accessCode, data.libraryId)
  })().finally(() => { creating = undefined })
  await creating
}
export async function restoreAccess(code: string) {
  const normalized = code.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new ServerError(401)
  const data = await (await request('/photos', {}, normalized)).json()
  remember(normalized, data.libraryId)
}
export async function listServerPhotos(): Promise<{ photos: Photo[]; deleted: string[]; spaces?: Space[] }> {
  if (!accessCode.value) return { photos: [], deleted: [] }
  const result = await (await request('/photos')).json()
  spaceAccess.value = result.spaces
  return result
}
export async function serverPhoto(id: string): Promise<Photo> { return (await (await request(`/photos/${encodeURIComponent(id)}`)).json()).photo }
export async function serverContent(id: string, kind: 'original' | 'thumbnail', mime: string, bytes?: number): Promise<Blob> {
  const blob = await (await request(`/photos/${encodeURIComponent(id)}/${kind}`)).blob()
  if (!blob.size || bytes !== undefined && blob.size !== bytes) throw new Error('prototype.incomplete_response')
  return new Blob([blob], { type: mime })
}
export async function uploadPhoto(photo: Photo, blob: Blob, thumbnail: Blob): Promise<Photo> {
  await ensureAccess()
  if (photo.remoteLibraryId && !belongsToServer(photo)) throw new ServerError(403)
  // Re-materialize IDB file-backed blobs before WebKit's multipart serializer.
  const originalBytes = await blob.arrayBuffer(); const thumbnailBytes = await thumbnail.arrayBuffer()
  if (blob.size !== originalBytes.byteLength || thumbnail.size !== thumbnailBytes.byteLength) throw new ServerError(503)
  const checksum = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
  const originalChecksum = await checksum(originalBytes); const thumbnailChecksum = await checksum(thumbnailBytes)
  if (photo.remoteLibraryId && !belongsToServer(photo)) throw new ServerError(403)
  const form = new FormData()
  form.set('manifest', JSON.stringify({ ...photo, originalChecksum, thumbnailChecksum }))
  form.set('original', new Blob([originalBytes], { type: blob.type }), 'original')
  form.set('thumbnail', new Blob([thumbnailBytes], { type: thumbnail.type }), 'thumbnail')
  return (await (await request('/photos', { method: 'POST', body: form })).json()).photo
}
export async function updateServerPhoto(photo: Photo, changes: PhotoChanges): Promise<Photo> {
  if (photo.remoteLibraryId && !belongsToServer(photo)) throw new ServerError(403)
  return (await (await request(`/photos/${photo.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...changes, revision: photo.remoteRevision }) })).json()).photo
}
export async function deleteServerPhoto(id: string, spaceId?: string): Promise<boolean> { const response = await request(`/photos/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spaceId }) }); return response.status === 200 }

export async function fetchClock(): Promise<{ id: string; issuedAt: number }> {
  return (await request('/clock', { method: 'POST' })).json()
}

export function forgetLegacyLibraryAccess() {
  accessCode.value = ''; accessLibraryId.value = ''
  localStorage.removeItem(KEY); localStorage.removeItem(`${KEY}-library`)
}
