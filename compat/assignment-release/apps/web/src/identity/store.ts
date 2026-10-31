import { ref } from 'vue'
import { emergencyBarrierActive } from '../app/emergency-barrier'
import { identityRequest, IdentityError, bindIdentity } from './api'
import {
  credentials,
  forgetCredentials,
  automaticDeviceName,
  onboardingDevice,
  completeOnboardingDevice,
  reconcileOnboardingDevice,
  parseKit,
  prove,
  type DeviceCredential,
} from './keys'
export type ProfileField =
  | 'name'
  | 'username'
  | 'email'
  | 'phone'
  | 'links'
  | 'about'
export type Account = {
  id: string
  publicId: string
  rootKey?: string
  username?: string | null
  fields: Record<ProfileField, string>
  visibility: Record<ProfileField, 'private' | 'contacts' | 'public'>
  revision: number
  matrix: { state: 'pending' | 'ready'; userId: string | null }
}
type Session = { account: Account; deviceId: string; expiresAt: number | null }
export type Person = {
  publicId: string
  username?: string | null
  fields: Partial<Record<ProfileField, string>>
  self: boolean
  blocked?: boolean
  relationship: null | {
    id: string
    state: 'pending' | 'accepted' | 'rejected' | 'removed'
    incoming: boolean
  }
}
export type SessionState =
  | 'initial' | 'checking' | 'authenticated' | 'offline'
  | 'signed-out' | 'unavailable' | 'revoked'

export const account = ref<Account>(),
  sessionState = ref<SessionState>('initial'),
  identityReady = ref(false),
  identityUnavailable = ref(false),
  offlineCaptureIdentity = ref(false),
  publicCaptureUnknown = ref(false),
  deviceId = ref(''),
  localDevices = ref<DeviceCredential[]>([]),
  sessionNotice = ref(false),
  profileSaved = ref(false),
  signingOut = ref(false)

let loading: Promise<void> | undefined
let generation = 0, refreshRequested = false, retryCount = 0
let bootstrapStarted = false
let retryTimer: ReturnType<typeof setTimeout> | undefined
const MAX_AUTOMATIC_RETRIES = 2
const channel =
  typeof window !== 'undefined' && typeof BroadcastChannel === 'function'
    ? new BroadcastChannel('photobunker-identity-v1')
    : undefined

