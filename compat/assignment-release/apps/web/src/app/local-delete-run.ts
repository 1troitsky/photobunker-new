import { ref } from 'vue'
import { replayLocalDeletion } from './local-delete-phases'
import { invalidateLocalDeleteSession } from '../identity/store'
import { identityRequest, IdentityError } from '../identity/api'
import { lockApp } from './lock'
import { hardLock } from '../crypto/store'
import { stopMessaging } from '../messages/store'
import { listPhotos, deletePhoto } from '../local/photos'
import * as encryptedDb from '../crypto/database'
import { eraseDurableOutbox } from '../messages/durable-outbox'
import { eraseLocalDeleteFolders } from '../messages/private-folders'
import { eraseTeamCache } from '../workspace/team-local'
import { eraseBrowsersForAccount } from '../photo-browser/cache'
import { purgeNames } from '../local/photo-names'
import { purgeCardShareIntents } from '../crypto/card-share-outbox'
import { erasePresencePreferences } from '../profiles/presence'
import { clearScope } from '../studio/repository'
import { eraseAppPinForLocalDelete } from './pin-store'
import { updateVerifier, readJournal, mutateJournal, validJournal, type LocalDeleteJournal } from './local-delete-store'
import { freshLocalDeletePreflight, type DeleteScope, checkPreflightScope } from './local-delete-preflight'

export const deletionBlocked = ref(true)
export const deletionFailure = ref(false)
export const deletionPhase = ref('')
const channel = typeof BroadcastChannel === 'function'
  ? new BroadcastChannel('photobunker-local-delete-journal-v1') : undefined
