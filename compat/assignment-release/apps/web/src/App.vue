<script setup lang="ts">
import {
  appLockReady,
  appLockFailure,
  appLocked,
  appPinEnabled,
  appPinLength,
  loadAppLock,
  lockApp,
  unlockApp,
  recordFailedEmergencyConfirmation,
} from './app/lock'
import { hardLock, resumeTrustedPhotos } from './crypto/store'
import { pt, pinError } from './app/pin-text'
import { deviceId, sessionState, offlineCaptureIdentity, hasConfirmedIdentity, loadIdentity, startIdentityBootstrap } from './identity/store'
import { q } from './crypto/text'
import { deletionBlocked, deletionFailure, deletionPhase, resumeLocalDeletion } from './app/local-delete-run'
import { localDeleteText } from './app/local-delete-text'
import { emergencyBlocked,emergencyChecked,tryEmergencyOnLockedScreen } from './app/emergency-run'
import { emergencyManualEntry, emergencyPinLength, loadLockedEmergencyPinLength, matchesLockedEmergencyFirstHalf } from './app/emergency'
import AccountPhotoAccess from './components/AccountPhotoAccess.vue'
import {
  startProtection,
  protectionEnabled,
  protectionReady,
  photoReadAllowed,
  strongUnlocked,
  warmLocked,
} from './crypto/store'
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { c } from './collaboration/text'
import { account } from './identity/store'
import { profileReturnTo } from './identity/person'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from './components/AppIcon.vue'
import PasscodeInput from './components/PasscodeInput.vue'
import { locale, t } from './i18n'
import { localPrototype } from './local/photos'
import { libraryError, libraryLoading, serverError, startLibrary } from './local/library'
import { p } from './profiles/text'
import { delivery, startDelivery } from './delivery/queue'
import { accessCode, accessSaved } from './server/api'
import { u } from './app/text'
import { lockDelayMs, rememberSection } from './app/preferences'
import { a } from './identity/text'
import { s } from './studio/text'
import { startWorkspace } from './workspace/service'
import {
  pendingCount as workspacePending,
  queueBusy as workspaceBusy,
  queueError as workspaceError,
} from './workspace/state'
import { startStudio } from './studio/store'
import { startActivity } from './identity/activity'
import { purgeAccountFromDevice } from './identity/storage'
import { locationEnabled, startGrantedLocation, stopLocation } from './profiles/location'
import { warmNames } from './local/photo-names'
import { flushCardShares } from './crypto/card-share-outbox'
import { initializePresencePreference, refreshPresenceHeartbeat, stopPresenceHeartbeat,
  stopPresencePreference } from './profiles/presence'
import { appStatusKey, type AppStatus } from './app/status'

const route = useRoute(),
  router = useRouter()

// Card intents are replayed by the app shell even if the owner has left the
// private Photo Card page. Only a confirmed session and open photo PIN gate
// permit contacting the server.
function reconnectCardShares() {
  // The guest /c route must never initiate the previous account's private
  // cache/outbox workflow.
  if (route.name === 'shared-card') return
  if (hasConfirmedIdentity() && photoReadAllowed() && !appLocked.value &&
      navigator.onLine) void flushCardShares().catch(() => {})
}
watch([sessionState, appLocked, protectionReady, strongUnlocked, warmLocked], reconnectCardShares)
// Gallery and Browser always render their own stable shell and skeletons.
// Only a concrete private photo needs the blocking decryption gate.
const privatePhotoRoute = computed(() =>
  ['photo', 'photo-card', 'photo-editor'].includes(String(route.name)),
)
const openRoute = computed(() =>
  ['shared-photo', 'shared-card', 'welcome', 'profile', 'account-auth', 'person-profile'].includes(String(route.name)),
)
const offlineLocalRoute = computed(() =>
  // A known non-extractable device may display its own encrypted outbox, but
  // this offline scope NEVER grants an API/Matrix session or bypasses PIN.
  ['assignments', 'assignment', 'camera', 'gallery', 'photo', 'photo-card',
    'photo-editor', 'photo-browser', 'photo-browser-new', 'people', 'teams',
    'team-profile', 'contacts', 'profiles', 'profile-edit', 'messages',
    'profile', 'settings', 'payment', 'status'].includes(String(route.name)),
)
const privatePending = computed(() =>
  !openRoute.value && !hasConfirmedIdentity() &&
  !((sessionState.value === 'offline' || sessionState.value === 'checking') && offlineCaptureIdentity.value && !!account.value && offlineLocalRoute.value),
)
const showScopedLocal = computed(() =>
  hasConfirmedIdentity() ||
  (offlineCaptureIdentity.value && !!account.value && offlineLocalRoute.value &&
   (sessionState.value === 'offline' || sessionState.value === 'checking')),
)
const privateMessage = computed(() =>
  sessionState.value === 'initial' || sessionState.value === 'checking' ? a('sessionChecking')
    : sessionState.value === 'unavailable' ? a('sessionNetwork')
    : sessionState.value === 'offline' ? a('sessionOffline')
    : sessionState.value === 'revoked' ? a('sessionRevoked')
    : a('sessionSignedOut'),
)