function changed() { window.dispatchEvent(new Event('photobunker-identity')) }
function cancelRetry() {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = undefined
}
function clear(invalidate = true, removeCapture = true) {
  profileSaved.value = false
  if (invalidate) generation++
  account.value = undefined
  offlineCaptureIdentity.value = false
  publicCaptureUnknown.value = false
  if (removeCapture)
    void import('../crypto/database').then(db => db.remove('capture-current')).catch(() => {})
  deviceId.value = ''
  bindIdentity('')
  changed()
}
function accept(value: Session) {
  if (emergencyBarrierActive()) return
  if (account.value?.id !== value.account.id || deviceId.value !== value.deviceId)
    generation++
  localStorage.setItem('pb-active-device', value.deviceId)
  offlineCaptureIdentity.value = false
  account.value = value.account
  deviceId.value = value.deviceId
  bindIdentity(value.account.id)
  changed()
  // A scoped capture descriptor is not an authentication credential.
  const owner = value.account.id, device = value.deviceId, epoch = generation
  void import('../crypto/database')
    .then(async db => {
      if (epoch === generation && account.value?.id === owner && deviceId.value === device)
        await db.put('capture-current', { accountId: owner, publicId: value.account.publicId, deviceId: device })
    }).catch(() => {})
}
function markAuthenticated(value: Session) {
  if (emergencyBarrierActive()) return
  cancelRetry()
  retryCount = 0
  sessionState.value = 'authenticated'
  identityReady.value = true
  identityUnavailable.value = false
  sessionNotice.value = false
  accept(value)
}
let forgetting: Promise<void> | undefined
async function forgetLocalAccountAccess() {
  if (forgetting) return forgetting
  forgetting = (async () => {
    await forgetCredentials()
    ;(await import('../server/api')).forgetLegacyLibraryAccess()
    const db = await import('../crypto/database')
    const keys = await db.entries('account-key:'), photos = await db.entries('trusted:'), imports = await db.entries('account-photo-import:')
    await Promise.all([...keys, ...photos, ...imports].map(row => db.remove(row.key)))
    await (await import('../messages/keys')).forgetMessageStorage()
    localDevices.value = []
  })().finally(() => { forgetting = undefined })
  return forgetting
}
async function knownDevice(): Promise<DeviceCredential | undefined> {
  const epoch = generation
  const devices = await credentials()
  if (epoch !== generation) return
  const active = localStorage.getItem('pb-active-device') ??
    (await (await import('../crypto/database')).get<{ deviceId: string }>('capture-current'))?.deviceId
  if (epoch !== generation) return
  localDevices.value = devices
  return devices.find(d => d.id === active && !!d.publicId && !d.privateKey.extractable)
}
function scheduleRetry() {
  if (retryCount >= MAX_AUTOMATIC_RETRIES || !navigator.onLine ||
      localStorage.getItem('pb-signed-out') === 'true') return
  const index = retryCount++
  cancelRetry()
  retryTimer = setTimeout(() => {
    retryTimer = undefined
    if (!signingOut.value && (sessionState.value === 'unavailable' || sessionState.value === 'offline'))
      void loadIdentity(true)
  }, Math.min(2000 * 2 ** index, 12000))
}
async function markTemporaryFailure(epoch: number) {
  if (epoch !== generation) return
  identityUnavailable.value = true
  try {
    const device = await knownDevice()
    if (epoch !== generation) return
    if (device && account.value?.id && deviceId.value === device.id && account.value.publicId === device.publicId) {
      offlineCaptureIdentity.value = true
      sessionState.value = 'offline'
    } else if (device && !account.value) {
      await restorePublicCaptureIdentity(true)
      if (epoch !== generation) return
      sessionState.value = offlineCaptureIdentity.value ? 'offline' : 'unavailable'
    } else sessionState.value = 'unavailable'
  } catch { if (epoch === generation) sessionState.value = 'unavailable' }
  if (epoch === generation) scheduleRetry()
}
async function permanentFailure(epoch: number, expired: boolean) {
  if (epoch !== generation) return
  cancelRetry()
  clear()
  sessionState.value = 'revoked'
  identityUnavailable.value = false
  sessionNotice.value = true
  identityReady.value = true
  const revocationEpoch = generation
  void import('../crypto/store').then(photo => {
    if (generation === revocationEpoch && sessionState.value === 'revoked') photo.hardLock()
  }).catch(() => {})
  void import('../messages/store').then(messages => {
    if (generation === revocationEpoch && sessionState.value === 'revoked') messages.stopMessaging()
  }).catch(() => {})
  if (expired) {
    localStorage.setItem('pb-signed-out', 'true')
    await forgetLocalAccountAccess()
  }
}
function handleBroadcast(event: MessageEvent<unknown>) {
  const message = event.data
  if (!message || typeof message !== 'object') return
  const { kind } = message as { kind?: unknown }
  if (kind !== 'logout' && kind !== 'session') return
  // The cookie belongs to the browser origin, not an individual tab.
  // Another tab's logout also invalidates this tab's prior session.
  cancelRetry()
  clear()
  identityReady.value = false
  sessionState.value = 'checking'
  if (loading) refreshRequested = true
  else void loadIdentity(true)
}
channel?.addEventListener('message', handleBroadcast)
if (typeof window !== 'undefined') {
  window.addEventListener('photobunker-identity-expired', () => {
    if (sessionState.value === 'authenticated' && !signingOut.value && !loading)
      void loadIdentity(true)
  })
}