const lockState = () => {
  deletionBlocked.value = true
  // Protect the UI and loaded keys synchronously even if IndexedDB fails.
  lockApp()
  hardLock()
  stopMessaging()
}
channel?.addEventListener('message', () => {
  lockState()
  // Every open tab joins the same journal replay. Web Locks serialize the
  // destructive phase and the losing tab observes either the next phase or
  // an already-finished journal, so it cannot remain unlocked or stuck.
  void resumeLocalDeletion()
})
function signedOutMarker() {
  // Distinguish a scoped D4 wipe from regular logout, whose legacy cleanup
  // wipes global credential stores (and therefore potentially account B).
  localStorage.setItem('pb-local-delete-signed-out', 'true')
  localStorage.setItem('pb-signed-out', 'true')
  if (localStorage.getItem('pb-signed-out') !== 'true' ||
    localStorage.getItem('pb-local-delete-signed-out') !== 'true')
    throw new Error('localDelete.storage')
}
async function stage(operationId: string, from: LocalDeleteJournal['phase'], to: LocalDeleteJournal['phase']) {
  await mutateJournal(row => {
    if (!row || row.operationId !== operationId || row.phase !== from)
      throw new Error('localDelete.journal_changed')
    return {...row, phase: to}
  })
  deletionPhase.value = to
}
async function purgeIDBKey(databaseName: string, storeName: string,
  predicate: (key: string, value: unknown) => boolean) {
  if (!indexedDB.databases) throw new Error('localDelete.storage')
  const known = await indexedDB.databases()
  if (!known.some(x => x.name === databaseName)) return
  const db = await new Promise<IDBDatabase>((resolve,reject) => {
    const req = indexedDB.open(databaseName)
    req.onerror = () => reject(new Error('localDelete.storage'))
    req.onblocked = () => reject(new Error('localDelete.storage'))
    req.onsuccess = () => resolve(req.result)
  })
  if (!db.objectStoreNames.contains(storeName)) { db.close(); throw new Error('localDelete.storage') }
  await new Promise<void>((resolve,reject) => {
    const tx = db.transaction(storeName,'readwrite',{durability:'strict'})
    const req=tx.objectStore(storeName).openCursor()
    req.onsuccess=()=>{const cur=req.result;if(cur){try{
      if(predicate(String(cur.primaryKey),cur.value)) cur.delete()
      cur.continue()
    }catch{tx.abort()}}}
    tx.oncomplete=()=>{db.close();resolve()}
    tx.onabort=()=>{db.close();reject(new Error('localDelete.storage'))}
  })
}
export async function eraseExactDeviceCredentials(s: DeleteScope) {
  if (!indexedDB.databases || !(await indexedDB.databases()).some(x=>x.name==='photobunker-identity-devices-v1'))
    throw new Error('localDelete.storage')
  const db = await new Promise<IDBDatabase>((resolve,reject)=>{
    const req=indexedDB.open('photobunker-identity-devices-v1',2)
    req.onsuccess=()=>resolve(req.result)
    req.onerror=()=>reject(new Error('localDelete.storage'))
  })
  await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(['devices','pending'],'readwrite',{durability:'strict'})
    tx.objectStore('devices').delete(s.device)
    const req=tx.objectStore('pending').openCursor()
    req.onsuccess=()=>{const c=req.result;if(c){if(c.value?.id===s.device)c.delete();c.continue()}}
    tx.oncomplete=()=>{db.close();resolve()}
    tx.onabort=()=>{db.close();reject(new Error('localDelete.storage'))}
  })
}
async function eraseMatrixScope(s: DeleteScope) {
  const prefix = 'photobunker-matrix-' + s.owner + ':' + s.device + ':'
  if (!indexedDB.databases) throw new Error('localDelete.storage')
  const names=(await indexedDB.databases()).map(db=>db.name).filter((n):n is string=>!!n&&n.startsWith(prefix))
  for (const name of names) {
    await new Promise<void>((resolve,reject)=>{
      const req=indexedDB.deleteDatabase(name)
      req.onsuccess=()=>resolve()
      req.onerror=()=>reject(new Error('localDelete.storage'))
      req.onblocked=()=>reject(new Error('localDelete.close_tabs'))
    })
  }
  await purgeIDBKey('photobunker-message-storage-v1','keys',key=>key.startsWith(s.owner+':'+s.device+':'))
}
async function clearScopedCaches(s: DeleteScope) {
  if (!('caches' in window)) return
  // Public PWA shell precache stays intact. Private caches must explicitly
  // identify the device; unscoped private cache means fail closed.
  for (const name of await caches.keys()) {
    if (name.startsWith('photobunker-shell-')) continue
    if (!/private|encrypted|photo|message/i.test(name.replace(/^photobunker-/,''))) continue
    const target = name.includes(s.owner + ':' + s.device)
    // A cache belonging to another explicit UUID/UUID scope is preserved.
    // An unscoped private cache cannot be attributed safely and blocks D4.
    const scoped = /[0-9a-f]{8}-[0-9a-f-]{27,}:[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(name)
    if (!target && !scoped) throw new Error('localDelete.storage')
    if (target && !await caches.delete(name))
      throw new Error('localDelete.storage')
  }
}
function rowMatchesScope(row: {database:string;store:string;key:IDBValidKey}, s: DeleteScope) {
  const key = String(row.key), pair = s.owner + ':' + s.device
  switch (row.database) {
    case 'photobunker-identity-devices-v1': return row.store === 'devices' && key === s.device
    case 'photobunker-app-pin-v2': return key === 'app-pin:' + pair
    case 'photobunker-local-delete-v1': return row.store === 'pins' && key === 'local-delete:' + pair
    case 'photobunker-encrypted-queue-v1': return key.split(':').includes(s.owner)
    case 'photobunker-ui-workspace-v1': return key.startsWith('account:' + s.owner + ':')
    case 'photobunker-message-storage-v1': return key.startsWith(pair + ':')
    case 'photobunker-message-outbox-v1':
      return key === 'key:' + pair || key.startsWith('msg:' + pair + ':')
    case 'photobunker-private-messenger-folders-v1':
      return key === 'key:' + pair || key === 'data:' + pair
    case 'photobunker-team-cache-v1': return key === 'team:' + pair
    case 'photobunker-private-presence-v1': return key === pair
    case 'photobunker-photo-browser-cache-v1': return key.startsWith('browser:' + pair + ':')
    case 'photobunker-photo-names-v1': return key === 'photo-names:' + pair
    case 'photobunker-card-share-intents-v1': return key.startsWith(pair + ':')
    case 'photobunker-emergency-v1': return key === pair
    default: return false
  }
}
/** Idempotent, explicit account/device scope; never call the broad
 * purgeAccountFromDevice() or forgetCredentials() from local deletion.
 */
export async function purgeLocalDeleteScope(s: DeleteScope) {
  await eraseDurableOutbox(s.owner,s.device)
  await eraseLocalDeleteFolders(s.owner,s.device)
  await eraseTeamCache(s.owner,s.device)
  await eraseBrowsersForAccount(s.owner,s.device)
  await purgeNames(s.owner,s.device)
  await purgeCardShareIntents(s.owner,s.device)
  await erasePresencePreferences(s.owner,s.device)
  // Account-level vault is safe only when preflight excluded a second device
  // for the same account from this browser profile.
  await clearScope('account:'+s.owner)
  for (const photo of await listPhotos()) if (photo.accountId===s.owner) await deletePhoto(photo.id)
  await purgeIDBKey('photobunker-encrypted-queue-v1','entries',
    key => key.split(':').includes(s.owner))
  // Historical single-device capture pointer has no scope in its KEY.
  // Inspect the value; never clear a pointer that belongs to account B.
  const capture = await encryptedDb.get<{accountId:string;deviceId:string}>('capture-current')
  if (capture && capture.accountId===s.owner && capture.deviceId===s.device)
    await encryptedDb.remove('capture-current')
  await eraseMatrixScope(s)
  await eraseExactDeviceCredentials(s)
  await eraseAppPinForLocalDelete(s.owner,s.device)
  await updateVerifier(s.owner,s.device,() => undefined)
  await (await import('./emergency-store')).changeEmergency(s.owner,s.device,()=>undefined)
  for(const key of Object.keys(localStorage))
    if(key.includes(s.owner) && !key.startsWith('pb-local-delete-'))
      localStorage.removeItem(key)
  if(localStorage.getItem('pb-active-device')===s.device)
    localStorage.removeItem('pb-active-device')
  await clearScopedCaches(s)
  // No success is possible until exact scoped storage reads confirm emptiness.
  const outstanding=(await listPhotos()).filter(p=>p.accountId===s.owner)
  if(outstanding.length) throw new Error('localDelete.storage')
  const remaining = (await (await import('./local-delete-preflight')).inventory())
    .filter(row => rowMatchesScope(row, s))
  if(remaining.length) throw new Error('localDelete.storage')
  // Do not clear the signed-out marker or any account B data.
  signedOutMarker()
}
async function sessionFor(s: DeleteScope) {
  if (!navigator.onLine) throw new Error('localDelete.offline')
  try {
    const who = await identityRequest<{account:{id:string};deviceId:string}>('/me')
    if (who.account.id !== s.owner || who.deviceId !== s.device)
      throw new Error('localDelete.scope')
    await identityRequest('/session','DELETE',undefined,s.owner)
  } catch(error) {
    if (error instanceof IdentityError && error.status===401) return
    throw error
  }
}
export async function runJournalWithSteps(initial: LocalDeleteJournal) {
  return replayLocalDeletion(initial,{
    lock:lockState,
    signedOut:(s)=>{
      signedOutMarker()
      invalidateLocalDeleteSession(s.owner,s.device)
    },
    purge:purgeLocalDeleteScope,
    serverLogout:sessionFor,
    advance:(from,to,operationId)=>stage(operationId,from,to),
    finish:async operationId => {
      await mutateJournal(current=>{
        if(!current || current.operationId!==operationId || current.phase!=='server-logout')
          throw new Error('localDelete.journal_changed')
        return undefined
      })
    },
  })
}

let running: Promise<boolean> | undefined
export function resumeLocalDeletion(): Promise<boolean> {
  if (running) return running
  running=(async()=>{
    deletionBlocked.value=true
    try {
      const journal=await readJournal()
      if(!journal){
        deletionBlocked.value=false
        deletionFailure.value=false
        return true
      }
      if(!validJournal(journal)) throw new Error('localDelete.storage')
      deletionPhase.value=journal.phase
      if(!navigator.locks?.request) throw new Error('localDelete.storage')
      await navigator.locks.request('photobunker-local-delete-run',async()=>{
        const current=await readJournal()
        if(!current) return
        if(!validJournal(current)) throw new Error('localDelete.storage')
        await runJournalWithSteps(current)
      })
      deletionBlocked.value=false
      deletionFailure.value=false
      return true
    }catch{
      deletionBlocked.value=true
      deletionFailure.value=true
      return false
    }finally{running=undefined}
  })()
  return running
}
/** Called from explicitly unlocked Security settings after a fresh preflight
 * and a second confirmation naming the exact account+device.
 */
export async function commitLocalDeletion(pin: string, expected: DeleteScope) {
  checkPreflightScope(expected)
  if(deletionBlocked.value || !navigator.locks?.request) throw new Error('localDelete.storage')
  return navigator.locks.request('photobunker-local-delete-commit',async()=>{
    // Fresh second preflight: the earlier UI readiness display is not a permit.
    const checked=await freshLocalDeletePreflight(pin)
    if(checked.scope.owner!==expected.owner || checked.scope.device!==expected.device)
      throw new Error('localDelete.scope')
    checkPreflightScope(expected)
    // The operation ID is chosen once, before the durable journal commit.
    const op:LocalDeleteJournal={
      operationId:crypto.randomUUID(),accountId:expected.owner,
      deviceId:expected.device,phase:'committed',startedAt:Date.now(),
    }
    await mutateJournal(current=>{
      if(current) throw new Error('localDelete.journal_changed')
      return op
    })
    lockState()
    channel?.postMessage('committed')
    return resumeLocalDeletion()
  })
}
