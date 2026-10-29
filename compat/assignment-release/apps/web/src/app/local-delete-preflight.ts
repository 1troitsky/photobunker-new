import { account, deviceId, hasConfirmedIdentity } from '../identity/store'
import { identityRequest } from '../identity/api'
import { appLockReady, appLocked } from './lock'
import { localDeletePinFailure, localDeletePinReady, verifyLocalDeletePin } from './local-delete-pin'
import { readVerifier } from './local-delete-store'
import { listPhotos } from '../local/photos'
import { credentials, unb64 } from '../identity/keys'
import * as encryptedDb from '../crypto/database'
import type { Job } from '../crypto/photos'
import * as versionCloud from '../crypto/version-cloud'
import { delivery } from '../delivery/queue'
import { pendingCount, queueBusy, queueError } from '../workspace/state'
import { readDurableText } from '../messages/durable-outbox'
import { readTeamCache } from '../workspace/team-local'
import { assertMatrixRecoveryForLocalDelete } from '../messages/store'
import { protectionEnabled, protectionReady, photoReadAllowed, keyState } from '../crypto/store'
import { request as secureRequest } from '../crypto/api'
import { photoIndex } from '../workspace/api'
import { remote as secureRemote } from '../crypto/photos'
import { readBrowser } from '../photo-browser/cache'

export type DeleteScope = { owner: string; device: string }
export type PreflightError = 'offline' | 'scope' | 'pin' | 'storage' |
  'unsynced' | 'recovery' | 'cloud'
