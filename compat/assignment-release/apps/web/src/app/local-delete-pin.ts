import { ref } from 'vue'
import { account, deviceId, hasConfirmedIdentity } from '../identity/store'
import { appLockReady, appLocked, appPinEnabled,
  confirmAppPinForLocalDelete, matchesAppPinForLocalDelete } from './lock'
import { parseKit, unb64 } from '../identity/keys'
import { readVerifier, updateVerifier, type LocalDeleteVerifier } from './local-delete-store'

export const localDeletePinReady = ref(false)
export const localDeletePinEnabled = ref(false)
export const localDeletePinFailure = ref(false)
const channel = typeof BroadcastChannel === 'function'
  ? new BroadcastChannel('photobunker-local-delete-v1') : undefined
let generation = 0
const scope = () => ({ owner: account.value?.id ?? '', device: deviceId.value })
const assertScope = (owner: string, device: string, epoch: number) => {
  if (!owner || !device || owner !== account.value?.id || device !== deviceId.value ||
    generation !== epoch || !hasConfirmedIdentity() ||
    !appLockReady.value || appLocked.value) throw new Error('localDelete.scope')
}
const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), v => v.toString(16).padStart(2, '0')).join('')
const saltBytes = (value: string) =>
  new Uint8Array(value.match(/../g)!.map(v => Number.parseInt(v, 16)))
