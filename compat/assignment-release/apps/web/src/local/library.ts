import { protectionEnabled, protectionReady, photoReadAllowed } from '../crypto/store'
import { appLockReady, appLocked } from '../app/lock'
import { index as secureIndex } from '../crypto/photos'
import { receipts } from '../workspace/state'
import { account } from '../identity/store'
import { photoIndex } from '../workspace/api'
import { localVisible } from '../collaboration/access'
import { computed, shallowRef, watch } from 'vue'
import {
  deletePhoto,
  listPhotos,
  localPrototype,
} from './photos'
import { isExpired } from '../delivery/clock'
import type { Photo } from './photos'

export const photos = shallowRef<Photo[]>([])
export const libraryError = shallowRef(false)
export const libraryLoading = shallowRef(false)
export const serverError = shallowRef(false)
export const usedBytes = computed(() =>
  photos.value.reduce((sum, photo) => sum + photo.bytes, 0),
)
let generation = 0

export async function refreshLibrary() {
  if (!localPrototype) return
  const current = ++generation
  if (account.value && (!appLockReady.value || appLocked.value)) {
    photos.value = []; receipts.value = []; libraryLoading.value = false
    return
  }
  if (account.value) {
    if (!protectionReady.value || (protectionEnabled.value && !photoReadAllowed())) { photos.value=[];receipts.value=[];libraryLoading.value=false;return }
    const owner = account.value.id
    libraryLoading.value = true
    const [local, remote] = await Promise.allSettled([
      listPhotos(),
      protectionEnabled.value ? secureIndex() : photoIndex(),
    ])
    if (current !== generation || owner !== account.value?.id ||
        !appLockReady.value || appLocked.value) return
    receipts.value = remote.status === 'fulfilled' ? remote.value.receipts : []
    serverError.value = remote.status === 'rejected'
    const pending =
      !protectionEnabled.value && local.status === 'fulfilled'
        ? local.value.filter(
            (photo) =>
              photo.accountId === owner &&
              photo.uploadRequested &&
              !photo.deleteRequested &&
              localVisible(photo) &&
              !isExpired(photo),
          )
        : []
    const merged = new Map(pending.map((photo) => [photo.id, photo]))
    if (remote.status === 'fulfilled') {
      for (const photo of remote.value.photos) {
        const pendingPhoto = merged.get(photo.id)
        const expiresAt = photo.expiresAt === undefined ? pendingPhoto?.expiresAt : Math.min(pendingPhoto?.expiresAt ?? Infinity, photo.expiresAt)
        if (pendingPhoto && expiresAt !== undefined) {
          await (await import('./photos')).patchPhoto(photo.id, { expiresAt })
        }
        merged.set(photo.id, { ...(pendingPhoto?.metadataDirty ? pendingPhoto : photo), expiresAt })
      }
      for (const id of remote.value.deleted) {
        merged.delete(id)
        await deletePhoto(id).catch(() => {})
      }
    }
    if (current !== generation || owner !== account.value?.id ||
        !appLockReady.value || appLocked.value) return
    photos.value = [...merged.values()].sort(
      (a, b) => b.createdAt - a.createdAt,
    )
    libraryError.value =
      local.status === 'rejected' && remote.status === 'rejected'
    libraryLoading.value = false
    return
  }
  photos.value = []; receipts.value = []; libraryLoading.value = false;
  libraryError.value = false; serverError.value = false;
}

watch(
  [() => account.value?.id, appLockReady, appLocked],
  () => {
    generation++
    photos.value = []
    receipts.value = []
    if (appLockReady.value && !appLocked.value) void refreshLibrary()
  },
  { flush: 'sync' },
)

// Other tabs send only an invalidation hint, never photo bytes or metadata.
let channel: BroadcastChannel | undefined
export function startLibrary() {
  if (localPrototype && 'BroadcastChannel' in window) {
    channel = new BroadcastChannel('photobunker-local-prototype-changes')
    channel.onmessage = () => {
      void refreshLibrary()
    }
  }
  void refreshLibrary()
  window.addEventListener('photobunker-photo-security', refreshLibrary)
  window.addEventListener('focus', refreshLibrary)
  window.addEventListener('online', refreshLibrary)
  window.addEventListener('photobunker-delivery', refreshLibrary)
  return () => {
    channel?.close()
    channel = undefined
    window.removeEventListener('photobunker-photo-security', refreshLibrary)
    window.removeEventListener('focus', refreshLibrary)
    window.removeEventListener('online', refreshLibrary)
    window.removeEventListener('photobunker-delivery', refreshLibrary)
  }
}
export function libraryChanged() {
  channel?.postMessage('changed')
  void refreshLibrary()
}

// Preserve existing import sites while using one RU/EN-aware formatter.
export { formatBytes } from '../i18n'