export class PreflightDenied extends Error {
  constructor(public category: PreflightError) { super('localDelete.' + category) }
}
export function currentScope(): DeleteScope {
  if (!account.value?.id || !deviceId.value) throw new PreflightDenied('scope')
  return { owner: account.value.id, device: deviceId.value }
}
export function sameScope(s: DeleteScope) {
  return account.value?.id === s.owner && deviceId.value === s.device &&
    appLockReady.value && !appLocked.value && hasConfirmedIdentity()
}
export function checkPreflightScope(s: DeleteScope) {
  if (!sameScope(s)) throw new PreflightDenied('scope')
  if (!navigator.onLine) throw new PreflightDenied('offline')
}
const DATABASES = new Set([
  'photobunker-identity-devices-v1', 'photobunker-app-pin-v2',
  'photobunker-local-delete-v1', 'photobunker-local-prototype-v1',
  'photobunker-encrypted-queue-v1', 'photobunker-ui-workspace-v1',
  'photobunker-message-storage-v1', 'photobunker-message-outbox-v1',
  'photobunker-private-messenger-folders-v1',
  'photobunker-team-cache-v1', 'photobunker-private-presence-v1',
  'photobunker-photo-browser-cache-v1', 'photobunker-photo-names-v1',
  'photobunker-card-share-intents-v1',
  'photobunker-emergency-v1', 'photobunker-emergency-outbox-v1',
])
type KeyRow = { database: string; store: string; key: IDBValidKey }
/** A read-only full store inventory; unknown storage is never assumed empty. */
export async function inventory(): Promise<KeyRow[]> {
  if (!indexedDB.databases) throw new PreflightDenied('storage')
  const names = (await indexedDB.databases()).map(x => x.name).filter((x):x is string => !!x)
  // Matrix Rust crypto uses per account+device+Matrix-device database names.
  // Treat the known format as a scoped store, not an unknown database. Other
  // account/device Matrix databases are preserved during this device wipe.
  const matrixName = /^photobunker-matrix-[0-9a-f-]{36}:[0-9a-f-]{36}:/i
  if (names.some(name => name.startsWith('photobunker-') &&
    !DATABASES.has(name) && !matrixName.test(name)))
    throw new PreflightDenied('storage')
  const items: KeyRow[] = []
  for (const name of names.filter(x => DATABASES.has(x))) {
    const db = await new Promise<IDBDatabase>((resolve,reject) => {
      const req = indexedDB.open(name)
      req.onerror = () => reject(new PreflightDenied('storage'))
      req.onblocked = () => reject(new PreflightDenied('storage'))
      req.onsuccess = () => resolve(req.result)
    })
    try {
      for (const storeName of Array.from(db.objectStoreNames)) {
        await new Promise<void>((resolve,reject) => {
          const tx=db.transaction(storeName,'readonly')
          const req=tx.objectStore(storeName).openKeyCursor()
          req.onsuccess=()=>{const cursor=req.result; if(cursor){items.push({database:name,store:storeName,key:cursor.primaryKey});cursor.continue()}}
          tx.oncomplete=()=>resolve()
          tx.onabort=()=>reject(new PreflightDenied('storage'))
        })
      }
    } finally { db.close() }
  }
  return items
}
function isPendingRow(row: KeyRow, s: DeleteScope) {
  const k = String(row.key)
  if (row.database === 'photobunker-message-outbox-v1')
    return k.startsWith('msg:' + s.owner + ':' + s.device + ':')
  if (row.database === 'photobunker-encrypted-queue-v1')
    return k.startsWith('account-recovery-pending:' + s.owner)
  // Without an adapter proving cloud acknowledgement, local Workspace drafts
  // must be treated as unbacked-up, not as a cloud copy.
  if (row.database === 'photobunker-ui-workspace-v1')
    return k.startsWith('account:' + s.owner + ':')
  return false
}
function inventorySignature(rows: KeyRow[]) {
  return rows.map(row => `${row.database}\u0000${row.store}\u0000${String(row.key)}`).sort()
}
export async function freshLocalDeletePreflight(pin: string): Promise<{scope: DeleteScope; inventory: KeyRow[]}> {
  const scope = currentScope()
  checkPreflightScope(scope)
  if (!localDeletePinReady.value || localDeletePinFailure.value) throw new PreflightDenied('storage')
  if (delivery.value.busy || delivery.value.pending || delivery.value.deleting ||
    delivery.value.failed || delivery.value.storageFailed ||
    queueBusy.value || pendingCount.value || queueError.value)
    throw new PreflightDenied('unsynced')
  await verifyLocalDeletePin(pin)
  checkPreflightScope(scope)
  const verifier = await readVerifier(scope.owner, scope.device)
  if (!verifier || verifier.version !== 1 || !/^[a-f0-9]{64}$/.test(verifier.recoveryFingerprint))
    throw new PreflightDenied('recovery')
  // Server /me is fresh; an old in-memory session or visible Vue count is not a proof.
  const me = await identityRequest<{account:{id:string;rootKey?:string};deviceId:string}>('/me')
  checkPreflightScope(scope)
  if (me.account.id !== scope.owner || me.deviceId !== scope.device ||
    me.account.rootKey !== account.value?.rootKey) throw new PreflightDenied('scope')
  // Compare the saved non-secret PB1 fingerprint to this fresh server root.
  // A matching app accountId is insufficient after root-key rotation.
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
    unb64(me.account.rootKey ?? ''))),
    byte => byte.toString(16).padStart(2,'0')).join('')
  if (fingerprint !== verifier.recoveryFingerprint) throw new PreflightDenied('recovery')
  const knownDevices = await credentials()
  // The account vault uses an account-wide key on the current browser profile;
  // never wipe it when another local device for the same account is enrolled.
  if (knownDevices.some(d => d.id !== scope.device && d.publicId === account.value?.publicId))
    throw new PreflightDenied('scope')
  const rows = await inventory()
  checkPreflightScope(scope)
  const allPhotos = await listPhotos()
  const storedPhotoIds = new Set(allPhotos.map(photo => photo.id))
  const localRows = rows.filter(row => row.database === 'photobunker-local-prototype-v1')
  // Blob stores have no account field of their own. An orphan cannot be
  // attributed safely to A or B, so destructive cleanup must stop.
  if (allPhotos.some(photo => !photo.accountId) || localRows.some(row =>
    row.store !== 'photos' && !storedPhotoIds.has(String(row.key))))
    throw new PreflightDenied('storage')
  if ('caches' in window) {
    const knownCaches = await caches.keys()
    if (knownCaches.some(name => /private|encrypted|photo|message/i.test(name) &&
      !name.includes(scope.owner+':'+scope.device) &&
      !/[0-9a-f]{8}-[0-9a-f-]{27,}:[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(name)))
      throw new PreflightDenied('storage')
  }
  if (rows.some(row => isPendingRow(row, scope))) throw new PreflightDenied('unsynced')
  // Private folders are intentionally device-only and cannot be recovered
  // from PB1. Never silently describe them as safely cloud-backed.
  if (rows.some(row => row.database==='photobunker-private-messenger-folders-v1' &&
    String(row.key)==='data:'+scope.owner+':'+scope.device))
    throw new PreflightDenied('cloud')
  await (await import('../local/photo-names'))
    .assertPhotoNamesSafeForLocalDelete(scope.owner,scope.device)
  if ((await readDurableText()).length) throw new PreflightDenied('unsynced')
  const team = await readTeamCache(scope.owner + ':' + scope.device)
  if (team.pending.length) throw new PreflightDenied('unsynced')
  const browserKeys = rows.filter(x =>
    x.database === 'photobunker-photo-browser-cache-v1' &&
    String(x.key).startsWith('browser:' + scope.owner + ':' + scope.device + ':'))
  for (const row of browserKeys) {
    const snapshot = await readBrowser(scope.owner, scope.device, String(row.key).split(':').at(-1)!, false)
    if (!snapshot || snapshot.pending) throw new PreflightDenied('unsynced')
  }
  // Any unsynchronized share intent is vetoed. Existing access grants remain
  // server-side and are NOT revoked by local deletion.
  const { assertCardShareQueueEmptyForDelete } = await import('../crypto/card-share-outbox')
  await assertCardShareQueueEmptyForDelete(scope.owner,scope.device)
  const { assertPresenceQueueEmptyForDelete } = await import('../profiles/presence')
  await assertPresenceQueueEmptyForDelete(scope.owner,scope.device)
  checkPreflightScope(scope)
  const jobs = await encryptedDb.entries<Job>('job:' + scope.owner + ':')
  for (const row of jobs) {
    const job = row.value
    if (job.accountId !== scope.owner || !job.received || job.deleted ||
      job.expiresAt <= Date.now() || job.draft || job.gps || job.edit || job.cardGps ||
      job.cardMetadata || job.needsName)
      throw new PreflightDenied('unsynced')
    const remote=await secureRemote(job.id)
    if (remote.expiresAt<=Date.now() || remote.revision<job.revision ||
      !remote.objects.original) throw new PreflightDenied('cloud')
    checkPreflightScope(scope)
  }
  const storedVersions = await encryptedDb.entries<{
    id:string;parentId:string;expiresAt:number;synced?:boolean;conflict?:boolean;upload?:unknown
  }>('version:'+scope.owner+':')
  for (const row of storedVersions) {
    const v = row.value
    if (!v.synced || v.conflict || v.upload || v.expiresAt<=Date.now())
      throw new PreflightDenied('unsynced')
    const remoteParent=await secureRemote(v.parentId)
    const corresponding={id:v.parentId,accountId:scope.owner,encrypted:true,
      expiresAt:remoteParent.expiresAt} as import('../local/photos').Photo
    const verified = await versionCloud.fetchVersions(corresponding)
    if (!verified.some(remote=>remote.id===v.id && remote.parentId===v.parentId &&
      remote.sync!=='pending' && remote.expiresAt!==undefined && remote.expiresAt>Date.now()))
      throw new PreflightDenied('cloud')
    checkPreflightScope(scope)
  }
  const photos = allPhotos.filter(photo => photo.accountId === scope.owner)
  if (photos.some(p => p.uiOnly || p.uploadRequested || p.metadataDirty || p.deleteRequested ||
    p.uploadError || p.remoteRevision === undefined || p.deliveryOnly || p.uploadOnly))
    throw new PreflightDenied('unsynced')
  const existing = photos.some(p => !p.encrypted) ? await photoIndex() : undefined
  checkPreflightScope(scope)
  const remoteIds = new Map(existing?.photos.map(p => [p.id,p]) ?? [])
  for (const p of photos) {
    if(p.encrypted) {
      const remote=await secureRemote(p.id)
      if(remote.expiresAt<=Date.now() || remote.revision<p.remoteRevision! ||
        !remote.objects.original) throw new PreflightDenied('cloud')
    } else {
      const remote=remoteIds.get(p.id)
      if(!remote || remote.expiresAt===undefined || remote.expiresAt<=Date.now() ||
        (remote.remoteRevision ?? -1)<p.remoteRevision!)
        throw new PreflightDenied('cloud')
    }
    checkPreflightScope(scope)
  }
  // Require an authenticated photo recovery bundle; not just a local cached key.
  if (!protectionReady.value || !protectionEnabled.value || !photoReadAllowed() ||
    !keyState.value.document || !keyState.value.bundle)
    throw new PreflightDenied('recovery')
  const remoteKeys = await secureRequest<{enabled:boolean;document?:unknown;bundle?:unknown}>('/keys')
  if (!remoteKeys.enabled || !remoteKeys.document || !remoteKeys.bundle)
    throw new PreflightDenied('recovery')
  await assertMatrixRecoveryForLocalDelete(scope.owner,scope.device)
  checkPreflightScope(scope)
  // A second inventory is required so work arriving during the remote checks
  // cannot silently become an undetected queue entry.
  const again = await inventory()
  if (again.some(row => isPendingRow(row,scope)) ||
    JSON.stringify(inventorySignature(rows)) !== JSON.stringify(inventorySignature(again)))
    throw new PreflightDenied('unsynced')
  checkPreflightScope(scope)
  return {scope, inventory:again}
}
