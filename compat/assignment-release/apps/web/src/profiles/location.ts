import { ref, shallowRef } from 'vue'
import type { Location } from './model'

/**
 * One foreground geolocation watcher per unlocked account/device.
 * No GPS coordinates, timestamps or account identities are persisted here.
 * Camera and settings consume this shared source instead of starting a
 * second navigator.geolocation.watchPosition request.
 */
const preferenceKey = 'photobunker.location.enabled.v1'
function savedPreference(): boolean {
  try { return localStorage.getItem(preferenceKey) !== 'false' }
  catch { return true }
}
export const locationEnabled = ref(savedPreference())
export const locationPreferenceSaved = ref(true)
export const locationState = ref<'idle' | 'pending' | 'ready' | 'permission' | 'denied' | 'unavailable'>('idle')
export const latestLocation = shallowRef<Location>()

type Listener = (location?: Location, permanent?: boolean) => void
const listeners = new Set<Listener>()
let activeScope = ''
let watchId: number | undefined
let permission: PermissionStatus | undefined
let permissionListener: (() => void) | undefined
let generation = 0
let watchEpoch = 0
let freshnessTimer: ReturnType<typeof setTimeout> | undefined

// A privacy opt-out in another tab must stop this tab's watcher too.
window.addEventListener('storage', event => {
  if (event.key !== preferenceKey && event.key !== null) return
  const enabled = savedPreference()
  if (enabled === locationEnabled.value) return
  locationEnabled.value = enabled
  if (!enabled) discard()
})

function notify(location?: Location, permanent = false) {
  for (const listener of listeners) listener(location, permanent)
}
function clearWatcher() {
  if (freshnessTimer) clearTimeout(freshnessTimer)
  freshnessTimer = undefined
  // Late browser callbacks from a revoked or stopped observer are ignored.
  watchEpoch++
  if (watchId !== undefined) navigator.geolocation?.clearWatch(watchId)
  watchId = undefined
}
function detachPermission() {
  if (permission && permissionListener) permission.removeEventListener('change', permissionListener)
  permission = undefined
  permissionListener = undefined
}
function discard() {
  generation++
  clearWatcher()
  detachPermission()
  latestLocation.value = undefined
  activeScope = ''
  locationState.value = 'idle'
  notify()
}
/** Stop at PIN lock, background, guest route, account change, logout or revoke. */
export function stopLocation() { discard() }

