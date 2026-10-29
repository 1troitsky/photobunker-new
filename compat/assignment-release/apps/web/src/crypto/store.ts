import { appLockReady, appLocked, appPinEnabled } from '../app/lock'
import { rememberKit, rememberedKit } from './trusted'
import { accountKey, readAccountSecrets, saveAccountSecrets } from '../identity/vault'
import { observe, rememberClock, restoreClock } from './time'
import { ref, shallowRef, watch, nextTick } from 'vue'
import {
  account,
  deviceId,
  offlineCaptureIdentity,
  sessionState,
  loadIdentity,
  restorePublicCaptureIdentity,
} from '../identity/store'
import { parseKit } from '../identity/keys'
import { cryptoCall, destroyCrypto } from './client'
import * as db from './database'
import { request, setReadToken } from './api'
import {
  ready,
  canonical,
  b64,
  unb64,
  hash,
  statementBytes,
  checkRoot,
  checkPlan,
  type KeyDocument,
  type KeyRecord,
  type SignedPlan,
  type Plan,
  type DeviceCertificate,
} from './protocol'
import type { RecoveryBundle } from './key-material'
import {
  protectionEnabled,
  protectionReady,
  strongUnlocked,
  warmLocked,
  lockGeneration,
  cryptoError,
  photoReadAllowed,
} from './state'
export {
  protectionEnabled,
  protectionReady,
  strongUnlocked,
  warmLocked,
  cryptoError,
  photoReadAllowed,
}
type KeyState = {
  enabled: boolean
  document?: KeyDocument
  bundle?: RecoveryBundle
}
type CaptureDevice = {
  key: CryptoKey
  publicKey: string
  certificate: DeviceCertificate
}
export type CaptureReady = {
  plan: SignedPlan
  device: CaptureDevice
  ownerFingerprint: string
  anchor: { id: string; issuedAt: number }
}
export const keyState = shallowRef<KeyState>({ enabled: false })
export const candidateKit = ref('')
export const planReview = shallowRef<Plan>()
export const untrustedKeys = ref<{ publicId: string; fingerprint: string }[]>(
  [],
)
let idleWall = 0,
  idleMono = 0,
  baseWall = 0,
  baseMono = 0
const autoAttempt = new Set<string>()
let trusted = false
let owner = '',
  renew: ReturnType<typeof setInterval> | undefined,
  idle: ReturnType<typeof setTimeout> | undefined,
  pinDigest = '',
  failures = 0,
  staged: KeyState | undefined,
  rotating = false
const channel =
  typeof window !== 'undefined' && typeof BroadcastChannel === 'function'
    ? new BroadcastChannel('photobunker-photo-lock-v1')
    : undefined
function changed() {
  window.dispatchEvent(new Event('photobunker-photo-security'))
}
export function hardLock(broadcast = true) {
  idleWall = idleMono = baseWall = baseMono = 0
  lockGeneration.value++
  strongUnlocked.value = false
  warmLocked.value = false
  candidateKit.value = ''
  staged = undefined
  rotating = false
  linkRequest.value = undefined
  planReview.value = undefined
  untrustedKeys.value = []
  pinDigest = ''
  pinSalt = ''
  failures = 0
  destroyCrypto()
  setReadToken('', 0)
  if (renew) clearInterval(renew)
  renew = undefined
  if (idle) clearTimeout(idle)
  idle = undefined
  changed()
  if (broadcast) channel?.postMessage('lock')
}
channel?.addEventListener('message', () => hardLock(false))
export function checkLifetime() {
  if (!strongUnlocked.value) return false
  if (trusted) return true
  const wall = Date.now(),
    mono = performance.now()
  if (
    idleWall &&
    (wall >= idleWall ||
      mono >= idleMono ||
      Math.abs(wall - baseWall - (mono - baseMono)) > 5000)
  ) {
    hardLock()
    return false
  }
  return true
}
export function warmLock() {
  if (!checkLifetime() || warmLocked.value) return
  warmLocked.value = true
  changed()
}

