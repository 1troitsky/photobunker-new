import { ref, watch } from 'vue'
import * as local from '../local/photos'
import { accessCode, accessLibraryId, belongsToServer, deleteServerPhoto, ensureAccess, fetchClock, ServerError } from '../server/api'
import { saveOnServer, syncMetadata } from '../server/photos'
import { captureRetention, clockTime, isExpired, rememberAnchor } from './clock'
import { removePhotoVersions } from '../studio/versions'

export const delivery = ref({ pending: 0, deleting: 0, failed: 0, busy: false, storageFailed: false })
let running: Promise<void> | undefined
let clockUpdated = 0
let clockLibrary = ''
export async function refreshClock(force = false) {
  if (!accessCode.value || !navigator.onLine || !force && clockLibrary === accessLibraryId.value && Date.now() - clockUpdated < 30_000) return
  const library = accessLibraryId.value
  const anchor = await fetchClock()
  if (library !== accessLibraryId.value) return
  rememberAnchor(library, anchor); clockUpdated = Date.now(); clockLibrary = library
}
function changed() { window.dispatchEvent(new Event('photobunker-delivery')) }
function firstCapture(photo: local.Photo) {
  return photo.initialCapture && !photo.uiOnly && !photo.profile && !photo.spaceId && !photo.assignmentId && !photo.retentionAnchor && photo.retentionSeconds && photo.expiresAt !== undefined && (!photo.remoteLibraryId || belongsToServer(photo)) && !photo.deleteRequested
}
function relevant(photo: local.Photo) { return !photo.uiOnly && (belongsToServer(photo) || firstCapture(photo)) }
async function run() {
  delivery.value.busy = true
  try {
    try { await refreshClock() } catch { /* Offline work remains durable. */ }
    let rows = await local.listPhotos()
    delivery.value.storageFailed = false
    for (const photo of rows) if (!photo.deleteRequested && isExpired(photo)) { if (photo.uiOnly) { await removePhotoVersions(photo); await local.deletePhoto(photo.id) } else if (photo.deliveryOnly) await local.deletePhoto(photo.id); else await local.revokePhoto(photo.id) }
    rows = await local.listPhotos()
    const first = rows.filter(photo => firstCapture(photo) && (photo.nextAttemptAt ?? 0) <= Date.now())
    if (navigator.onLine && first.length) {
      try { await ensureAccess(); await refreshClock(true) }
      catch {
        for (const photo of first) {
          const attempts = (photo.uploadAttempts ?? 0) + 1
          await local.patchPhoto(photo.id, { uploadError: 'network', uploadAttempts: attempts, nextAttemptAt: Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(6, attempts)) })
        }
        return
      }
      const library = accessLibraryId.value
      for (const photo of first) {
        if (photo.remoteLibraryId && photo.remoteLibraryId !== library) continue
        const bound = captureRetention(library, photo.createdAt, photo.retentionSeconds!)
        if (!bound.retentionAnchor || !clockTime(library).certain) continue
        // A first-ever private capture has no server clock yet. Bind it once,
        // keeping its original local deadline as a hard cap. Existing captures
        // never get replacement anchors, including on manual retry.
        await local.patchPhoto(photo.id, { initialCapture: false, remoteLibraryId: library, creatorId: library, retentionAnchor: bound.retentionAnchor, expiresAt: Math.min(photo.expiresAt!, bound.expiresAt), uploadError: undefined, nextAttemptAt: 0 }, { initialCapture: true, remoteLibraryId: photo.remoteLibraryId })
      }
      rows = await local.listPhotos()
    }
    const scoped = rows.filter(relevant)
    delivery.value.pending = scoped.filter(photo => photo.uploadRequested || photo.metadataDirty).length
    delivery.value.deleting = scoped.filter(photo => photo.deleteRequested).length
    delivery.value.failed = scoped.filter(photo => photo.uploadError).length
    if (!navigator.onLine || !accessCode.value) return
    for (const photo of scoped) {
      if (!belongsToServer(photo)) break // The account may change during a request.
      if (!photo.deleteRequested && !photo.uploadRequested && !photo.metadataDirty) continue
      if ((photo.nextAttemptAt ?? 0) > Date.now()) continue
      if (['quota', 'permission', 'conflict', 'clock'].includes(photo.uploadError ?? '')) continue
      try {
        if (photo.deleteRequested) {
          // A 202 response still means server files await verified cleanup.
          const verified = await deleteServerPhoto(photo.id, photo.spaceId)
          if (verified) await local.deletePhoto(photo.id)
          else await local.patchPhoto(photo.id, { nextAttemptAt: Date.now() + 30_000 })
        } else {
          if (photo.expiresAt !== undefined && (!photo.retentionAnchor || !clockTime(photo.remoteLibraryId!).certain)) {
            await local.patchPhoto(photo.id, { uploadError: 'clock' }); continue
          }
          if (photo.uploadRequested) await saveOnServer(photo.id)
          else await syncMetadata(photo.id)
          await local.patchPhoto(photo.id, { uploadError: undefined, uploadAttempts: 0, nextAttemptAt: 0 })
        }
      } catch (error) {
        const current = await local.readMetadata(photo.id)
        if (!current) continue
        if (error instanceof ServerError && error.status === 410) { await local.revokePhoto(photo.id); continue }
        const status = error instanceof ServerError ? error.status : 0
        const uploadError = status === 413 ? 'quota' : status === 409 ? 'conflict' : [401, 403, 422].includes(status) ? 'permission' : 'network'
        const attempts = (current.uploadAttempts ?? 0) + 1
        await local.patchPhoto(photo.id, { uploadError, uploadAttempts: attempts, nextAttemptAt: Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(6, attempts)) })
      }
    }
  } catch { delivery.value.storageFailed = true }
  finally {
    try {
      const scoped = (await local.listPhotos()).filter(relevant)
      delivery.value.pending = scoped.filter(photo => !photo.deleteRequested && (photo.uploadRequested || photo.metadataDirty)).length
      delivery.value.deleting = scoped.filter(photo => photo.deleteRequested).length
      delivery.value.failed = scoped.filter(photo => photo.uploadError).length
    } catch { delivery.value.storageFailed = true }
    delivery.value.busy = false; changed()
  }
}
export function flushDelivery(): Promise<void> {
  if (running) return running
  const task = async () => {
    if (navigator.locks) await navigator.locks.request('photobunker-outbox', { ifAvailable: true }, async lock => { if (lock) await run() })
    else await run()
  }
  running = task().finally(() => { running = undefined })
  return running
}
export async function retryDelivery() {
  try { await refreshClock(true) } catch { /* Show offline state through the queue. */ }
  for (const photo of await local.listPhotos()) if (relevant(photo)) await local.patchPhoto(photo.id, { uploadError: undefined, nextAttemptAt: 0 })
  await flushDelivery()
}
export function startDelivery() {
  if (!local.localPrototype) return () => {}
  const wake = () => { void flushDelivery() }
  const online = () => { clockUpdated = 0; void retryDelivery() }
  const visible = () => { if (!document.hidden) wake() }
  const stopWatch = watch(accessLibraryId, () => { clockUpdated = 0; wake() })
  const timer = setInterval(wake, 2000)
  window.addEventListener('photobunker-outbox', wake); window.addEventListener('online', online)
  window.addEventListener('focus', wake); document.addEventListener('visibilitychange', visible)
  wake()
  return () => { clearInterval(timer); stopWatch(); window.removeEventListener('photobunker-outbox', wake); window.removeEventListener('online', online); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', visible) }
}
