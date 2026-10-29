import { ref } from 'vue'
import { account, deviceId } from '../identity/store'
import {
  readPin, writePin, readLegacyPin, clearLegacyPin,
  type PinRecord, type PinV2, type LegacyPin,
} from './pin-store'

export const appLockReady = ref(false),
  appLockFailure = ref(false),
  appLocked = ref(true),
  appPinEnabled = ref(false),
  appPinLegacy = ref(false)

let loadEpoch = 0, guardEpoch = 0
let current: PinRecord | undefined
const encoder = new TextEncoder()
const channel = typeof BroadcastChannel === 'function'
  ? new BroadcastChannel('photobunker-app-pin-v2') : undefined
const scope = () => account.value?.id && deviceId.value
  ? `app-pin:${account.value.id}:${deviceId.value}` : ''
const isLegacy = (value: PinRecord): value is LegacyPin =>
  'digest' in value && typeof value.digest === 'string'
const isV2 = (value: PinRecord): value is PinV2 => 'version' in value && value.version === 2
function valid(value: PinRecord | undefined): boolean {
  if (!value) return true
  if ('version' in value && value.version === 0) return true
  const common = 'salt' in value && typeof value.salt === 'string' &&
    'failures' in value && Number.isSafeInteger(value.failures) && value.failures >= 0 &&
    'until' in value && Number.isSafeInteger(value.until) && value.until >= 0
  if (!common) return false
  if (isLegacy(value)) return /^[a-f0-9]{64}$/.test(value.digest)
  return isV2(value) && /^[a-f0-9]{32}$/.test(value.salt) &&
    /^[a-f0-9]{64}$/.test(value.verifier) &&
    Number.isSafeInteger(value.iterations) &&
    value.iterations >= 100000 && value.iterations <= 600000 &&
    (value.length === 4 || value.length === 6 || value.length === 8) &&
    Number.isSafeInteger(value.lastWall) && value.lastWall >= 0
}
function failClosed() {
  guardEpoch++
  current = undefined
  appPinEnabled.value = true
  appLocked.value = true
  appLockFailure.value = true
  appLockReady.value = true
}
const guard = (id: string, epoch: number, mutation = guardEpoch) => {
  if (!id || scope() !== id || epoch !== loadEpoch || mutation !== guardEpoch)
    throw new Error('pin.account_changed')
}
const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
const bytes = (hexString: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(hexString.match(/../g)!.map(segment => Number.parseInt(segment, 16)))
async function legacyHash(pin: string, salt: string): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', encoder.encode(salt + ':' + pin))
  return hex(new Uint8Array(result))
}
async function derive(pin: string, salt: string, iterations: number): Promise<string> {
  const input = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits'])
  const output = await crypto.subtle.deriveBits({
    name: 'PBKDF2', salt: bytes(salt), iterations, hash: 'SHA-256',
  }, input, 256)
  return hex(new Uint8Array(output))
}
function equal(first: string, second: string) {
  if (first.length !== second.length) return false
  let difference = 0
  for (let i = 0; i < first.length; i++) difference |= first.charCodeAt(i) ^ second.charCodeAt(i)
  return difference === 0
}
async function calibrate(): Promise<number> {
  // Bounded work, never an unbounded browser benchmark.
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)))
  const start = performance.now()
  await derive('000000', salt, 100000)
  const elapsed = Math.max(1, performance.now() - start)
  return Math.max(100000, Math.min(600000, Math.round(100000 * (300 / elapsed) / 10000) * 10000))
}
async function makeRecord(pin: string, legacyFour = false): Promise<PinV2> {
  if (!(legacyFour && /^\d{4}$/.test(pin)) && !/^(?:\d{6}|\d{8})$/.test(pin)) throw new Error('pin.length')
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)))
  const iterations = await calibrate()
  return {
    version: 2, salt, iterations, length: pin.length as 4 | 6 | 8,
    verifier: await derive(pin, salt, iterations),
    failures: 0, until: 0, lastWall: Date.now(),
  }
}
const sameVerifier = (a: PinRecord | undefined, b: PinRecord) =>
  !!a && (isV2(a) && isV2(b)
    ? a.salt === b.salt && a.verifier === b.verifier
    : isLegacy(a) && isLegacy(b) && a.salt === b.salt && a.digest === b.digest)