function scope() {
  const id = account.value?.id
  if (!id || id !== owner) throw new Error('crypto.account_changed')
  return id
}
function still(id: string, generation: number) {
  if (id !== account.value?.id || generation !== lockGeneration.value)
    throw new Error('crypto.locked')
}
export async function loadProtection() {
  await loadIdentity()
  await restorePublicCaptureIdentity().catch(() => {})
  const id = account.value?.id ?? ''
  if (id !== owner) {
    hardLock(false)
    trusted = false
    autoAttempt.clear()
    owner = id
    keyState.value = { enabled: false }
    protectionEnabled.value = false
  }
  protectionReady.value = false
  if (!id) {
    protectionReady.value = true
    return
  }
  try {
    const value = await request<KeyState>('/keys')
    cryptoError.value = ''
    const previous = await db.get<KeyState>(`keys:${id}`)
    if (
      previous?.enabled &&
      (!value.enabled ||
        !value.document ||
        !previous.document ||
        value.document.record.revision < previous.document.record.revision ||
        (value.document.record.revision === previous.document.record.revision &&
          canonical(value.document) !== canonical(previous.document)))
    )
      throw new Error('crypto.rollback')
    if (id !== account.value?.id) return
    keyState.value = value
    protectionEnabled.value = value.enabled
    await db.put(`keys:${id}`, value)
  } catch {
    const value = await db.get<KeyState>(`keys:${id}`).catch(() => undefined)
    if (id !== account.value?.id) return
    if (value) {
      keyState.value = value
      protectionEnabled.value = value.enabled
    } else
      cryptoError.value =
        'Не удалось проверить защиту фотографий. Подключитесь к сети.'
  } finally {
    if (id === account.value?.id) protectionReady.value = true
    changed()
  }
  const attempt = `${id}:${deviceId.value}`
  if (
    id &&
    protectionEnabled.value &&
    !strongUnlocked.value &&
    appLockReady.value &&
    !appLocked.value &&
    !autoAttempt.has(attempt)
  ) {
    autoAttempt.add(attempt)
    protectionReady.value = false
    try {
      const kit = await rememberedKit() || (await readAccountSecrets())?.photoKey
      if (kit) await unlock(kit)
    } catch {
      /* An invalid/rotated local kit requires explicit recovery. */
    } finally {
      protectionReady.value = true
      changed()
    }
  }
}
export async function beginSetup(pb1: string) {
  const id = scope(),
    generation = lockGeneration.value
  await ready()
  const root = await parseKit(pb1),
    created = await cryptoCall<{
      record: KeyRecord
      bundle: RecoveryBundle
      signature: string
      kit: string
    }>('create', { accountId: id, publicId: account.value!.publicId })
  const binding = {
      version: 1 as const,
      accountId: id,
      authorityKey: created.record.authorityKey,
    },
    rootSignature = b64(
      new Uint8Array(
        await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          root.privateKey,
          statementBytes('photo-authority', binding) as Uint8Array<ArrayBuffer>,
        ),
      ),
    )
  const document: KeyDocument = {
    record: created.record,
    signature: created.signature,
    binding,
    rootSignature,
    rootKey: root.publicKey,
  }
  await checkRoot(document)
  still(id, generation)
  rotating = false
  staged = { enabled: true, document, bundle: created.bundle }
  candidateKit.value = created.kit
}
export async function confirmSetup() {
  const id = scope(),
    generation = lockGeneration.value
  if (!staged?.document || !staged.bundle) throw new Error('crypto.no_backup')
  if (await accountKey()) await saveAccountSecrets({ photoKey: candidateKit.value })
  still(id, generation)
  await request('/keys', 'POST', {
    document: canonical(staged.document),
    bundle: canonical(staged.bundle),
  })
  still(id, generation)
  await rememberKit(candidateKit.value)
  trusted = true
  autoAttempt.add(`${id}:${deviceId.value}`)
  keyState.value = staged
  protectionEnabled.value = true
  await db.put(`keys:${id}`, staged)
  staged = undefined
  candidateKit.value = ''
  if (rotating) {
    await cryptoCall('rotate-commit', {})
    rotating = false
  }
  await opened(id, generation)
}
async function authenticateRead() {
  const id = scope(),
    generation = lockGeneration.value
  const challenge = await request<Record<string, unknown>>(
    '/read/challenge',
    'POST',
  )
  const signature = await cryptoCall<string>('read-proof', {
    statement: challenge,
    deviceId: deviceId.value,
    origin: location.origin,
  })
  const time = Number(challenge.expiresAt) - 120000
  const token = await request<{ token: string; expiresAt: number }>(
    '/read/session',
    'POST',
    { id: challenge.id, signature },
  )
  still(id, generation)
  setReadToken(token.token, token.expiresAt)
  if (photoReadAllowed()) await rememberClock(id, time)
  return time
}
async function captureDevice() {
  const id = scope(),
    name = `device:${id}:${deviceId.value}`
  let saved = await db.get<CaptureDevice>(name)
  if (saved && saved.certificate.statement.expiresAt > Date.now() + 86400000)
    return saved
  let key: CryptoKey, publicKey: string
  if (saved) {
    key = saved.key
    publicKey = saved.publicKey
  } else {
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign', 'verify'],
    )
    key = pair.privateKey
    publicKey = b64(
      new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)),
    )
  }
  const statement = {
      version: 1 as const,
      accountId: id,
      deviceId: deviceId.value,
      signingKey: publicKey,
      authorityKey: keyState.value.document!.record.authorityKey,
      expiresAt: Date.now() + 29 * 86400000,
    },
    signature = await cryptoCall<string>('sign', {
      purpose: 'capture-device',
      statement,
    })
  saved = { key, publicKey, certificate: { statement, signature } }
  await request('/device', 'PUT', {
    certificate: canonical(saved.certificate),
  })
  await db.put(name, saved)
  return saved
}
async function opened(id: string, generation: number) {
  if (renew) clearInterval(renew)
  const time = await authenticateRead()
  still(id, generation)
  await captureDevice()
  still(id, generation)
  strongUnlocked.value = true
  warmLocked.value = false
  baseWall = Date.now()
  baseMono = performance.now()
  observe(time)
  cryptoError.value = ''
  failures = 0
  renew = setInterval(() => {
    if (strongUnlocked.value && !warmLocked.value)
      void authenticateRead().catch(() => {
        hardLock()
        autoAttempt.clear()
        void loadProtection()
      })
  }, 240000)
  touch()
  changed()
}
async function openedOffline(id: string, generation: number) {
  await restoreClock(id)
  still(id, generation)
  strongUnlocked.value = true
  warmLocked.value = false
  baseWall = Date.now()
  baseMono = performance.now()
  cryptoError.value = ''
  failures = 0
  touch()
  changed()
}
export async function unlock(kit: string) {
  const id = scope(),
    generation = lockGeneration.value
  const value = keyState.value
  if (!value.enabled || !value.document || !value.bundle)
    throw new Error('crypto.disabled')
  await cryptoCall('unlock', {
    kit,
    bundle: value.bundle,
    document: value.document,
  })
  try {
    if (!navigator.onLine && offlineCaptureIdentity.value &&
        ['offline', 'checking'].includes(sessionState.value))
      await openedOffline(id, generation)
    else await opened(id, generation)
    await rememberKit(kit)
    trusted = true
    autoAttempt.add(`${id}:${deviceId.value}`)
    touch()
  } catch (error) {
    hardLock()
    throw error
  }
}
export async function setPin(pin: string) {
  if (!photoReadAllowed() || !/^\d{4}$|^\d{6}$|^\d{8}$/.test(pin))
    throw new Error('crypto.invalid_pin')
  pinSalt = crypto.randomUUID()
  pinDigest = hash(`${pinSalt}/${pin}`)
}
let pinSalt = ''
export async function unlockWarm(pin: string) {
  if (!checkLifetime()) throw new Error('crypto.strong_required')
  if (!pinDigest) throw new Error('crypto.strong_required')
  if (hash(`${pinSalt}/${pin}`) !== pinDigest) {
    if (++failures >= 5) hardLock()
    throw new Error('crypto.invalid_pin')
  }
  failures = 0
  warmLocked.value = false
  touch()
  changed()
}
export function hasWarmPin() {
  return !!pinDigest
}
export function touch() {
  if (!checkLifetime() || warmLocked.value) return
  if (trusted) {
    if (idle) clearTimeout(idle)
    idle = undefined
    return
  }
  idleWall = Date.now() + 300000
  idleMono = performance.now() + 300000
  if (idle) clearTimeout(idle)
  idle = setTimeout(() => hardLock(), 300000)
}
export async function prepareContext(
  assignmentId?: string,
  approve = false,
): Promise<CaptureReady> {
  const id = scope()
  await ready()
  const context = await request<{
    draft: Plan
    plan: SignedPlan | null
    missing: string[]
  }>(`/context${assignmentId ? '?assignmentId=' + assignmentId : ''}`)
  if (context.missing.length) throw new Error('crypto.participants_not_ready')
  const history = await db.get<{ epoch: number; membershipHash: string }>(
    `vault:${id}:${context.draft.vaultId}`,
  )
  if (
    history &&
    (context.draft.epoch < history.epoch ||
      (context.draft.epoch === history.epoch &&
        context.draft.membershipHash !== history.membershipHash))
  )
    throw new Error('crypto.rollback')
  if (
    approve &&
    (!planReview.value ||
      canonical(planReview.value) !== canonical(context.draft))
  )
    throw new Error('crypto.review_changed')
  const unknown: { publicId: string; fingerprint: string }[] = [],
    pins: {
      id: string
      value: {
        fingerprint: string
        rootKey: string
        revision: number
        documentHash?: string
      }
    }[] = []
  for (const member of context.draft.members) {
    await checkRoot(member.key)
    if (member.accountId === id) {
      if (canonical(member.key) !== canonical(keyState.value.document))
        throw new Error('crypto.key_changed')
      continue
    }
    const fingerprint = hash(unb64(member.key.record.authorityKey, 32)),
      saved = await db.get<{
        fingerprint: string
        rootKey: string
        revision: number
        documentHash?: string
      }>(`pin:${id}:${member.accountId}`)
    if (
      saved &&
      (saved.fingerprint !== fingerprint ||
        saved.rootKey !== member.key.rootKey ||
        saved.revision > member.key.record.revision ||
        (saved.documentHash &&
          saved.revision === member.key.record.revision &&
          saved.documentHash !== hash(canonical(member.key))))
    )
      throw new Error('crypto.key_changed')
    if (!saved) unknown.push({ publicId: member.publicId, fingerprint })
    pins.push({
      id: `pin:${id}:${member.accountId}`,
      value: {
        fingerprint,
        rootKey: member.key.rootKey,
        revision: member.key.record.revision,
        documentHash: hash(canonical(member.key)),
      },
    })
  }
  untrustedKeys.value = unknown
  const needsPolicyApproval =
    !context.plan &&
    context.draft.ownerId === id &&
    context.draft.assignmentId !== null
  if ((unknown.length || needsPolicyApproval) && !approve) {
    planReview.value = context.draft
    throw new Error('crypto.review_required')
  }
  let plan = context.plan
  if (!plan) {
    if (context.draft.ownerId !== id)
      throw new Error('crypto.owner_must_prepare')
    if (!photoReadAllowed()) throw new Error('crypto.strong_required')
    plan = {
      statement: context.draft,
      authority: keyState.value.document!,
      signature: await cryptoCall<string>('sign', {
        purpose: 'capture-plan',
        statement: context.draft,
      }),
    }
    await request('/plan', 'PUT', { plan: canonical(plan) })
  }
  await checkPlan(plan, context.draft.vaultId)
  if (canonical(plan.statement) !== canonical(context.draft))
    throw new Error('crypto.plan_changed')
  for (const pin of pins) await db.put(pin.id, pin.value)
  await db.put(`vault:${id}:${context.draft.vaultId}`, {
    epoch: context.draft.epoch,
    membershipHash: context.draft.membershipHash,
  })
  const device = await db.get<CaptureDevice>(`device:${id}:${deviceId.value}`)
  if (!device || device.certificate.statement.expiresAt <= Date.now())
    throw new Error('crypto.strong_required')
  const anchor = await request<{ id: string; issuedAt: number }>(
      '/clock',
      'POST',
    ),
    readyContext = {
      plan,
      device,
      ownerFingerprint: hash(unb64(plan.authority.record.authorityKey, 32)),
      anchor,
    }
  await rememberClock(id, anchor.issuedAt)
  await db.put(`context:${id}:${assignmentId ?? 'personal'}`, readyContext)
  planReview.value = undefined
  untrustedKeys.value = []
  return readyContext
}

