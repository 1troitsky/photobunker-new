import { account, hasConfirmedIdentity, offlineCaptureIdentity, sessionState } from '../identity/store'
import { appLockReady, appLocked } from '../app/lock'
import { protectionEnabled, photoReadAllowed } from '../crypto/store'
import { readLocalCardMetadata, remote as encryptedRemote, getMetadata as encryptedMetadata } from '../crypto/photos'
import { readMetadata } from '../local/photos'
import { localVisible } from '../collaboration/access'
import { pendingAccess, pendingGrant } from '../workspace/access'
import { isExpired } from '../delivery/clock'
import { photo as serverMetadata } from '../workspace/api'
import type { Photo } from '../local/photos'

export function privateCardScopeAllowed(): boolean {
  return !!account.value && appLockReady.value && !appLocked.value &&
    (hasConfirmedIdentity() ||
      (offlineCaptureIdentity.value &&
        (sessionState.value === 'offline' || sessionState.value === 'checking')))
}
/**
 * Local metadata first; remote metadata only if no authorized local photo
 * exists. No original, preview, thumbnail or blob URL requested.
 */
export async function readPrivateCardPhoto(id: string): Promise<Photo> {
  const owner = account.value?.id
  if (!owner || !privateCardScopeAllowed()) throw new Error('photo_card.locked')
  if (protectionEnabled.value) {
    if (!photoReadAllowed()) throw new Error('photo_card.locked')
    const cached = await readLocalCardMetadata(id)
    if (owner !== account.value?.id || !privateCardScopeAllowed()) throw new Error('photo_card.locked')
    // A published photo may have been revoked/deleted server-side.
    // Online, always re-check authenticated grants; only a local pending
    // capture or a genuinely offline trusted device may use this snapshot.
    if (cached && (cached.remoteRevision === undefined ||
        !navigator.onLine || !hasConfirmedIdentity())) return cached
  } else {
    // Non-E2EE local prototype: only this account's unsent photo, not a
    // stale copy of an already uploaded server object with revocable ACL.
    const local = await readMetadata(id).catch(() => undefined)
    if (owner !== account.value?.id || !privateCardScopeAllowed()) throw new Error('photo_card.locked')
    if (local?.accountId === owner && local.remoteRevision === undefined &&
        !local.uiVersionOf && !local.deleteRequested && !isExpired(local) &&
        localVisible(local) && pendingAccess(local)) {
      return { ...local, workspaceAccess: pendingGrant(local) }
    }
  }
  // Offline session is a local-data gate, NEVER a server authorization.
  if (!navigator.onLine) throw new Error('photo_card.offline')
  if (!hasConfirmedIdentity()) throw new Error('photo_card.offline')
  // Encrypted cloud photos are NOT Workspace Photo rows. Fetch only the
  // verified E2EE metadata envelope, never an original or preview blob.
  const remote = protectionEnabled.value
    ? await encryptedRemote(id).then(encryptedMetadata)
    : await serverMetadata(id)
  if (owner !== account.value?.id || !privateCardScopeAllowed())
    throw new Error('photo_card.locked')
  if (remote.deleteRequested || isExpired(remote)) throw new Error('photo_card.unavailable')
  if (remote.workspaceAccess && !remote.workspaceAccess.thumbnail)
    throw new Error('photo_card.denied')
  return remote
}