const appPin = ref(''),
  appPinError = ref(''),
  appPinOpening = ref(false)

// Complete N-digit segments are queued instantly; PBKDF2 never drops rapid input.
const pendingPinParts: string[] = []
let drainingPin = false
let emergencyFirstPart = ''
let pinInputGeneration = 0
function resetPinEntry() {
  pinInputGeneration++
  pendingPinParts.length = 0
  emergencyFirstPart = ''
  appPin.value = ''
}
function onPinPart(part: string) {
  if (!appLockReady.value || !appLocked.value || emergencyManualEntry.value ||
      part.length !== appPinLength.value) return
  if (pendingPinParts.length >= 16) {
    appPinError.value = pinError(new Error('pin.wrong'))
    return
  }
  pendingPinParts.push(part)
  void drainPinParts()
}
async function drainPinParts() {
  if (drainingPin) return
  drainingPin = true
  const generation = pinInputGeneration
  try {
    while (pendingPinParts.length && generation === pinInputGeneration && appLocked.value) {
      const part = pendingPinParts.shift()!
      appPinError.value = ''
      if (emergencyFirstPart) {
        const fullCode = emergencyFirstPart + part
        emergencyFirstPart = ''
        const triggered = await tryEmergencyOnLockedScreen(fullCode).catch(() => false)
        if (generation !== pinInputGeneration) break
        if (triggered) { pendingPinParts.length = 0; break }
        try {
          await recordFailedEmergencyConfirmation()
          appPinError.value = pinError(new Error('pin.wrong'))
        } catch(error) { appPinError.value = pinError(error) }
        continue
      }
      try {
        const firstPartMatched = await matchesLockedEmergencyFirstHalf(part)
        if (generation !== pinInputGeneration || !appLocked.value) break
        if (firstPartMatched) {
          emergencyFirstPart = part
          continue
        }
        await unlockApp(part)
      } catch (error) {
        if (generation === pinInputGeneration) appPinError.value = pinError(error)
      }
    }
  } finally {
    drainingPin = false
    if (pendingPinParts.length && appLocked.value && generation === pinInputGeneration)
      void drainPinParts()
  }
}
/** Old emergency registrations retain explicit Submit until reconfigured. */
async function openApp() {
  if (!emergencyManualEntry.value || appPinOpening.value || appPin.value.length < 4) return
  const pin = appPin.value
  appPinError.value = ''
  appPinOpening.value = true
  try {
    await unlockApp(pin)
  } catch (error) {
    const triggered = await tryEmergencyOnLockedScreen(pin).catch(() => false)
    if (!triggered) appPinError.value = pinError(error)
  } finally {
    appPin.value = ''
    appPinOpening.value = false
  }
}
watch(
  () => `${account.value?.id}:${deviceId.value}`,
  () => {
    resetPinEntry()
    void loadAppLock()
  },
  { immediate: true },
)
watch([() => account.value?.id, deviceId, appLocked], ([owner, device, locked]) => {
  if (owner && device && locked) void loadLockedEmergencyPinLength()
}, { immediate: true })
watch([appLockReady, appLocked], ([ready, locked]) => {
  if (!ready || locked) {
    // Synchronous cleanup before any protected Vue view can paint.
    hardLock()
    void import('./messages/store').then(module => module.stopMessaging())
    resetPinEntry()
  } else { resetPinEntry(); resumeTrustedPhotos() }
}, { flush: 'sync' })
function updatePrivatePresence() {
  if (backgroundReady.value && hasConfirmedIdentity() && appLockReady.value &&
      !appLocked.value && !hidden.value &&
      !['welcome','shared-photo','shared-card','account-auth'].includes(String(route.name)))
    refreshPresenceHeartbeat()
  else stopPresenceHeartbeat()
}
const hiddenAtKey = 'photobunker.app-hidden-at.v1'
let appLockTimer: number | undefined
function clearAppLockTimer() {
  if (appLockTimer !== undefined) window.clearTimeout(appLockTimer)
  appLockTimer = undefined
}
function clearHiddenAt() {
  try { sessionStorage.removeItem(hiddenAtKey) } catch { /* unavailable storage must not block locking */ }
}
function savedHiddenAt(): number {
  try { return Number(sessionStorage.getItem(hiddenAtKey) ?? 0) || 0 } catch { return 0 }
}
function lockAfterBackground() {
  clearAppLockTimer()
  clearHiddenAt()
  lockApp()
}
function scheduleBackgroundLock() {
  if (!appPinEnabled.value || appLocked.value) return
  const now = Date.now(), delay = lockDelayMs.value
  try { sessionStorage.setItem(hiddenAtKey, String(now)) } catch { /* timer remains authoritative */ }
  clearAppLockTimer()
  if (delay === 0) lockAfterBackground()
  else appLockTimer = window.setTimeout(lockAfterBackground, delay)
}
function resumeBackgroundLock() {
  if (!appPinEnabled.value || appLocked.value) { clearAppLockTimer(); clearHiddenAt(); return }
  const hiddenAt = savedHiddenAt()
  clearAppLockTimer()
  if (hiddenAt && Date.now() - hiddenAt >= lockDelayMs.value) lockAfterBackground()
  else clearHiddenAt()
}
function backgroundLock() {
  if (document.hidden) scheduleBackgroundLock()
  else resumeBackgroundLock()
}
function pageHidden() { scheduleBackgroundLock() }
function pageShown() { resumeBackgroundLock(); locationPageShow() }
function retrySession() { void loadIdentity(true) }
const offline = ref(!navigator.onLine)
const appStatus = computed<AppStatus>(() => {
  const ru = locale.value === 'ru'
  if (offline.value) return {
    label: ru ? 'Офлайн' : 'Offline',
    detail: ru ? 'Работаем с данными на устройстве' : 'Using data stored on this device',
    tone: 'warning',
  }
  if (sessionState.value === 'checking') return {
    label: ru ? 'Подключение' : 'Connecting',
    detail: ru ? 'Проверяем защищённое подключение' : 'Checking the secure connection',
    tone: 'progress',
  }
  if (libraryError.value || serverError.value || workspaceError.value || delivery.value.storageFailed)
    return {
      label: ru ? 'Нужна проверка' : 'Check status',
      detail: ru ? 'Часть данных не удалось обновить' : 'Some data could not be refreshed',
      tone: 'error',
    }
  if (libraryLoading.value) return {
    label: ru ? 'Обновление' : 'Updating',
    detail: ru ? 'Обновляем библиотеку в фоне' : 'Refreshing the library in the background',
    tone: 'progress',
  }
  const pending = delivery.value.pending + delivery.value.deleting + workspacePending.value
  if (delivery.value.busy || workspaceBusy.value) return {
    label: ru ? 'Отправка' : 'Syncing',
    detail: ru ? `В очереди: ${pending}` : `Queued: ${pending}`,
    tone: 'progress',
  }
  if (pending) return {
    label: ru ? `В очереди ${pending}` : `Queued ${pending}`,
    detail: ru ? 'Фотографии сохранены на устройстве и будут отправлены автоматически' : 'Photos are safe on this device and will upload automatically',
    tone: 'warning',
  }
  return null
})
provide(appStatusKey, appStatus)
const main = ref<HTMLElement>()
let stopDelivery: (() => void) | undefined
let stopProtection: (() => void) | undefined
let stopLibrary: (() => void) | undefined
let stopWorkspace: (() => void) | undefined
let stopStudio: (() => void) | undefined
let stopActivity: (() => void) | undefined
let backgroundTimer: number | undefined
let mounted = false
let runtimeStarted = false
const hidden = ref(false)
const backgroundReady = ref(false)
const locationVisible = ref(!document.hidden)
const locationResumeEpoch = ref(0)
function locationVisibilityChanged() { locationVisible.value = !document.hidden }
function locationPageShow() { locationResumeEpoch.value++ }
// R1-01: before Camera mounts, share one GPS watch with all private views.
// Do not start on public Welcome/share or before session + PIN proof.
watch(
  [() => account.value?.id, deviceId, sessionState, offlineCaptureIdentity,
    appLockReady, appLocked, locationEnabled, locationVisible, locationResumeEpoch,
    hidden, () => route.name],
  () => {
    const privatePage = !['welcome', 'shared-photo', 'shared-card', 'account-auth'].includes(String(route.name))
    const scopedIdentity = hasConfirmedIdentity() ||
      (offlineCaptureIdentity.value && ['checking', 'offline'].includes(sessionState.value))
    if (privatePage && scopedIdentity && account.value?.id && deviceId.value &&
        appLockReady.value && !appLocked.value && locationVisible.value &&
        !hidden.value && locationEnabled.value)
      startGrantedLocation(account.value.id + ':' + deviceId.value)
    else stopLocation()
  },
  { immediate: true },
)
// Warm the next NAME-ID lease before Camera is opened. This never requests
// permission and never blocks normal capture or the Welcome screen.
watch([() => account.value?.id, deviceId, sessionState, appLockReady, appLocked,
  () => route.name], () => {
  if (hasConfirmedIdentity() && !appLocked.value && route.name === 'camera')
    void warmNames().catch(() => {})
}, { immediate: true })
function reconnectPhotoNames() {
  if (hasConfirmedIdentity() && !appLocked.value)
    void warmNames().catch(() => {})
}
const native = computed(() =>
  [
    'welcome',
    'camera',
    'gallery',
    'photo',
    'photo-card',
    'photo-editor',
    'profiles',
    'profile-edit',
    'assignments',
    'assignment',
    'assignment-edit',
    'assignment-new',
    'photo-browser',
    'photo-browser-new',
    'people',
    'teams',
    'team-profile',
    'profile',
    'messages',
    'conversation-profile',
    'person-profile',
    'settings',
    'account-auth',
    'account-edit',
    'contacts',
    'account-security',
    'photo-security',
    'data-storage',
    'status',
    'payment',
  ].includes(String(route.name)),
)
const editor = computed(() =>
  [
    'profile-edit',
    'assignment-edit',
    'assignment-new',
    'photo-editor',
    'account-auth',
    'account-edit',
  ].includes(String(route.name)),
)
const navigation = [
  { name: 'assignments', to: '/assignments', icon: 'profiles' },
  { name: 'browser', to: '/browser', icon: 'gallery' },
  { name: 'camera', to: '/camera', icon: 'camera' },
  { name: 'people', to: '/people', icon: 'users' },
  { name: 'profile', to: '/profile', icon: 'settings' },
] as const
const immersive = computed(() => route.name === 'camera')
const navigationSection: Record<string, 'assignments' | 'browser' | 'camera' | 'people' | 'profile'> = {
  assignments: 'assignments',
  assignment: 'assignments',
  browser: 'browser',
  gallery: 'browser',
  photo: 'browser',
  'photo-card': 'browser',
  'photo-editor': 'browser',
  'photo-browser': 'browser',
  'photo-browser-new': 'browser',
  camera: 'camera',
  people: 'people',
  teams: 'people',
  contacts: 'people',
  profile: 'profile',
  settings: 'profile',
  payment: 'profile',
}
function label(name: string) {
  if (name === 'people') return u('peopleDock')
  return u(navigationSection[name] ?? 'camera')
}
const identityTitle = computed(
  () =>
    ({
      'account-auth': a('account'),
      'account-edit': a('editProfile'),
      contacts: a('contacts'),
      'account-security': a('security'),
    })[String(route.name) as 'account-auth'],
)
const title = computed(
  () =>
    identityTitle.value ||
    ([
      'assignments',
      'assignment',
      'assignment-edit',
      'assignment-new',
    ].includes(String(route.name))
      ? c('tasks')
      : route.name === 'teams' || route.name === 'team-profile'
        ? s('teams')
        : route.name === 'photo-editor'
          ? s('editor')
          : ['photo-browser', 'photo-browser-new'].includes(String(route.name))
            ? s('photoBrowser')
          : route.name === 'team'
            ? c('team')
            : route.name === 'join'
              ? c('join')
              : ['profiles', 'profile-edit'].includes(String(route.name))
                ? p('profiles')
                : route.name === 'settings'
                  ? t('settings')
                  : route.name === 'photo-card'
                    ? u('photos')
                  : route.name === 'photo'
                    ? u('photos')
                    : label(String(route.name))),
)