export async function cachedContext(assignmentId?: string) {
  const id = scope()
  const value = await db.get<CaptureReady>(
    `context:${id}:${assignmentId ?? 'personal'}`,
  )
  if (
    !value ||
    value.plan.statement.validUntil <= Date.now() ||
    value.device.certificate.statement.expiresAt <= Date.now()
  )
    throw new Error('Подготовьте защиту камеры в Профиле.')
  await ready()
  await checkPlan(value.plan, value.plan.statement.vaultId)
  return value
}
export function startProtection() {
  const stop = watch(
    () => account.value?.id,
    () => {
      hardLock(false)
      void loadProtection()
    },
    { immediate: true },
  )
  const hide = () => {
      document.documentElement.dataset.photoBackground = 'true'
      // Closing/reloading one document must not lock another tab, and the
      // retiring document must not race the replacement page's auto-unlock.
      // Explicit app/account/security locks still broadcast via hardLock().
      hardLock(false)
      autoAttempt.clear()
    },
    visibility = () => {
      if (document.hidden) {
        document.documentElement.dataset.photoBackground = 'true'
        if (candidateKit.value) hardLock()
        else if (!trusted || appPinEnabled.value) warmLock()
      } else {
        if (trusted && strongUnlocked.value && !appLocked.value)
          void authenticateRead()
            .then(changed)
            .catch(() => {
              hardLock()
              autoAttempt.clear()
              void loadProtection()
            })
        checkLifetime()
        void nextTick(() => {
          delete document.documentElement.dataset.photoBackground
        })
      }
    },
    failure = () => {
      hardLock()
      cryptoError.value =
        'Модуль защиты перезапущен. Разблокируйте фотографии заново.'
    },
    restoredIdentity = () => {
      if(appLocked.value)return
      if(strongUnlocked.value)void authenticateRead().then(changed).catch(()=>{hardLock();resumeTrustedPhotos()})
      else resumeTrustedPhotos()
    },
    online = () => {
      autoAttempt.clear()
      void loadProtection()
    },
    show = () => {
      void loadProtection()
      void nextTick(() => {
        delete document.documentElement.dataset.photoBackground
      })
    }
  window.addEventListener('pagehide', hide)
  window.addEventListener('pageshow', show)
  window.addEventListener('online', online)
  window.addEventListener('photobunker-identity-restored', restoredIdentity)
  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('photobunker-photo-crypto-failed', failure)
  for (const event of ['pointerdown', 'keydown'])
    window.addEventListener(event, touch, { passive: true })
  return () => {
    stop()
    window.removeEventListener('pagehide', hide)
    window.removeEventListener('pageshow', show)
    window.removeEventListener('online', online)
    window.removeEventListener('photobunker-identity-restored', restoredIdentity)
    document.removeEventListener('visibilitychange', visibility)
    window.removeEventListener('photobunker-photo-crypto-failed', failure)
    for (const event of ['pointerdown', 'keydown'])
      window.removeEventListener(event, touch)
    hardLock(false)
  }
}

