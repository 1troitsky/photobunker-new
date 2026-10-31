import { account, deviceId } from './store'
import { appLocked } from '../app/lock'
import { identityRequest, IdentityError } from './api'
import * as db from '../crypto/database'
import { openRecovery, sealRecovery, type AccountSecrets, type RecoveryEnvelope, type RoomKeys } from './vault-crypto'
import { parseKit } from './keys'
import { canonical } from '../crypto/protocol'
const localScope = () => `account-key:${account.value?.id}:${deviceId.value}`
type Wrapped = { key: CryptoKey; iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer }
function assertScope(scope: string) {
  if (scope !== localScope() || !account.value || localStorage.getItem('pb-signed-out') === 'true') throw new Error('recovery.cancelled')
}
export async function rememberAccountKey(value: string) {
  const kit = value.trim(), scope = localScope()
  const root = await parseKit(kit)
  if (!account.value?.rootKey || account.value.rootKey !== root.publicKey) throw new Error('recovery.wrong_account')
  const check = crypto.getRandomValues(new Uint8Array(32))
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, root.privateKey, check)
  const publicKey = await crypto.subtle.importKey('spki', (await import('./keys')).unb64(root.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  if (!(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, check))) throw new Error('recovery.wrong_account')
  assertScope(scope)
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']), iv = crypto.getRandomValues(new Uint8Array(12))
  const clear = new TextEncoder().encode(kit)
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(scope) }, key, clear)
    assertScope(scope)
    await db.put(scope, { key, iv, ciphertext } satisfies Wrapped)
    if (scope !== localScope()) { await db.remove(scope); throw new Error('recovery.cancelled') }
  } finally { clear.fill(0) }
}
// Imported legacy photo material is staged durably, without blocking login on
// a photo API request. Only this account/device can decrypt the staging row.
const photoImportScope = () => `account-photo-import:${localScope()}`
export async function stageImportedPhotoKey(value: string) {
  const ownerScope = localScope(), scope = photoImportScope()
  assertScope(ownerScope)
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const bytes = new TextEncoder().encode(value)
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(scope) }, key, bytes)
    assertScope(ownerScope)
    await db.put(scope, { key, iv, ciphertext } satisfies Wrapped)
    if (scope !== photoImportScope()) { await db.remove(scope); throw new Error('recovery.cancelled') }
  } finally { bytes.fill(0) }
}
export async function pendingImportedPhotoKey(): Promise<string | undefined> {
  const ownerScope = localScope(), scope = photoImportScope()
  const row = await db.get<Wrapped>(scope)
  assertScope(ownerScope)
  if (!row || row.key.extractable) return
  const clear = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv, additionalData: new TextEncoder().encode(scope) }, row.key, row.ciphertext))
  try { assertScope(ownerScope); return new TextDecoder().decode(clear) }
  finally { clear.fill(0) }
}
export async function clearImportedPhotoKey() {
  const scope = photoImportScope()
  assertScope(localScope())
  await db.remove(scope)
}
export async function accountKey(): Promise<string | undefined> {
  if (!account.value || appLocked.value || localStorage.getItem('pb-signed-out') === 'true') return
  const scope = localScope(), row = await db.get<Wrapped>(scope)
  assertScope(scope)
  if (!row || row.key.extractable) return
  const clear = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv, additionalData: new TextEncoder().encode(scope) }, row.key, row.ciphertext))
  try { assertScope(scope); return new TextDecoder().decode(clear) }
  finally { clear.fill(0) }
}
async function load(kit: string, owner: string, scope: string) {
  let envelope: RecoveryEnvelope | null
  try { envelope = (await identityRequest<{ envelope: RecoveryEnvelope | null }>('/recovery')).envelope }
  catch (error) {
    if (error instanceof IdentityError && [401, 403, 409].includes(error.status)) throw error
    const cached = await db.get<RecoveryEnvelope>(`account-recovery-envelope:${owner}`)
    if (!cached) throw error
    envelope = cached
  }
  assertScope(scope)
  const seen = await db.get<number>(`account-recovery-revision:${owner}`) ?? 0
  if ((!envelope && seen) || (envelope && envelope.statement.revision < seen)) throw new Error('recovery.rollback')
  let secrets = envelope ? await openRecovery(kit, owner, envelope) : { version: 1 as const }
  const published = secrets
  const pending = await db.get<RecoveryEnvelope>(`account-recovery-pending:${owner}`)
  if (pending) {
    const local = await openRecovery(kit, owner, pending)
    const roomKeys = [...new Map([...(local.roomKeys ?? []), ...(secrets.roomKeys ?? [])].map(key => [key.room_id + ':' + key.session_id, key])).values()]
    secrets = { ...local, ...secrets, ...(roomKeys.length ? { roomKeys } : {}) }
  }
  assertScope(scope)
  if (envelope) {
    await db.put(`account-recovery-revision:${owner}`, envelope.statement.revision)
    await db.put(`account-recovery-envelope:${owner}`, envelope)
  }
  return { envelope, secrets, published }
}
export async function readAccountSecrets(): Promise<AccountSecrets | undefined> {
  const scope = localScope(), owner = account.value?.id, kit = await accountKey()
  if (!owner || !kit) return
  return (await load(kit, owner, scope)).secrets
}
export async function saveAccountSecrets(patch: Omit<Partial<AccountSecrets>, 'version'>) {
  const scope = localScope(), owner = account.value?.id, kit = await accountKey()
  if (!owner || !kit) throw new Error('recovery.key_required')
  const action = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      assertScope(scope)
      const { envelope, secrets, published } = await load(kit, owner, scope)
      const merged = { ...secrets, ...patch, version: 1 as const }
      if (canonical(published) === canonical(merged)) {
        await db.remove(`account-recovery-pending:${owner}`)
        return
      }
      const next = await sealRecovery(kit, owner, (envelope?.statement.revision ?? 0) + 1, merged)
      assertScope(scope)
      await db.put(`account-recovery-pending:${owner}`, next)
      try {
        await identityRequest('/recovery', 'PUT', { envelope: canonical(next) })
      } catch (error) {
        if (error instanceof IdentityError && error.status === 409) continue
        throw error
      }
      assertScope(scope)
      await db.put(`account-recovery-revision:${owner}`, next.statement.revision)
      await db.put(`account-recovery-envelope:${owner}`, next)
      await db.remove(`account-recovery-pending:${owner}`)
      return
    }
    throw new Error('recovery.conflict')
  }
  if (!navigator.locks) throw new Error('recovery.storage_unavailable')
  await navigator.locks.request(`photobunker-account-recovery:${owner}`, action)
}

export async function roomKeysSavedLocally(keys: RoomKeys): Promise<boolean> {
  const scope = localScope(), owner = account.value?.id, kit = await accountKey()
  if (!owner || !kit) return false
  const envelope = await db.get<RecoveryEnvelope>(`account-recovery-pending:${owner}`)
  if (!envelope) return false
  const saved = await openRecovery(kit, owner, envelope)
  assertScope(scope)
  return keys.every(key => saved.roomKeys?.some(copy => copy.room_id === key.room_id && copy.session_id === key.session_id && copy.session_key === key.session_key))
}