function updateConnection() {
  offline.value = !navigator.onLine
}
function privacy(event: Event) {
  hidden.value = !!(event as CustomEvent<boolean>).detail
  updatePrivatePresence()
}
watch([() => account.value?.id, deviceId, sessionState, appLockReady, appLocked,
  hidden, backgroundReady, () => route.name], updatePrivatePresence, { immediate: true })
watch([() => account.value?.id, deviceId, sessionState, appLockReady, appLocked,
  backgroundReady],
  ([id,device]) => {
    if (backgroundReady.value && id && device && appLockReady.value && !appLocked.value &&
        (hasConfirmedIdentity() || (sessionState.value==='offline' && offlineCaptureIdentity.value)))
      void initializePresencePreference()
    else stopPresencePreference()
  },{ immediate: true })
function isActive(name: string) {
  return (
    route.name === name ||
    (name === 'browser' && ['photo-browser', 'photo-browser-new', 'gallery',
      'photo', 'photo-card', 'photo-editor'].includes(String(route.name))) ||
    (name === 'camera' &&
      ['profiles', 'profile-edit', 'team'].includes(String(route.name))) ||
    (name === 'people' && ['people', 'teams', 'team-profile', 'contacts',
      'person-profile'].includes(String(route.name))) ||
    (name === 'profile' &&
      [
        'settings',
        'join',
        'account-security',
        'photo-security',
        'account-auth',
        'account-edit',
      ].includes(String(route.name))) ||
    (name === 'assignments' && ['assignment', 'assignment-edit', 'assignment-new'].includes(String(route.name)))
  )
}
function stopBackgroundRuntime() {
  if (backgroundTimer !== undefined) window.clearTimeout(backgroundTimer)
  backgroundTimer = undefined
  backgroundReady.value = false
  stopDelivery?.(); stopDelivery = undefined
  stopWorkspace?.(); stopWorkspace = undefined
  stopActivity?.(); stopActivity = undefined
}
function scheduleBackgroundRuntime() {
  if (!runtimeStarted || backgroundTimer !== undefined || stopDelivery ||
      !account.value || !appLockReady.value || appLocked.value ||
      !(hasConfirmedIdentity() ||
        (sessionState.value === 'offline' && offlineCaptureIdentity.value))) return
  // Authentication, shell, assignments and the local photo index stay on the
  // fast path. Sync, collaboration and activity start just after first paint.
  backgroundTimer = window.setTimeout(() => {
    backgroundTimer = undefined
    if (!runtimeStarted || !account.value || !appLockReady.value || appLocked.value) return
    backgroundReady.value = true
    stopDelivery = startDelivery()
    stopWorkspace = startWorkspace()
    stopActivity = startActivity()
    const deletedOwner = localStorage.getItem('pb-deleted-account-cleanup')
    if (deletedOwner) void purgeAccountFromDevice(deletedOwner)
      .then(() => localStorage.removeItem('pb-deleted-account-cleanup')).catch(() => {})
  }, 5000)
}
function startPrivateRuntime() {
  if (runtimeStarted || emergencyBlocked.value || deletionBlocked.value ||
      route.name === 'shared-photo' || route.name === 'shared-card') return
  runtimeStarted = true
  document.addEventListener('visibilitychange', backgroundLock)
  document.addEventListener('visibilitychange', locationVisibilityChanged)
  document.addEventListener('visibilitychange', updatePrivatePresence)
  window.addEventListener('pagehide', stopPresenceHeartbeat)
  window.addEventListener('pagehide', pageHidden)
  window.addEventListener('pagehide', stopLocation)
  window.addEventListener('pageshow', pageShown)
  stopProtection = startProtection()
  stopLibrary = startLibrary()
  stopStudio = startStudio()
  scheduleBackgroundRuntime()
  window.addEventListener('online', updateConnection)
  window.addEventListener('online', reconnectPhotoNames)
  window.addEventListener('online', updatePrivatePresence)
  window.addEventListener('online', reconnectCardShares)
  window.addEventListener('offline', updateConnection)
  window.addEventListener('offline', updatePrivatePresence)
  window.addEventListener('photobunker-privacy-screen', privacy)
}
function stopPrivateRuntime() {
  if (!runtimeStarted) return
  runtimeStarted = false
  document.removeEventListener('visibilitychange', backgroundLock)
  document.removeEventListener('visibilitychange', locationVisibilityChanged)
  document.removeEventListener('visibilitychange', updatePrivatePresence)
  stopLocation()
  stopPresenceHeartbeat()
  stopPresencePreference()
  stopBackgroundRuntime()
  window.removeEventListener('pagehide', stopPresenceHeartbeat)
  window.removeEventListener('pagehide', pageHidden)
  window.removeEventListener('pagehide', stopLocation)
  window.removeEventListener('pageshow', pageShown)
  clearAppLockTimer()
  stopProtection?.(); stopProtection = undefined
  stopLibrary?.(); stopLibrary = undefined
  stopStudio?.(); stopStudio = undefined
  window.removeEventListener('online', updateConnection)
  window.removeEventListener('online', reconnectPhotoNames)
  window.removeEventListener('online', updatePrivatePresence)
  window.removeEventListener('online', reconnectCardShares)
  window.removeEventListener('offline', updateConnection)
  window.removeEventListener('offline', updatePrivatePresence)
  window.removeEventListener('photobunker-privacy-screen', privacy)
}
watch([() => account.value?.id, sessionState, offlineCaptureIdentity,
  appLockReady, appLocked], () => {
  if (runtimeStarted && account.value && appLockReady.value && !appLocked.value &&
      (hasConfirmedIdentity() ||
        (sessionState.value === 'offline' && offlineCaptureIdentity.value)))
    scheduleBackgroundRuntime()
  else stopBackgroundRuntime()
}, { flush: 'post' })
watch([emergencyBlocked,deletionBlocked, () => route.name], ([emergency,blocked]) => {
  if (!mounted) return
  if (emergency || blocked) stopPrivateRuntime()
  else startPrivateRuntime()
}, { flush: 'sync' })
onMounted(() => {
  mounted = true
  startPrivateRuntime()
})
onBeforeUnmount(() => {
  mounted = false
  stopPrivateRuntime()
})
watch(
  [sessionState, () => route.path, () => route.query.returnTo],
  ([state, path, intended]) => {
    if ((state === 'signed-out' || state === 'revoked') && !openRoute.value) {
      const safe = profileReturnTo(path)
      void router.replace({ path: '/profile', query: safe === '/profile' ? {} : { returnTo: safe } })
    } else if (state === 'authenticated' && path === '/profile' && typeof intended === 'string') {
      const safe = profileReturnTo(intended)
      if (safe !== '/profile') void router.replace(safe)
    }
  },
  { immediate: true },
)
watch(
  [title, locale, () => route.name],
  () => {
    document.title = route.name === 'welcome' ? 'PhotoBunker' : `${title.value} · PhotoBunker`
  },
  { immediate: true },
)
watch(
  () => route.path,
  (path) => {
    hidden.value = false
    rememberSection(path)
    // The mobile workspace is its own scroll surface. Moving focus to it on
    // every dock tap made iOS pan the visual viewport and visibly "jump" the
    // fixed dock. Pointer navigation must only reset workspace scroll; the
    // skip-link remains the explicit keyboard focus affordance.
    const workspace = main.value
    if (!workspace) return
    if (typeof workspace.scrollTo === 'function')
      workspace.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    else {
      workspace.scrollTop = 0
      workspace.scrollLeft = 0
    }
  },
  { flush: 'post' },
)
</script>

