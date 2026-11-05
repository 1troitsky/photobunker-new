import { protectionEnabled, protectionReady, photoReadAllowed, strongUnlocked, warmLocked } from '../crypto/store'
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
import {
  purgeExpiredPhotoCache,
  readCachedPhotoIndex,
  removeCachedPhoto,
  rememberPhotoIndex,
} from '../crypto/photo-cache'

export const photos = shallowRef<Photo[]>([])
export const libraryError = shallowRef(false)
export const libraryLoading = shallowRef(false)
export const serverError = shallowRef(false)
export const usedBytes = computed(() =>
  photos.value.reduce((sum, photo) => sum + photo.bytes, 0),
)
let generation = 0
let activeRefresh: { generation: number; promise: Promise<void> } | undefined
let refreshTimer: number | undefined

function scheduleRefresh() {
  if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
  refreshTimer = window.setTimeout(() => {
    refreshTimer = undefined
    void refreshLibrary()
  }, 180)
}

async function performRefresh(current: number) {
  if (account.value && (!appLockReady.value || appLocked.value)) {
    photos.value = []; receipts.value = []; libraryLoading.value = false
    return
  }
  if (account.value) {
    const owner = account.value.id
    let cached = photos.value.filter(photo => photo.accountId === owner)
    if (!cached.length) {
      cached = await readCachedPhotoIndex().catch(() => [])
      if (current !== generation || owner !== account.value?.id ||
          !appLockReady.value || appLocked.value) return
      if (cached.length) {
        photos.value = cached
        libraryLoading.value = false
      }
    }
    // The encrypted device cache is the local-first source of truth for the
    // Browser shell. Server key/read reconciliation continues independently;
    // without a cached index the skeleton remains until that gate is ready.
    if (!protectionReady.value || (protectionEnabled.value && !photoReadAllowed())) {
      receipts.value = []
      libraryLoading.value = !cached.length
      return
    }
    // The first ever load gets a wrapper; all later loads keep the encrypted
    // local index visible while the server is reconciled in background.
    libraryLoading.value = !cached.length
    const [local, remote] = await Promise.allSettled([
      localPrototype ? listPhotos() : Promise.resolve<Photo[]>([]),
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
    const merged = new Map(
      (remote.status === 'fulfilled' ? pending : [...cached, ...pending])
        .map((photo) => [photo.id, photo]),
    )
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
        await removeCachedPhoto(id).catch(() => {})
      }
    }
    if (current !== generation || owner !== account.value?.id ||
        !appLockReady.value || appLocked.value) return
    photos.value = [...merged.values()].sort(
      (a, b) => b.createdAt - a.createdAt,
    )
    // Persist every non-empty verified in-memory projection, including local
    // encrypted capture jobs. Navigation may abort the concurrent remote
    // reconciliation; that must not leave a trusted device without its
    // durable Browser index. Only an authoritative successful empty response
    // may replace the cache with an empty list.
    if (protectionEnabled.value && (photos.value.length > 0 || remote.status === 'fulfilled'))
      void rememberPhotoIndex(photos.value).catch(() => {})
    libraryError.value = remote.status === 'rejected' && !photos.value.length &&
      (localPrototype ? local.status === 'rejected' : true)
    libraryLoading.value = false
    return
  }
  photos.value = []; receipts.value = []; libraryLoading.value = false;
  libraryError.value = false; serverError.value = false;
}

export function refreshLibrary(): Promise<void> {
  if (activeRefresh) {
    if (activeRefresh.generation === generation) return activeRefresh.promise
    return activeRefresh.promise.catch(() => {}).then(() => refreshLibrary())
  }
  const current = ++generation
  const promise = performRefresh(current).finally(() => {
    if (activeRefresh?.promise === promise) activeRefresh = undefined
  })
  activeRefresh = { generation: current, promise }
  return promise
}

function invalidateLibrary() {
  generation++
  void refreshLibrary()
}

watch(
  [() => account.value?.id, appLockReady, appLocked, protectionReady,
    protectionEnabled, strongUnlocked, warmLocked],
  () => {
    generation++
    if (!account.value || !appLockReady.value || appLocked.value) {
      photos.value = []
      receipts.value = []
      libraryLoading.value = false
    }
    if (appLockReady.value && !appLocked.value &&
        (!account.value || protectionReady.value)) scheduleRefresh()
  },
  { flush: 'sync' },
)

// Other tabs send only an invalidation hint, never photo bytes or metadata.
let channel: BroadcastChannel | undefined
export function startLibrary() {
  if (localPrototype && 'BroadcastChannel' in window) {
    channel = new BroadcastChannel('photobunker-local-prototype-changes')
    channel.onmessage = invalidateLibrary
  }
  void purgeExpiredPhotoCache().catch(() => {})
  void refreshLibrary()
  window.addEventListener('photobunker-photo-security', invalidateLibrary)
  window.addEventListener('focus', invalidateLibrary)
  window.addEventListener('online', invalidateLibrary)
  window.addEventListener('photobunker-delivery', invalidateLibrary)
  return () => {
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
    refreshTimer = undefined
    channel?.close()
    channel = undefined
    window.removeEventListener('photobunker-photo-security', invalidateLibrary)
    window.removeEventListener('focus', invalidateLibrary)
    window.removeEventListener('online', invalidateLibrary)
    window.removeEventListener('photobunker-delivery', invalidateLibrary)
  }
}
export function libraryChanged() {
  channel?.postMessage('changed')
  invalidateLibrary()
}

/** Capture is already durably encrypted before this projection is called.
 * Publish it to the Browser immediately and persist the encrypted metadata
 * index without waiting for a server list request that navigation may abort. */
export async function cacheCapturedPhoto(photo: Photo): Promise<void> {
  if (!account.value || photo.accountId !== account.value.id ||
      photo.deleteRequested ||
      (photo.expiresAt !== undefined && photo.expiresAt <= Date.now())) return
  photos.value = [photo, ...photos.value.filter(item => item.id !== photo.id)]
    .sort((a, b) => b.createdAt - a.createdAt)
  libraryLoading.value = false
  if (protectionEnabled.value) await rememberPhotoIndex(photos.value)
}

// Preserve existing import sites while using one RU/EN-aware formatter.
export { formatBytes } from '../i18n'