/** The app shell must not await network/bootstrap. */
export function startIdentityBootstrap() {
  if (emergencyBarrierActive() || bootstrapStarted) return
  bootstrapStarted = true
  // Speculative local context can permit capture but never authenticates API.
  void restorePublicCaptureIdentity(true).catch(() => {})
  void loadIdentity()
}
export function hasConfirmedIdentity() {
  return sessionState.value === 'authenticated' && !!account.value && !offlineCaptureIdentity.value
}
export function loadIdentity(force = false): Promise<void> {
  if(emergencyBarrierActive())return Promise.resolve()
  if (signingOut.value) return Promise.resolve()
  if (localStorage.getItem('pb-signed-out') === 'true') {
    if (sessionState.value === 'signed-out' && identityReady.value) return Promise.resolve()
    cancelRetry()
    // A scoped local wipe owns capture-current cleanup. Do not schedule a
    // delayed unscoped deletion that could hit a newly selected account B.
    clear(true, localStorage.getItem('pb-local-delete-signed-out') !== 'true')
    sessionState.value = 'signed-out'
    identityReady.value = true
    identityUnavailable.value = false
    // R1-07 wiped ONLY a single account/device with its own durable journal.
    // Broad legacy logout cleanup here would erase another account's keys.
    if (localStorage.getItem('pb-local-delete-signed-out') === 'true')
      return Promise.resolve()
    return forgetLocalAccountAccess()
  }
  if (loading) {
    // Concurrent callers share this check. Only a real cross-tab session
    // invalidation queues another epoch; ordinary force callers must not loop.
    return loading
  }
  if (identityReady.value && !force) return Promise.resolve()
  const epoch = generation
  if (!hasConfirmedIdentity() && sessionState.value !== 'offline') {
    identityReady.value = false
    sessionState.value = 'checking'
  }
  const job = (async () => {
    try {
      const result = await identityRequest<Session>('/me')
      if (epoch !== generation) return
      await reconcileOnboardingDevice(result.deviceId, result.account.publicId)
      if (epoch === generation) markAuthenticated(result)
    } catch (error) {
      if (epoch !== generation) return
      if (error instanceof IdentityError && error.status === 410) {
        await permanentFailure(epoch, true)
      } else if (error instanceof IdentityError && error.status === 401) {
        let device: DeviceCredential | undefined
        try { device = await knownDevice() }
        catch { await markTemporaryFailure(epoch); return }
        if (epoch !== generation) return
        if (!device) {
          clear()
          sessionState.value = 'signed-out'
          identityReady.value = true
          identityUnavailable.value = false
        } else {
          try {
            const session = await prove<Session>({
              purpose: 'login', publicId: device.publicId,
              deviceId: device.id, name: device.name,
            }, device.privateKey)
            if (epoch !== generation) return
            markAuthenticated(session)
            window.dispatchEvent(new Event('photobunker-identity-restored'))
          } catch (failure) {
            if (epoch !== generation) return
            if (failure instanceof IdentityError && failure.status === 410)
              await permanentFailure(epoch, true)
            else if (failure instanceof IdentityError && [401, 403, 409].includes(failure.status))
              await permanentFailure(epoch, false)
            else await markTemporaryFailure(epoch)
          }
        }
      } else {
        // A 403 Origin policy or 409 conflict is not proof that the account
        // was deleted; only verified device proof denial / 410 is terminal.
        await markTemporaryFailure(epoch)
      }
    } finally {
      if (epoch === generation) identityReady.value = true
      loading = undefined
      const queued = refreshRequested
      refreshRequested = false
      if (queued && !signingOut.value && localStorage.getItem('pb-signed-out') !== 'true')
        void loadIdentity(true)
    }
  })()
  loading = job
  return job
}