function checkCooldown(value: LegacyPin | PinV2, now: number) {
  if (now < (value.lastWall ?? 0)) throw new Error('pin.clock_rollback')
  if (value.until > now) throw new Error('pin.cooldown')
}
function changed(kind: 'record' | 'lock' | 'attempt') {
  const id = scope()
  if (id) channel?.postMessage({ id, kind })
}
channel?.addEventListener('message', event => {
  const msg = event.data as { id?: string; kind?: string } | null
  if (!msg || msg.id !== scope()) return
  if (msg.kind === 'attempt') return // Every verification reads atomic persistent counters.
  guardEpoch++
  appLocked.value = true
  appLockReady.value = false
  void loadAppLock()
})

export async function loadAppLock() {
  const epoch = ++loadEpoch, id = scope()
  guardEpoch++
  appLockReady.value = false
  appLocked.value = true
  appLockFailure.value = false
  appPinEnabled.value = false
  appPinLegacy.value = false
  current = undefined
  if (!id) {
    appLocked.value = false
    appLockReady.value = true
    return
  }
  try {
    let record = await readPin(id)
    if (!record) {
      const legacy = await readLegacyPin(id)
      if (legacy) {
        if (!valid(legacy)) throw new Error('pin.corrupt')
        record = await writePin(id, previous => previous ?? legacy)
      }
    }
    if (epoch !== loadEpoch || id !== scope()) return
    if (!valid(record)) throw new Error('pin.corrupt')
    current = record
    appPinEnabled.value = !!record && !('version' in record && record.version === 0)
    appPinLegacy.value = !!record && (isLegacy(record) || isV2(record) && record.length === 4)
    appLocked.value = appPinEnabled.value
    appLockReady.value = true
  } catch {
    if (epoch === loadEpoch && id === scope()) failClosed()
  }
}
function pinStorageError(error: unknown) {
  return error instanceof Error && (
    /storage|InvalidStateError|QuotaExceededError|SecurityError|AbortError|pin.corrupt/.test(error.message) ||
    error instanceof DOMException && ['QuotaExceededError', 'SecurityError', 'InvalidStateError'].includes(error.name))
}
function storageFailure(error: unknown): never {
  if (pinStorageError(error)) failClosed()
  throw error
}
async function verify(pin: string, id: string, epoch: number, mutation: number) {
  guard(id, epoch, mutation)
  let saved: PinRecord | undefined
  try { saved = await readPin(id) } catch (error) { storageFailure(error) }
  guard(id, epoch, mutation)
  if (!saved || !valid(saved) || ('version' in saved && saved.version === 0))
    return storageFailure(new Error('pin.corrupt'))
  const record = saved as LegacyPin | PinV2
  const now = Date.now()
  checkCooldown(record, now)
  const entered = isLegacy(record) ? await legacyHash(pin, record.salt)
    : await derive(pin, record.salt, record.iterations)
  guard(id, epoch, mutation)
  const correct = equal(entered, isLegacy(record) ? record.digest : record.verifier)
  let allowed = false
  try {
    await writePin(id, previous => {
      if (!previous || !sameVerifier(previous, record)) throw new Error('pin.changed')
      const previousRecord = previous as LegacyPin | PinV2
      const now = Date.now()
      checkCooldown(previousRecord, now)
      if (correct) {
        allowed = true
        return { ...previousRecord, failures: 0, until: 0,
          lastWall: Math.max(now, previousRecord.lastWall ?? 0) }
      }
      const failures = Math.min(100, previousRecord.failures + 1)
      const wait = failures < 3 ? 0 : Math.min(60000, 2000 * 2 ** Math.min(5, failures - 3))
      return { ...previousRecord, failures, until: Math.max(previousRecord.until, now + wait),
        lastWall: Math.max(now, previousRecord.lastWall ?? 0) }
    })
  } catch (error) { storageFailure(error) }
  guard(id, epoch, mutation)
  changed('attempt')
  if (!allowed) throw new Error('pin.wrong')
  return record
}
export async function unlockApp(pin: string) {
  const id = scope(), epoch = loadEpoch, mutation = guardEpoch
  if (appLockFailure.value || !appLockReady.value) throw new Error('pin.storage_failed')
  if (!appPinEnabled.value) return
  const verified = await verify(pin, id, epoch, mutation)
  guard(id, epoch, mutation)
  if (isLegacy(verified)) {
    // Existing 4-digit PIN accepted until this successful unlock. Only then
    // replace its fast SHA-256 record; never rewrite failed legacy attempts.
    const migrated = await makeRecord(pin, pin.length === 4)
    try {
      await writePin(id, previous => {
        if (!previous || !sameVerifier(previous, verified)) throw new Error('pin.changed')
        return migrated
      })
      await clearLegacyPin(id).catch(() => {}) // v2 always wins on subsequent loads
    } catch (error) { storageFailure(error) }
    guard(id, epoch, mutation)
    current = migrated
    appPinLegacy.value = migrated.length === 4
    changed('record')
  }
  appLocked.value = false
}
export async function setAppPin(pin: string, oldPin?: string) {
  const id = scope(), epoch = loadEpoch, mutation = guardEpoch
  if (!id || !appLockReady.value || appLockFailure.value || appLocked.value)
    throw new Error('pin.locked')
  if (!/^(?:\d{6}|\d{8})$/.test(pin)) throw new Error('pin.length')
  const old = current
  if (appPinEnabled.value) {
    if (!oldPin) throw new Error('pin.confirm_required')
    await verify(oldPin, id, epoch, mutation)
  }
  if (await (await import('./local-delete-pin')).matchesLocalDeletePin(pin) ||
    await (await import('./emergency')).matchesConfiguredEmergencyPin(pin))
    throw new Error('localDelete.samePin')
  const next = await makeRecord(pin)
  guard(id, epoch, mutation)
  try {
    await writePin(id, previous => {
      if (appPinEnabled.value ? !previous || !old || !sameVerifier(previous, old)
        : previous && !('version' in previous && previous.version === 0))
        throw new Error('pin.changed')
      return next
    })
    if (old && isLegacy(old)) await clearLegacyPin(id)
  } catch (error) { storageFailure(error) }
  guard(id, epoch, mutation)
  current = next
  appPinEnabled.value = true
  appPinLegacy.value = false
  changed('record')
}
export async function removeAppPin(oldPin: string) {
  const id = scope(), epoch = loadEpoch, mutation = guardEpoch
  if (!id || !appLockReady.value || appLockFailure.value || appLocked.value)
    throw new Error('pin.locked')
  if (!appPinEnabled.value) return
  if (!oldPin) throw new Error('pin.confirm_required')
  const old = current
  await verify(oldPin, id, epoch, mutation)
  try {
    await writePin(id, previous => {
      if (!previous || !old || !sameVerifier(previous, old)) throw new Error('pin.changed')
      // Tombstone prevents a pre-migration legacy PIN from reappearing.
      return { version: 0 }
    })
    await clearLegacyPin(id).catch(() => {})
  } catch (error) { storageFailure(error) }
  guard(id, epoch, mutation)
  current = { version: 0 }
  appPinEnabled.value = false
  appPinLegacy.value = false
  appLocked.value = false
  changed('record')
}
export function lockApp() {
  if (appPinEnabled.value || appLockFailure.value) {
    guardEpoch++
    appLocked.value = true
    changed('lock')
  }
}
/** Only callable after a successful online PB1 identity proof on this account. */
export async function resetAppPinAfterRecovery(confirmedOwner: string, formerDevice: string) {
  if (!formerDevice || account.value?.id !== confirmedOwner) throw new Error('pin.account_changed')
  const id = `app-pin:${confirmedOwner}:${formerDevice}`
  try {
    await writePin(id, () => ({ version: 0 }))
    await clearLegacyPin(id).catch(() => {})
  } catch (error) { storageFailure(error) }
  if (scope() === id) {
    guardEpoch++
    // Keep the screen locked until the successful PB1 flow switches to its
    // newly proven device. The PIN verifier is removed, not the account key.
    changed('record')
  }
}

/** D4: app-PIN confirmation is independent of local-delete attempt counters. */
export async function confirmAppPinForLocalDelete(pin: string): Promise<void> {
  if (!appLockReady.value || appLocked.value || appLockFailure.value)
    throw new Error('pin.locked')
  if (!appPinEnabled.value) return
  await verify(pin, scope(), loadEpoch, guardEpoch)
}
export async function matchesAppPinForLocalDelete(pin: string): Promise<boolean> {
  if (!appLockReady.value || appLocked.value || appLockFailure.value)
    throw new Error('pin.locked')
  if (!appPinEnabled.value) return false
  const id = scope(), epoch = loadEpoch, mutation = guardEpoch
  const value = await readPin(id)
  guard(id, epoch, mutation)
  if (!value || !valid(value) || 'version' in value && value.version === 0)
    throw new Error('pin.storage_failed')
  const candidate = isLegacy(value) ? await legacyHash(pin, value.salt)
    : await derive(pin, value.salt, value.iterations)
  guard(id, epoch, mutation)
  return equal(candidate, isLegacy(value) ? value.digest : value.verifier)
}
