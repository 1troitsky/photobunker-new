import type { CryptoApi } from 'matrix-js-sdk/lib/crypto-api'
import { parseKit } from './keys'
import { b64, unb64, canonical, statementBytes, utf8, uuid, ready } from '../crypto/protocol'
export type MatrixSecrets = Awaited<ReturnType<NonNullable<CryptoApi['exportSecretsBundle']>>>
export type RoomKeys = Awaited<ReturnType<CryptoApi['exportRoomKeys']>>
export type AccountSecrets = { version: 1; roomKeys?: RoomKeys; photoKey?: string; messageKey?: string; matrixSecrets?: MatrixSecrets }
export type RecoveryEnvelope = {
  statement: { version: 1; accountId: string; revision: number; rootKey: string; iv: string; ciphertext: string }
  signature: string
}
const info = utf8.encode('photobunker/account-recovery/v1')
function descriptor(statement: RecoveryEnvelope['statement']) {
  return { version: statement.version, accountId: statement.accountId, revision: statement.revision, rootKey: statement.rootKey }
}
async function wrappingKey(kit: string, accountId: string) {
  const raw = unb64(kit.trim().split('.')[2]!)
  try {
    const material = await crypto.subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, 'HKDF', false, ['deriveKey'])
    return await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: utf8.encode(accountId), info }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  } finally { raw.fill(0) }
}
export function validateSecrets(value: AccountSecrets): void {
  if (!value || value.version !== 1 || Object.keys(value).some(k => !['version', 'photoKey', 'messageKey', 'matrixSecrets', 'roomKeys'].includes(k))) throw new Error('recovery.invalid')
  if (value.roomKeys !== undefined && (!Array.isArray(value.roomKeys) || value.roomKeys.length > 256)) throw new Error('recovery.invalid')
  if (value.photoKey !== undefined && (typeof value.photoKey !== 'string' || !value.photoKey.startsWith('PB4.') || value.photoKey.length > 1000)) throw new Error('recovery.invalid')
  if (value.messageKey !== undefined && (typeof value.messageKey !== 'string' || value.messageKey.length > 1000)) throw new Error('recovery.invalid')
  if (value.matrixSecrets !== undefined && (!value.matrixSecrets.cross_signing || ['master_key', 'self_signing_key', 'user_signing_key'].some(k => typeof value.matrixSecrets!.cross_signing[k as keyof MatrixSecrets['cross_signing']] !== 'string'))) throw new Error('recovery.invalid')
  if (canonical(value).length > 100000) throw new Error('recovery.invalid')
}
export async function sealRecovery(kit: string, accountId: string, revision: number, secrets: AccountSecrets): Promise<RecoveryEnvelope> {
  await ready()
  if (!uuid(accountId) || !Number.isSafeInteger(revision) || revision < 1 || revision > 1000000) throw new Error('recovery.invalid')
  validateSecrets(secrets)
  const root = await parseKit(kit), iv = crypto.getRandomValues(new Uint8Array(12))
  const base = { version: 1 as const, accountId, revision, rootKey: root.publicKey }
  const clear = utf8.encode(canonical(secrets))
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(canonical(base)) }, await wrappingKey(kit, accountId), clear)
    const statement = { ...base, iv: b64(iv), ciphertext: b64(new Uint8Array(ciphertext)) }
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, root.privateKey, statementBytes('account-recovery', statement) as Uint8Array<ArrayBuffer>)
    return { statement, signature: b64(new Uint8Array(signature)) }
  } finally { clear.fill(0) }
}
export async function openRecovery(kit: string, accountId: string, envelope: RecoveryEnvelope): Promise<AccountSecrets> {
  await ready()
  const root = await parseKit(kit), s = envelope?.statement
  if (!s || s.version !== 1 || s.accountId !== accountId || s.rootKey !== root.publicKey || !Number.isSafeInteger(s.revision) || s.revision < 1 || s.revision > 1000000 || typeof s.ciphertext !== 'string' || s.ciphertext.length > 180000 || Object.keys(s).sort().join() !== 'accountId,ciphertext,iv,revision,rootKey,version') throw new Error('recovery.invalid')
  const publicKey = await crypto.subtle.importKey('spki', unb64(root.publicKey) as Uint8Array<ArrayBuffer>, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  if (!(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, unb64(envelope.signature) as Uint8Array<ArrayBuffer>, statementBytes('account-recovery', s) as Uint8Array<ArrayBuffer>))) throw new Error('recovery.invalid')
  const iv = unb64(s.iv)
  if (iv.length !== 12) throw new Error('recovery.invalid')
  const clear = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer>, additionalData: utf8.encode(canonical(descriptor(s))) }, await wrappingKey(kit, accountId), unb64(s.ciphertext) as Uint8Array<ArrayBuffer>))
  try { const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(clear)) as AccountSecrets; validateSecrets(value); return value }
  finally { clear.fill(0) }
}