function authenticated(result: Session) {
  if(emergencyBarrierActive())return
  localStorage.removeItem('pb-local-delete-signed-out')
  localStorage.removeItem('pb-signed-out')
  profileSaved.value = false
  sessionNotice.value = false
  generation++
  markAuthenticated(result)
  channel?.postMessage({ kind: 'session', accountId: result.account.id })
}
function assertLoginEpoch(epoch: number) {
  if (epoch !== generation || signingOut.value)
    throw new DOMException('Account changed during sign-in', 'AbortError')
}
async function withSignIn(action: (epoch: number) => Promise<void>) {
  if (forgetting) await forgetting
  // An explicit sign-in supersedes older /me checks, including a late guest
  // 401 that must not invalidate the device proof currently being submitted.
  const epoch = ++generation
  cancelRetry()
  try { await action(epoch) }
  catch (error) {
    if (epoch === generation && !hasConfirmedIdentity()) {
      sessionState.value = account.value && offlineCaptureIdentity.value ? 'offline' : 'signed-out'
      identityReady.value = true
    }
    throw error
  }
}
export async function register(
  root: { privateKey: CryptoKey; publicKey: string },
  name = automaticDeviceName(),
) {
  return withSignIn(async epoch => {
  if (hasConfirmedIdentity() && account.value?.rootKey === root.publicKey && deviceId.value) {
    assertLoginEpoch(epoch)
    return
  }
  const device = await onboardingDevice(root.publicKey, name)
  assertLoginEpoch(epoch)
  const result = await prove<Session>(
    {
      purpose: 'register',
      rootKey: root.publicKey,
      deviceId: device.id,
      deviceKey: device.publicKey,
      name: device.name,
    },
    root.privateKey,
  )
  assertLoginEpoch(epoch)
  await completeOnboardingDevice(root.publicKey, device, result.account.publicId)
  assertLoginEpoch(epoch)
  authenticated(result)
  })
}
export async function recover(kit: string, name = automaticDeviceName(), resetAppPin = false) {
  return withSignIn(async epoch => {
  const root = await parseKit(kit)
  if (!resetAppPin && hasConfirmedIdentity() && account.value?.rootKey === root.publicKey && deviceId.value) {
    assertLoginEpoch(epoch)
    return
  }
  // Reset requires a fresh online root-key challenge/proof. An already-active
  // cookie or a local comparison of PB1 public keys is NOT evidence of proof.
  const priorOwner = account.value?.id, priorDevice = deviceId.value
  const device = await onboardingDevice(root.publicKey, name)
  assertLoginEpoch(epoch)
  const result = await prove<Session>(
    {
      purpose: 'recover',
      rootKey: root.publicKey,
      deviceId: device.id,
      deviceKey: device.publicKey,
      name: device.name,
    },
    root.privateKey,
  )
  assertLoginEpoch(epoch)
  await completeOnboardingDevice(root.publicKey, device, result.account.publicId)
  assertLoginEpoch(epoch)
  if (resetAppPin && priorOwner === result.account.id && priorDevice) {
    // Proven PB1 identity, successful server session and completed device
    // onboarding are mandatory before resetting only the old device verifier.
    await (await import('../app/lock')).resetAppPinAfterRecovery(result.account.id, priorDevice)
    assertLoginEpoch(epoch)
  }
  authenticated(result)
  })
}
export async function login(device: DeviceCredential) {
  return withSignIn(async epoch => {
  const result = await prove<Session>(
    {
      purpose: 'login',
      publicId: device.publicId,
      deviceId: device.id,
      name: device.name,
    },
    device.privateKey,
  )
  assertLoginEpoch(epoch)
  authenticated(result)
  })
}
export async function logout() {
  signingOut.value=true
  const previousAccount = account.value?.id,
    previousDevice = deviceId.value
  localStorage.setItem(
    'pb-trust-revoked:' + `trusted:${previousAccount}:${previousDevice}`,
    'true',
  )
  localStorage.setItem('pb-signed-out', 'true')
  localStorage.removeItem('pb-active-device')
  localDevices.value = []
  cancelRetry()
  clear()
  sessionState.value = 'signed-out'
  identityReady.value = true
  identityUnavailable.value = false
  const messaging = await import('../messages/store')
  messaging.stopMessaging()
  const photoSecurity = await import('../crypto/store')
  photoSecurity.hardLock()
  sessionNotice.value = false
  publicCaptureUnknown.value = false
  channel?.postMessage({ kind: 'logout', accountId: previousAccount })
  try {
    await identityRequest('/session', 'DELETE', undefined, previousAccount)
  } finally {
    try {
      const db = await import('../crypto/database')
      const cleanup: Promise<unknown>[] = [
        db.remove('capture-current').catch(() => {}),
        forgetLocalAccountAccess(),
      ]
      if (previousAccount && previousDevice) {
        cleanup.push(db.remove(`trusted:${previousAccount}:${previousDevice}`).catch(() => {}))
        cleanup.push(import('../messages/durable-outbox')
          .then(outbox => outbox.eraseDurableOutbox(previousAccount, previousDevice)))
        cleanup.push(import('../workspace/team-local')
          .then(local => local.eraseTeamCache(previousAccount, previousDevice)).catch(() => {}))
        cleanup.push(import('../photo-browser/cache')
          .then(cache => cache.eraseBrowsersForAccount(previousAccount, previousDevice)).catch(() => {}))
        cleanup.push(import('../local/photo-names')
          .then(names => names.purgeNames(previousAccount, previousDevice)).catch(() => {}))
        cleanup.push(import('../crypto/card-share-outbox')
          .then(shares => shares.purgeCardShareIntents(previousAccount, previousDevice)).catch(() => {}))
        cleanup.push(import('../profiles/presence')
          .then(presence => presence.erasePresencePreferences(previousAccount, previousDevice)).catch(() => {}))
      }
      await Promise.all(cleanup)
    } finally {
      localDevices.value = []
      signingOut.value=false
    }
  }
}