/** Stop immediately on opt-out, even if the preference cannot be written. */
export function setLocationEnabled(enabled: boolean): boolean {
  locationEnabled.value = enabled
  if (!enabled) discard()
  try {
    localStorage.setItem(preferenceKey, String(enabled))
    locationPreferenceSaved.value = true
  } catch { locationPreferenceSaved.value = false }
  return locationPreferenceSaved.value
}
function acceptPosition(scope: string, token: number, sampleEpoch: number, position: GeolocationPosition) {
  if (token !== generation || sampleEpoch !== watchEpoch ||
      scope !== activeScope || !locationEnabled.value) return
  const { latitude, longitude, accuracy } = position.coords
  const measuredAt = position.timestamp
  if (![latitude, longitude, accuracy, measuredAt].every(Number.isFinite) ||
      accuracy < 0 || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 ||
      measuredAt <= 0 || measuredAt > Date.now() + 5000 ||
      Date.now() - measuredAt > 60_000) return
  // A much less precise update should not replace a still-fresh fix.
  const last = latestLocation.value
  if (last && measuredAt <= last.measuredAt) return
  if (last && Date.now() - last.measuredAt <= 15_000 && accuracy > last.accuracy * 2) return
  latestLocation.value = { source: 'gps', latitude, longitude, accuracy, measuredAt }
  locationState.value = 'ready'
  notify(latestLocation.value)
  // A location chip must not say "GPS ready" forever after iOS suspends
  // updates. No background polling: only an in-memory freshness deadline.
  if (freshnessTimer) clearTimeout(freshnessTimer)
  const latestAt = measuredAt
  freshnessTimer = setTimeout(() => {
    freshnessTimer = undefined
    if (token !== generation || sampleEpoch !== watchEpoch ||
        latestLocation.value?.measuredAt !== latestAt) return
    locationState.value = 'pending'
    notify()
  }, Math.max(0, 15_001 - (Date.now() - measuredAt)))
}
function beginWatch(scope: string) {
  if (scope !== activeScope || !locationEnabled.value || watchId !== undefined) return
  if (!navigator.geolocation) { locationState.value = 'unavailable'; notify(undefined, true); return }
  const token = generation, sampleEpoch = watchEpoch
  locationState.value = 'pending'
  notify()
  try {
    watchId = navigator.geolocation.watchPosition(
      value => acceptPosition(scope, token, sampleEpoch, value),
      error => {
        if (token !== generation || sampleEpoch !== watchEpoch || scope !== activeScope) return
        if (error.code === 1) {
          // Browser / OS permission revoked: remove prior coordinates.
          clearWatcher()
          latestLocation.value = undefined
          locationState.value = 'denied'
          notify(undefined, true)
        } else {
          locationState.value = 'unavailable'
          // Timeout/unavailable can recover on this same watch. Keep the
          // bounded post-capture refinement alive until its own deadline.
          notify()
        }
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    )
  } catch {
    locationState.value = 'unavailable'
    notify(undefined, true)
  }
}
/**
 * Called by App.vue once the existing Identity + PIN gates permit private UI.
 * Permissions API is queried first so this path NEVER displays a system
 * permission prompt (including on Welcome or an untrusted device).
 * Browsers without Permission.query need an explicit user gesture instead.
 */
export function startGrantedLocation(scope: string) {
  if (!scope || !locationEnabled.value) { discard(); return }
  if (activeScope === scope) return
  discard()
  activeScope = scope
  const token = generation
  if (!navigator.permissions?.query) {
    locationState.value = 'permission'
    notify()
    return
  }
  void navigator.permissions.query({ name: 'geolocation' }).then(status => {
    if (token !== generation || activeScope !== scope || !locationEnabled.value) return
    permission = status
    const changed = () => {
      if (token !== generation || scope !== activeScope) return
      if (status.state === 'granted') beginWatch(scope)
      else {
        clearWatcher()
        latestLocation.value = undefined
        locationState.value = status.state === 'denied' ? 'denied' : 'permission'
        notify(undefined, status.state === 'denied')
      }
    }
    permissionListener = changed
    status.addEventListener('change', changed)
    changed()
  }).catch(() => {
    if (token === generation && activeScope === scope) {
      locationState.value = 'permission'
      notify()
    }
  })
}
/**
 * Only call from a user gesture (camera/settings button). The browser owns
 * the consent prompt; a denied/revoked permission is never bypassed.
 */
export function requestLocation(scope: string) {
  if (!scope || !locationEnabled.value) return
  if (scope !== activeScope || watchId === undefined) {
    discard()
    activeScope = scope
    beginWatch(scope)
  }
}
export function subscribeLocation(listener: Listener): () => void {
  listeners.add(listener)
  listener(latestLocation.value, locationState.value === 'denied' || locationState.value === 'unavailable')
  return () => { listeners.delete(listener) }
}
/** Snapshot at capture-time, never an unqualified stale/low-accuracy reading. */
export function locationAt(time: number, windowSeconds = 15, maxAccuracy = Infinity): Location | undefined {
  const location = latestLocation.value
  if (!location || !locationEnabled.value || !Number.isFinite(time) ||
      !Number.isFinite(windowSeconds) || windowSeconds <= 0 ||
      Date.now() - location.measuredAt > 60_000 ||
      Math.abs(time - location.measuredAt) > Math.min(windowSeconds, 60) * 1000 ||
      location.accuracy > maxAccuracy) return undefined
  return { ...location }
}
