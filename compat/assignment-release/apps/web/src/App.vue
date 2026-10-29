<script setup lang="ts">
import {
  appLockReady,
  appLockFailure,
  appLocked,
  loadAppLock,
  lockApp,
  unlockApp,
} from './app/lock'
import { hardLock, resumeTrustedPhotos } from './crypto/store'
import { pt, pinError } from './app/pin-text'
import { deviceId, sessionState, offlineCaptureIdentity, hasConfirmedIdentity, loadIdentity, startIdentityBootstrap } from './identity/store'
import { q } from './crypto/text'
import { deletionBlocked, deletionFailure, deletionPhase, resumeLocalDeletion } from './app/local-delete-run'
import { localDeleteText } from './app/local-delete-text'
import { emergencyBlocked,emergencyChecked,tryEmergencyOnLockedScreen } from './app/emergency-run'
import AccountPhotoAccess from './components/AccountPhotoAccess.vue'
import {
  startProtection,
  protectionEnabled,
  protectionReady,
  photoReadAllowed,
  strongUnlocked,
  warmLocked,
} from './crypto/store'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { c } from './collaboration/text'
import { startCollaboration } from './collaboration/store'
import { account } from './identity/store'
import { profileReturnTo } from './identity/person'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from './components/AppIcon.vue'
import { locale, t } from './i18n'
import { localPrototype } from './local/photos'
import { startLibrary } from './local/library'
import { refreshProfiles } from './profiles/store'
import { p } from './profiles/text'
import { delivery, startDelivery, retryDelivery } from './delivery/queue'
import { d } from './delivery/text'
import { accessCode, accessSaved } from './server/api'
import { u } from './app/text'
import { rememberSection } from './app/preferences'
import { a } from './identity/text'
import { s } from './studio/text'
import { startWorkspace } from './workspace/service'
import {
  pendingCount as workspacePending,
  queueBusy as workspaceBusy,
  queueError as workspaceError,
} from './workspace/state'
import { deliver as workspaceDeliver } from './workspace/photos'
import { w } from './workspace/text'
import { startStudio } from './studio/store'
import { startActivity } from './identity/activity'
import { selected as selectedConversation, pendingConversationUi, stopMessaging } from './messages/store'
import { purgeAccountFromDevice } from './identity/storage'
import { locationEnabled, startGrantedLocation, stopLocation } from './profiles/location'
import { warmNames } from './local/photo-names'
import { flushCardShares } from './crypto/card-share-outbox'
import { initializePresencePreference, refreshPresenceHeartbeat, stopPresenceHeartbeat,
  stopPresencePreference } from './profiles/presence'

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
const privatePhotoRoute = computed(() => route.path.startsWith('/gallery'))
const openRoute = computed(() =>
  ['shared-photo', 'shared-card', 'welcome', 'profile', 'account-auth', 'person-profile'].includes(String(route.name)),
)
const offlineLocalRoute = computed(() =>
  // A known non-extractable device may display its own encrypted outbox, but
  // this offline scope NEVER grants an API/Matrix session or bypasses PIN.
  ['camera', 'gallery', 'photo', 'photo-card', 'photo-editor', 'photo-browser', 'photo-browser-new', 'profiles', 'profile-edit', 'messages', 'team-profile', 'settings'].includes(String(route.name)),
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
  appPinError = ref('')
async function openApp() {
  const pin = appPin.value
  appPinError.value = ''
  try {
    await unlockApp(pin)
  } catch (error) {
    const triggered = await tryEmergencyOnLockedScreen(pin).catch(() => false)
    if(!triggered)appPinError.value = pinError(error)
  } finally {
    appPin.value = ''
  }
}
watch(
  () => `${account.value?.id}:${deviceId.value}`,
  () => {
    void loadAppLock()
  },
  { immediate: true },
)
watch([appLockReady, appLocked], ([ready, locked]) => {
  if (!ready || locked) {
    // Synchronous cleanup before any protected Vue view can paint.
    hardLock()
    stopMessaging()
    appPin.value = ''
  } else resumeTrustedPhotos()
}, { flush: 'sync' })
function updatePrivatePresence() {
  if (hasConfirmedIdentity() && appLockReady.value && !appLocked.value && !hidden.value &&
      !['welcome','shared-photo','shared-card','account-auth'].includes(String(route.name)))
    refreshPresenceHeartbeat()
  else stopPresenceHeartbeat()
}
function backgroundLock() {
  if (document.hidden) lockApp()
}
function retrySession() { void loadIdentity(true) }
const offline = ref(!navigator.onLine)
const main = ref<HTMLElement>()
let stopDelivery: (() => void) | undefined
let stopCollaboration: (() => void) | undefined
let stopProtection: (() => void) | undefined
let stopLibrary: (() => void) | undefined
let stopWorkspace: (() => void) | undefined
let stopStudio: (() => void) | undefined
let stopActivity: (() => void) | undefined
let mounted = false
let runtimeStarted = false
const hidden = ref(false)
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
watch([() => account.value?.id, deviceId, sessionState, appLockReady, appLocked], () => {
  if (hasConfirmedIdentity() && !appLocked.value)
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
  { name: 'messages', to: '/messages', icon: 'messages' },
  { name: 'camera', to: '/camera', icon: 'camera' },
  { name: 'gallery', to: '/gallery', icon: 'gallery' },
  { name: 'profile', to: '/profile', icon: 'user' },
] as const
const immersive = computed(() => route.name === 'camera')
function label(name: string) {
  return u(
    name === 'gallery'
      ? 'photos'
      : name === 'assignments' || name === 'messages' || name === 'profile'
        ? name
        : 'camera',
  )
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
  hidden, () => route.name], updatePrivatePresence, { immediate: true })
watch([() => account.value?.id, deviceId, sessionState, appLockReady, appLocked],
  ([id,device]) => {
    if (id && device && appLockReady.value && !appLocked.value &&
        (hasConfirmedIdentity() || (sessionState.value==='offline' && offlineCaptureIdentity.value)))
      void initializePresencePreference()
    else stopPresencePreference()
  },{ immediate: true })
function isActive(name: string) {
  return (
    route.name === name ||
    (name === 'gallery' && route.name === 'photo') ||
    (name === 'camera' &&
      ['profiles', 'profile-edit', 'team'].includes(String(route.name))) ||
    (name === 'profile' &&
      [
        'settings',
        'join',
        'teams',
        'team-profile',
        'contacts',
        'account-security',
        'photo-security',
        'account-auth',
        'account-edit',
      ].includes(String(route.name))) ||
    (name === 'assignments' && ['assignment', 'photo-browser', 'photo-browser-new'].includes(String(route.name)))
  )
}
function startPrivateRuntime() {
  if (runtimeStarted || emergencyBlocked.value || deletionBlocked.value ||
      route.name === 'shared-photo' || route.name === 'shared-card') return
  runtimeStarted = true
  document.addEventListener('visibilitychange', backgroundLock)
  document.addEventListener('visibilitychange', locationVisibilityChanged)
  document.addEventListener('visibilitychange', updatePrivatePresence)
  window.addEventListener('pagehide', stopPresenceHeartbeat)
  window.addEventListener('pagehide', lockApp)
  window.addEventListener('pagehide', stopLocation)
  window.addEventListener('pageshow', locationPageShow)
  stopProtection = startProtection()
  stopLibrary = startLibrary()
  stopDelivery = startDelivery()
  stopCollaboration = startCollaboration()
  stopStudio = startStudio()
  stopWorkspace = startWorkspace()
  stopActivity = startActivity()
  const deletedOwner = localStorage.getItem('pb-deleted-account-cleanup')
  if (deletedOwner) void purgeAccountFromDevice(deletedOwner).then(() => localStorage.removeItem('pb-deleted-account-cleanup')).catch(() => {})
  void refreshProfiles()
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
  window.removeEventListener('pagehide', stopPresenceHeartbeat)
  window.removeEventListener('pagehide', lockApp)
  window.removeEventListener('pagehide', stopLocation)
  window.removeEventListener('pageshow', locationPageShow)
  stopProtection?.(); stopProtection = undefined
  stopLibrary?.(); stopLibrary = undefined
  stopDelivery?.(); stopDelivery = undefined
  stopCollaboration?.(); stopCollaboration = undefined
  stopStudio?.(); stopStudio = undefined
  stopWorkspace?.(); stopWorkspace = undefined
  stopActivity?.(); stopActivity = undefined
  window.removeEventListener('online', updateConnection)
  window.removeEventListener('online', reconnectPhotoNames)
  window.removeEventListener('online', updatePrivatePresence)
  window.removeEventListener('online', reconnectCardShares)
  window.removeEventListener('offline', updateConnection)
  window.removeEventListener('offline', updatePrivatePresence)
  window.removeEventListener('photobunker-privacy-screen', privacy)
}
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
    main.value?.focus()
    window.scrollTo?.(0, 0)
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
          'messenger-thread-open': (route.name === 'messages' && (!!selectedConversation || pendingConversationUi)) || route.name === 'conversation-profile',
        },
      ]"
    >
      <header v-if="!native && !hidden" class="app-bar">
        <RouterLink to="/camera" class="app-wordmark" aria-label="PhotoBunker"
          ><span class="brand-mark"><AppIcon name="camera" /></span
          ><span>PhotoBunker</span></RouterLink
        ><span class="app-context">{{ title }}</span
        ><span v-if="localPrototype" class="app-mode">{{
          u('localMode')
        }}</span>
      </header>

      <nav
        v-if="!deletionBlocked && account && (sessionState === 'authenticated' || sessionState === 'offline') && appLockReady && !appLocked && !editor && !hidden"
        class="navigation"
        :aria-label="t('navigation')"
      >
        <RouterLink
          v-for="item in navigation.filter(item => sessionState !== 'offline' || ['camera', 'gallery', 'messages', 'profile'].includes(item.name))"
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
        <div
          v-if="
            showScopedLocal &&
            appLockReady &&
            !appLocked &&
            !immersive &&
            !hidden &&
            (delivery.pending || delivery.deleting || delivery.storageFailed)
          "
          class="delivery-notice"
          role="status"
        >
          <p v-if="delivery.storageFailed">{{ d('storage') }}</p>
          <p v-if="delivery.pending">
            {{ d(delivery.busy ? 'sending' : 'pending') }} ·
            {{ delivery.pending }}
          </p>
          <p v-if="delivery.deleting">
            {{ d('deleting') }} · {{ delivery.deleting }}
          </p>
          <button
            class="quiet-button"
            :disabled="delivery.busy"
            @click="retryDelivery"
          >
            {{ d('retry') }}
          </button>
        </div>
        <div
          v-if="showScopedLocal && appLockReady && !appLocked && !immersive && !hidden && workspacePending"
          class="delivery-notice"
          role="status"
        >
          <p>
            {{ w(workspaceBusy ? 'sending' : 'pendingPhotos') }} ·
            {{ workspacePending }}
          </p>
          <p v-if="workspaceError">
            {{
              w(
                workspaceError === 'keys'
                  ? 'cryptoChanged'
                  : workspaceError === 'quota'
                    ? 'encryptedQuota'
                    : workspaceError === 'retention'
                      ? 'retention'
                      : workspaceError === 'permission'
                        ? 'accessChanged'
                        : 'unavailable',
              )
            }}
          </p>
          <button
            class="quiet-button"
            :disabled="workspaceBusy"
            @click="workspaceDeliver"
          >
            {{ w('retry') }}</button
          ><button
            v-if="workspaceError === 'keys'"
            class="quiet-button"
            @click="router.push('/profile/photos-security')"
          >
            {{ q('Фотографии и резервная копия') }}
          </button>
        </div>
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
          <div class="screen-body">
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
          class="native-screen"
        >
          <form class="native-form screen-body" @submit.prevent="openApp">
            <h1>
              {{ appLockReady ? pt('locked') : a('sessionChecking') }}
            </h1>
            <template v-if="appLockFailure"><p role="alert">{{ pt('storage') }}</p>
              <button type="button" class="secondary-button" @click="loadAppLock()">{{ pt('retry') }}</button>
            </template>
            <template v-else-if="appLockReady"
              ><label
                >{{ pt('title') }}<input
                  v-model="appPin"
                  type="password"
                  inputmode="numeric"
                  autocomplete="off"
                  maxlength="8"
                  required /></label
              ><button class="primary-button">{{ pt('unlock') }}</button
              ><button
                type="button"
                class="quiet-button"
                @click="router.push('/profile/account?mode=recover&pinReset=1')"
              >
                {{ pt('forgot') }}
              </button>
              <p class="field-hint">{{ pt('recovery') }}</p>
              <p v-if="appPinError" role="alert">{{ appPinError }}</p></template
            >
          </form>
        </section>
        <template v-else-if="account && privatePhotoRoute && (!protectionReady || !protectionEnabled || !photoReadAllowed())">
          <section v-if="!protectionReady" class="native-screen"><div class="screen-body"><p>{{ q('Подключаем фотографии…') }}</p></div></section>
          <AccountPhotoAccess v-else />
        </template>
        <RouterView
          v-else
          :key="route.name === 'account-auth' ? 'account-auth' : account?.id"
        />
      </main>
    </div>
  </template>
</template>