export async function saveProfile(value: Account) {
  const result = await identityRequest<Account>('/profile', 'PATCH', {
    accountId: value.id,
    revision: value.revision,
    fields: value.fields,
    visibility: value.visibility,
  })
  if (account.value?.id === result.id) {
    generation++
    account.value = result
    profileSaved.value = true
  }
}
export async function connectMatrix() {
  return identityRequest<{
    userId: string
    deviceId: string
    accessToken: string
    baseUrl: string
  }>('/matrix/session', 'POST')
}

// Restoring a public capture identity grants no login or photo-read capability.
// Every later upload is checked against the live Identity session and epoch.
export async function restorePublicCaptureIdentity(warm = false) {
  if(emergencyBarrierActive())return
  if(localStorage.getItem('pb-signed-out')==='true')return
  if (account.value || !identityUnavailable.value && !warm) return
  const epoch = generation
  publicCaptureUnknown.value = true
  const saved = await (
    await import('../crypto/database')
  ).get<{ accountId: string; publicId: string; deviceId: string }>(
    'capture-current',
  )
  if (!saved) {
    publicCaptureUnknown.value = localDevices.value.length > 0
    return
  }
  const known = (await credentials()).find(
    (d) =>
      d.id === saved.deviceId &&
      d.publicId === saved.publicId &&
      !d.privateKey.extractable,
  )
  if (emergencyBarrierActive() || !known || account.value || epoch !== generation || !identityUnavailable.value && !warm) return
  const fields = Object.fromEntries(
      ['name', 'username', 'email', 'phone', 'links', 'about'].map((k) => [
        k,
        '',
      ]),
    ) as Account['fields'],
    visibility = Object.fromEntries(
      Object.keys(fields).map((k) => [k, 'private']),
    ) as Account['visibility']
  account.value = {
    id: saved.accountId,
    publicId: saved.publicId,
    fields,
    visibility,
    revision: 0,
    matrix: { state: 'pending', userId: null },
  }
  deviceId.value = saved.deviceId
  offlineCaptureIdentity.value = true
  // This is an expected-account header, not authentication. Keep the local
  // scope on every background request so another tab's cookie cannot load a
  // different account's workspace into this local account before /me resolves.
  bindIdentity(saved.accountId)
  changed()
}
if (typeof window !== 'undefined')
  window.addEventListener('online', () => {
    cancelRetry()
    retryCount = 0
    if (sessionState.value === 'offline' || sessionState.value === 'unavailable')
      void loadIdentity(true)
  })
/** D4 local-device wipe: invalidate reactive login without touching any
 * other account's credentials, cloud objects, or remote devices.
 * Called only after the durable journal and signed-out marker are committed.
 */
export function invalidateLocalDeleteSession(owner: string, device: string) {
  if(account.value?.id !== owner || deviceId.value !== device) return
  cancelRetry()
  // Do not let a delayed, unscoped capture-current deletion erase account B.
  // D4's journal-owned cleanup examines the captured account/device explicitly.
  clear(true, false)
  sessionState.value='signed-out'
  identityReady.value=true
  identityUnavailable.value=false
  // The separate local-delete channel locks sibling tabs without starting
  // the generic logout's global credential-cleanup path.
}