export async function beginRotation() {
  if (!photoReadAllowed() || !keyState.value.document)
    throw new Error('crypto.locked')
  const current = keyState.value.document,
    created = await cryptoCall<{
      record: KeyRecord
      bundle: RecoveryBundle
      signature: string
      kit: string
    }>('rotate', { document: current })
  staged = {
    enabled: true,
    document: {
      ...current,
      record: created.record,
      signature: created.signature,
    },
    bundle: created.bundle,
  }
  rotating = true
  candidateKit.value = created.kit
}

export type LinkRequest = {
  version: 1
  id: string
  accountId: string
  deviceId: string
  publicKey: string
  nonce: string
  expiresAt: number
}
export const linkRequest = shallowRef<LinkRequest>()
export async function startLink() {
  await ready()
  const pair = await cryptoCall<{ publicKey: string }>('pair-start', {})
  linkRequest.value = await request<LinkRequest>('/links', 'POST', pair)
}
export async function approveLink(id: string, fingerprint: string) {
  if (
    !photoReadAllowed() ||
    !/^[-a-f0-9]{36}$/.test(id) ||
    !/^[-_A-Za-z0-9]{43}$/.test(fingerprint.trim())
  )
    throw new Error('crypto.link_mismatch')
  const value = await request<{ request: LinkRequest }>(`/links/${id}`)
  if (
    value.request.accountId !== scope() ||
    value.request.expiresAt <= Date.now() ||
    value.request.deviceId === deviceId.value ||
    hash(canonical(value.request)) !== fingerprint.trim()
  )
    throw new Error('crypto.link_mismatch')
  const trust = (
    await Promise.all(
      ['pin:', 'vault:', 'revision:'].map((prefix) =>
        db.entries(prefix + scope() + ':'),
      ),
    )
  ).flat()
  const response = await cryptoCall('pair-send', {
    request: value.request,
    trust,
  })
  await request(`/links/${id}`, 'PUT', { response: canonical(response) })
}
export function linkFingerprint() {
  return linkRequest.value ? hash(canonical(linkRequest.value)) : ''
}
export async function receiveLink() {
  const current = linkRequest.value
  if (
    !current ||
    current.expiresAt <= Date.now() ||
    current.accountId !== scope() ||
    current.deviceId !== deviceId.value
  )
    throw new Error('crypto.link_expired')
  const value = await request<{ request: LinkRequest; response: unknown }>(
    `/links/${current.id}`,
  )
  if (canonical(value.request) !== canonical(current) || !value.response)
    throw new Error('Подтвердите подключение на открытом устройстве.')
  const opened = await cryptoCall<{
    kit: string
    trust: { key: string; value: unknown }[]
  }>('pair-open', {
    request: current,
    response: value.response,
    document: keyState.value.document,
    bundle: keyState.value.bundle,
  })
  if (!Array.isArray(opened.trust) || opened.trust.length > 2000)
    throw new Error('crypto.invalid_trust')
  const merged: { key: string; value: Record<string, unknown> }[] = []
  for (const entry of opened.trust) {
    if (
      !entry ||
      typeof entry.key !== 'string' ||
      !['pin:', 'vault:', 'revision:'].some((prefix) =>
        entry.key.startsWith(prefix + scope() + ':'),
      ) ||
      entry.key.length > 150 ||
      !entry.value ||
      typeof entry.value !== 'object' ||
      Array.isArray(entry.value)
    )
      throw new Error('crypto.invalid_trust')
    const current = await db.get<Record<string, unknown>>(entry.key),
      incoming = entry.value as Record<string, unknown>
    const rank = (value: Record<string, unknown>) =>
      Number(value.revision ?? value.epoch ?? 0)
    if (!Number.isSafeInteger(rank(incoming)) || rank(incoming) < 0)
      throw new Error('crypto.invalid_trust')
    if (current) {
      for (const field of ['fingerprint', 'rootKey', 'submissionHash'])
        if (
          current[field] &&
          incoming[field] &&
          current[field] !== incoming[field]
        )
          throw new Error('crypto.key_changed')
      if (rank(current) === rank(incoming))
        for (const field of ['documentHash', 'membershipHash'])
          if (
            current[field] &&
            incoming[field] &&
            current[field] !== incoming[field]
          )
            throw new Error('crypto.rollback')
      if (current.deleted === true) continue
      if (incoming.deleted !== true && rank(current) > rank(incoming)) continue
      if (entry.key.startsWith('revision:')) {
        const a = current.objects as
            | Record<string, { revision: number; statementHash: string }>
            | undefined,
          b = incoming.objects as typeof a
        const objects = { ...a }
        for (const [kind, observed] of Object.entries(b ?? {})) {
          const prior = objects[kind]
          if (
            prior &&
            prior.revision === observed.revision &&
            prior.statementHash !== observed.statementHash
          )
            throw new Error('crypto.rollback')
          if (!prior || observed.revision > prior.revision)
            objects[kind] = observed
        }
        incoming.objects = objects
        if (
          typeof current.expiresAt === 'number' &&
          typeof incoming.expiresAt === 'number'
        )
          incoming.expiresAt = Math.min(current.expiresAt, incoming.expiresAt)
      }
    }
    merged.push({ key: entry.key, value: incoming })
  }
  for (const entry of merged) await db.put(entry.key, entry.value)

  candidateKit.value = opened.kit
  staged = keyState.value
  rotating = false
  linkRequest.value = undefined
  await request(`/links/${current.id}`, 'DELETE')
}

export function resumeTrustedPhotos() {
  autoAttempt.clear()
  void loadProtection()
}