<template>
  <section v-if="emergencyBlocked && emergencyChecked" class="native-screen" aria-live="polite">
    <div class="screen-body native-form">
      <h1>{{ q('Сбой программы') }}</h1>
    </div>
  </section>
  <div v-else-if="emergencyBlocked" class="native-screen" aria-hidden="true"></div>
  <RouterView v-else-if="(route.name === 'shared-photo' || route.name === 'shared-card')" :key="route.fullPath" />
  <template v-else>
    <a class="skip-link" href="#main">{{ t('skip') }}</a>
    <div
      :class="[
        'app-shell',
        {
          'camera-shell': immersive,
          'native-shell': native,
          'welcome-shell': route.name === 'welcome',
          'editor-shell': editor,
          'privacy-screen': hidden,
          'messenger-shell': route.matched.some(record => record.name === 'messages'),
          'messenger-thread-open': route.name === 'conversation-profile',
        },
      ]"
    >
      <header v-if="!native && !hidden" class="app-bar">
        <RouterLink to="/camera" class="app-wordmark" aria-label="PhotoBunker"
          ><span class="brand-mark"><AppIcon name="camera" /></span
          ><span>PhotoBunker</span></RouterLink
        ><span class="app-context">{{ title }}</span
        ><RouterLink v-if="appStatus" to="/status" :class="['app-status-pill', `is-${appStatus.tone}`]"><span />{{ appStatus.label }}</RouterLink
        ><span v-if="localPrototype" class="app-mode">{{
          u('localMode')
        }}</span>
      </header>

      <nav
        v-if="!deletionBlocked && account && (sessionState === 'authenticated' || sessionState === 'offline' || (sessionState === 'checking' && offlineCaptureIdentity)) && appLockReady && !appLocked && !editor && !hidden"
        class="navigation"
        data-testid="app-dock"
        :aria-label="t('navigation')"
      >
        <RouterLink
          v-for="item in navigation"
          :key="item.name"
          :to="item.to"
          :class="[
            'nav-item',
            {
              active: isActive(item.name),
              'dock-camera': item.name === 'camera',
            },
          ]"
          :aria-label="label(item.name)"
          :aria-current="isActive(item.name) ? 'page' : undefined"
        >
          <span class="dock-icon"><AppIcon :name="item.icon" /></span
          ><span>{{ label(item.name) }}</span>
        </RouterLink>
      </nav>

      <p
        v-if="offline && !immersive && !hidden && !route.matched.some(record => record.name === 'messages')"
        class="offline-notice"
        role="status"
      >
        <AppIcon name="offline" /><span
          ><strong>{{ t('offline') }}</strong
          ><span>{{
            t(localPrototype ? 'offlineHint' : 'prototypeDisabled')
          }}</span></span
        >
      </p>

      <main id="main" ref="main" class="main-content" tabindex="-1">
        <p
          v-if="showScopedLocal && appLockReady && !appLocked && localPrototype && accessCode && !accessSaved"
          class="server-warning"
          role="status"
        >
          {{ t('accessNotSaved') }}
          <RouterLink to="/settings">{{ t('settings') }}</RouterLink>
        </p>
        <section v-if="deletionBlocked" class="native-screen" aria-live="assertive">
          <div class="screen-body native-form">
            <h1>{{ localDeleteText('blocked') }}</h1>
            <p>{{ localDeleteText('journal') }}</p>
            <p v-if="deletionPhase" role="status">{{ localDeleteText('phase') }}: {{ deletionPhase }}</p>
            <p v-if="deletionFailure" role="alert">{{ localDeleteText('retryNotice') }}</p>
            <button type="button" class="primary-button" @click="resumeLocalDeletion().then(ok => { if(ok) startIdentityBootstrap() })">
              {{ localDeleteText('retry') }}</button>
          </div>
        </section>
        <section v-else-if="privatePending" class="native-screen" aria-live="polite">
          <div v-if="sessionState === 'initial' || sessionState === 'checking'" class="screen-body app-route-skeleton" role="status" aria-label="Loading">
            <span class="route-skeleton-title" /><span class="route-skeleton-card" /><span class="route-skeleton-card" />
          </div>
          <div v-else class="screen-body">
            <p role="status">{{ privateMessage }}</p>
            <button v-if="sessionState === 'unavailable' || sessionState === 'offline'"
              class="secondary-button" @click="retrySession">{{ a('sessionRetry') }}</button>
            <RouterLink :to="{ path: '/profile/account', query: { mode: 'recover', returnTo: profileReturnTo(route.path) } }" class="quiet-button">{{ a('signInKey') }}</RouterLink>
          </div>
        </section>
        <section
          v-else-if="
            account &&
            (!appLockReady || appLocked) &&
            route.name !== 'account-auth'
          "
          class="native-screen app-passcode-screen"
        >
          <form class="native-form screen-body app-passcode-form" @submit.prevent="openApp">
            <span class="passcode-brand">PhotoBunker</span>
            <h1>
              {{ appLockReady ? pt('locked') : a('sessionChecking') }}
            </h1>
            <template v-if="appLockFailure"><p role="alert">{{ pt('storage') }}</p>
              <button type="button" class="secondary-button" @click="loadAppLock()">{{ pt('retry') }}</button>
            </template>
            <template v-else-if="appLockReady">
              <p class="passcode-prompt">{{ pt('title') }}</p>
              <PasscodeInput v-model="appPin"
                :length="emergencyManualEntry ? Math.max(10, emergencyPinLength, appPinLength) : appPinLength"
                :auto-clear="!emergencyManualEntry" :label="pt('title')"
                :disabled="appPinOpening && emergencyManualEntry" autofocus
                @complete="onPinPart" />
              <button v-if="emergencyManualEntry" class="primary-button passcode-submit"
                :disabled="appPinOpening || appPin.length < 4">{{ pt('unlock') }}</button>
              <button
                type="button"
                class="quiet-button passcode-recovery"
                @click="router.push('/profile/account?mode=recover&pinReset=1')"
              >
                {{ pt('forgot') }}
              </button>
              <p v-if="appPinError" class="form-error passcode-error" role="alert">{{ appPinError }}</p>
            </template>
          </form>
        </section>
        <template v-else-if="account && privatePhotoRoute && (!protectionReady || !protectionEnabled || !photoReadAllowed())">
          <section v-if="!protectionReady" class="native-screen app-loading-shell" aria-busy="true" aria-label="Loading">
            <div class="screen-body"><span class="loading-heading" /><div class="photo-access-skeleton"><span /><span /><span /><span /></div></div>
          </section>
          <AccountPhotoAccess v-else />
        </template>
        <RouterView v-else v-slot="{ Component }">
          <Suspense timeout="0">
            <component :is="Component"
              :key="route.name === 'account-auth' ? 'account-auth' : `${account?.id}:${String(route.name)}`" />
            <template #fallback>
              <section class="native-screen app-route-skeleton" role="status" aria-label="Loading">
                <div class="screen-body"><span class="route-skeleton-title" /><span class="route-skeleton-card" /><span class="route-skeleton-card" /></div>
              </section>
            </template>
          </Suspense>
        </RouterView>
      </main>
    </div>
  </template>
</template>