async function derive(pin: string, salt: string, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  return hex(await crypto.subtle.deriveBits({
    name: 'PBKDF2', salt: saltBytes(salt), hash: 'SHA-256', iterations,
  }, key, 256))
}
function valid(v: LocalDeleteVerifier | undefined) {
  return !!v && v.version === 1 && /^[a-f0-9]{32}$/.test(v.salt) &&
    /^[a-f0-9]{64}$/.test(v.digest) && v.iterations >= 100000 &&
    v.iterations <= 600000 && Number.isSafeInteger(v.iterations) &&
    /^[a-f0-9]{64}$/.test(v.recoveryFingerprint) &&
    Number.isSafeInteger(v.failures) && v.failures >= 0 &&
    Number.isSafeInteger(v.lastWall) && v.lastWall >= 0 &&
    Number.isSafeInteger(v.cooldownUntil) && v.cooldownUntil >= 0
}
const equal = (a: string, b: string) => {
  let result = a.length ^ b.length
  for (let i = 0; i < Math.min(a.length, b.length); i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return result === 0
}
async function make(pin: string, fingerprint: string) {
  if (!/^(?:\d{6}|\d{8})$/.test(pin)) throw new Error('localDelete.length')
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)).buffer)
  const start = performance.now()
  await derive('000000', salt, 100000)
  const elapsed = Math.max(1, performance.now() - start)
  const iterations = Math.max(100000, Math.min(600000, Math.round((100000 * 300 / elapsed) / 10000) * 10000))
  return {
    version: 1 as const, salt, digest: await derive(pin, salt, iterations),
    iterations, failures: 0, cooldownUntil: 0, lastWall: Date.now(), recoveryFingerprint: fingerprint,
  }
}
export async function provePB1Locally(value: string, expectedRoot: string): Promise<string> {
  if (!expectedRoot) throw new Error('localDelete.recovery')
  const parsed = await parseKit(value)
  if (parsed.publicKey !== expectedRoot) throw new Error('localDelete.recovery')
  // Parsing a PB1 public part is not sufficient: require its PRIVATE key.
  const publicKey = await crypto.subtle.importKey('spki', unb64(parsed.publicKey),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, parsed.privateKey, challenge)
  if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, challenge))
    throw new Error('localDelete.recovery')
  return hex(await crypto.subtle.digest('SHA-256', unb64(parsed.publicKey)))
}
export function forgetLocalDeletePinState() {
  generation++
  localDeletePinReady.value = false
  localDeletePinFailure.value = false
  localDeletePinEnabled.value = false
}
export async function loadLocalDeletePin() {
  const epoch = ++generation, { owner, device } = scope()
  localDeletePinReady.value = false
  localDeletePinFailure.value = false
  localDeletePinEnabled.value = false
  if (!owner || !device || !hasConfirmedIdentity() || appLocked.value) return
  try {
    const v = await readVerifier(owner, device)
    if (epoch !== generation || owner !== account.value?.id || device !== deviceId.value) return
    if (v && !valid(v)) throw new Error('localDelete.storage')
    localDeletePinEnabled.value = !!v
    localDeletePinReady.value = true
  } catch {
    if (epoch === generation) {
      localDeletePinFailure.value = true
      localDeletePinEnabled.value = true
      localDeletePinReady.value = true
    }
  }
}
export async function verifyLocalDeletePin(pin: string, fingerprint?: string) {
  const { owner, device } = scope(), epoch = generation
  assertScope(owner, device, epoch)
  if (!localDeletePinReady.value || localDeletePinFailure.value) throw new Error('localDelete.storage')
  const saved = await readVerifier(owner, device)
  assertScope(owner, device, epoch)
  if (!valid(saved)) throw new Error('localDelete.storage')
  const record = saved!
  if (fingerprint && record.recoveryFingerprint !== fingerprint) throw new Error('localDelete.recovery')
  if (Date.now() < record.lastWall) throw new Error('localDelete.clock')
  if (record.cooldownUntil > Date.now()) throw new Error('localDelete.cooldown')
  const candidate = await derive(pin, record.salt, record.iterations)
  assertScope(owner, device, epoch)
  let matched = false
  try {
    await updateVerifier(owner, device, previous => {
      if (!valid(previous) || previous!.digest !== record.digest ||
        previous!.salt !== record.salt) throw new Error('localDelete.storage')
      const now = Date.now()
      if (now < previous!.lastWall || now < previous!.cooldownUntil)
        throw new Error('localDelete.cooldown')
      matched = equal(candidate, previous!.digest)
      const failures = matched ? 0 : Math.min(100, previous!.failures + 1)
      const delay = failures < 3 ? 0 : Math.min(60000, 2000 * 2 ** Math.min(failures - 3, 5))
      return {
        ...previous!, failures,
        cooldownUntil: matched ? 0 : Math.max(previous!.cooldownUntil, now + delay),
        lastWall: Math.max(previous!.lastWall, now),
      }
    })
  } catch (error) {
    if (!(error instanceof Error) || error.message === 'localDelete.storage')
      localDeletePinFailure.value = true
    throw error
  }
  assertScope(owner, device, epoch)
  if (!matched) throw new Error('localDelete.wrong')
}
export async function configureLocalDeletePin(
  nextPin: string, repeated: string, pb1: string, appPin: string, oldPin?: string,
) {
  const { owner, device } = scope(), epoch = generation
  assertScope(owner, device, epoch)
  if (localDeletePinFailure.value || !localDeletePinReady.value) throw new Error('localDelete.storage')
  if (nextPin !== repeated || !/^(?:\d{6}|\d{8})$/.test(nextPin))
    throw new Error('localDelete.length')
  if (appPinEnabled.value && !appPin) throw new Error('localDelete.appPin')
  if (appPinEnabled.value) await confirmAppPinForLocalDelete(appPin)
  assertScope(owner, device, epoch)
  if (await matchesAppPinForLocalDelete(nextPin) ||
    await (await import('./emergency')).matchesConfiguredEmergencyPin(nextPin))
    throw new Error('localDelete.samePin')
  assertScope(owner, device, epoch)
  const fingerprint = await provePB1Locally(pb1, account.value?.rootKey ?? '')
  assertScope(owner, device, epoch)
  const before = await readVerifier(owner, device)
  if (before) await verifyLocalDeletePin(oldPin ?? '', before.recoveryFingerprint)
  const value = await make(nextPin, fingerprint)
  assertScope(owner, device, epoch)
  await updateVerifier(owner, device, previous => {
    if (before ? previous?.digest !== before.digest : !!previous) throw new Error('localDelete.changed')
    return value
  })
  assertScope(owner, device, epoch)
  localDeletePinEnabled.value = true
  channel?.postMessage({ owner, device })
}
/** Prevent enabling/changing the normal app PIN to an existing local-delete PIN. */
export async function matchesLocalDeletePin(candidate: string): Promise<boolean> {
  const { owner, device } = scope(), epoch = generation
  if (!owner || !device) return false
  // App-PIN storage cannot be usable without IndexedDB in production. This
  // guard also keeps storage-adapter unit tests independent when D4 is absent.
  if (!globalThis.indexedDB) return false
  const record = await readVerifier(owner,device)
  if (!record) return false
  if (!valid(record)) throw new Error('localDelete.storage')
  const hash=await derive(candidate,record.salt,record.iterations)
  assertScope(owner,device,epoch)
  return equal(hash,record.digest)
}
export async function disableLocalDeletePin(pin: string, appPin: string) {
  const { owner, device } = scope(), epoch = generation
  assertScope(owner, device, epoch)
  if (appPinEnabled.value) {
    if (!appPin) throw new Error('localDelete.appPin')
    await confirmAppPinForLocalDelete(appPin)
  }
  const previousRecord=await readVerifier(owner,device)
  await verifyLocalDeletePin(pin)
  assertScope(owner, device, epoch)
  await updateVerifier(owner, device, previous => {
    if (!previous || !valid(previous) || previous.digest !== previousRecord?.digest ||
      previous.salt !== previousRecord?.salt) throw new Error('localDelete.changed')
    return undefined
  })
  assertScope(owner, device, epoch)
  localDeletePinEnabled.value = false
  channel?.postMessage({ owner, device })
}
channel?.addEventListener('message', e => {
  const data = e.data as { owner?: string; device?: string } | null
  if (data && data.owner === account.value?.id && data.device === deviceId.value)
    void loadLocalDeletePin()
})
