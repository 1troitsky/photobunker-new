import { account, logout } from './store'
import { identityRequest } from './api'
import * as encrypted from '../crypto/database'
import { clearScope } from '../studio/repository'
import { deletePhoto, listPhotos } from '../local/photos'
import { libraryChanged } from '../local/library'
import { ref } from 'vue'

export const pendingDeviceCleanup = ref(localStorage.getItem('pb-deleted-account-cleanup'))
export const accountDeletionNotice = ref(localStorage.getItem('pb-account-deletion-notice') === 'true')

export type StorageSummary = { inactivityDays: number; lastActiveAt: number; deletesAt: number | null; ownedPhotos: number; encryptedBytes: number }
export const storageSummary = () => identityRequest<StorageSummary>('/storage')
export const saveInactivity = (inactivityDays: number) => identityRequest<Pick<StorageSummary, 'inactivityDays' | 'lastActiveAt' | 'deletesAt'>>('/storage', 'PATCH', { inactivityDays })

export async function purgeAccountFromDevice(owner: string) {
  await (await import('../messages/durable-outbox')).eraseDurableOutbox(owner)
  await (await import('../workspace/team-local')).eraseTeamCache(owner)
  await (await import('../photo-browser/cache')).eraseBrowsersForAccount(owner)
  await (await import('../app/pin-store')).purgeAccountPins(owner)
  await (await import('../local/photo-names')).purgeNames(owner)
  await (await import('../crypto/card-share-outbox')).purgeCardShareIntents(owner)
  await (await import('../profiles/presence')).erasePresencePreferences(owner)
  for (const entry of await encrypted.entries<unknown>(''))
    if (entry.key.split(':').includes(owner)) await encrypted.remove(entry.key)
  await clearScope(`account:${owner}`)
  for (const photo of await listPhotos()) if (photo.accountId === owner) await deletePhoto(photo.id)
  for (const key of Object.keys(localStorage)) if (key.includes(owner)) localStorage.removeItem(key)
  if (indexedDB.databases) {
    const databases = await indexedDB.databases()
    for (const db of databases) {
      if (!db.name?.startsWith(`photobunker-matrix-${owner}:`)) continue
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(db.name!)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(new Error('storage.cleanup_failed'))
        request.onblocked = () => reject(new Error('storage.close_other_tabs'))
      })
    }
  }
  libraryChanged()
  if (localStorage.getItem('pb-deleted-account-cleanup') === owner) {
    localStorage.removeItem('pb-deleted-account-cleanup')
    pendingDeviceCleanup.value = null
  }
}

export async function deleteAccountData() {
  const owner = account.value?.id
  if (!owner) throw new Error('identity.account_required')
  await identityRequest('/account', 'DELETE', { accountId: owner, confirmation: 'DELETE' })
  localStorage.setItem('pb-account-deletion-notice', 'true')
  accountDeletionNotice.value = true
  // Store a retry marker before signing out so a blocked IDB deletion can be
  // completed on the next launch; no recovery material is kept in this marker.
  localStorage.setItem('pb-deleted-account-cleanup', owner)
  pendingDeviceCleanup.value = owner
  await logout().catch(() => {}) // The server already revoked this session.
  await purgeAccountFromDevice(owner)
  localStorage.removeItem('pb-deleted-account-cleanup')
}
