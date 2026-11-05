const BUILD_ID = import.meta.env.VITE_BUILD_ID || 'development'
const CHECK_INTERVAL_MS = 5 * 60_000
const RELOAD_GUARD_MS = 60_000
const RELOAD_GUARD_KEY = 'photobunker.shell-reload.v1'

type Release = { buildId: string }

function release(value: unknown): Release | undefined {
  if (!value || typeof value !== 'object') return
  const buildId = Reflect.get(value, 'buildId')
  if (typeof buildId !== 'string' || !/^[a-zA-Z0-9._-]{1,96}$/.test(buildId)) return
  return { buildId }
}

function recentlyReloaded(target: string): boolean {
  try {
    const value = JSON.parse(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 'null') as
      { target?: unknown; at?: unknown } | null
    return value?.target === target && typeof value.at === 'number' &&
      Date.now() - value.at < RELOAD_GUARD_MS
  } catch { return false }
}

function rememberReload(target: string) {
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, JSON.stringify({ target, at: Date.now() }))
  } catch { /* A reload remains safe when session storage is unavailable. */ }
}

function clearCurrentGuard() {
  try {
    const value = JSON.parse(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 'null') as
      { target?: unknown } | null
    if (value?.target === BUILD_ID) sessionStorage.removeItem(RELOAD_GUARD_KEY)
  } catch { /* Invalid guard data is ignored. */ }
}

async function latestRelease(): Promise<Release | undefined> {
  const response = await fetch(`/release.json?current=${encodeURIComponent(BUILD_ID)}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) return
  return release(await response.json())
}

export function isNewRelease(latest: Release | undefined): latest is Release {
  return !!latest && latest.buildId !== BUILD_ID
}

export function startPwaUpdates() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return

  clearCurrentGuard()
  let registration: ServiceWorkerRegistration | undefined
  let checking = false
  let reloading = false

  const reload = (target: string) => {
    if (reloading || recentlyReloaded(target)) return
    reloading = true
    rememberReload(target)
    window.location.reload()
  }
  const activateWaiting = () => registration?.waiting?.postMessage({ type: 'SKIP_WAITING' })
  const check = async () => {
    if (checking || reloading || document.visibilityState !== 'visible' || !navigator.onLine) return
    checking = true
    try {
      const latest = await latestRelease()
      if (!isNewRelease(latest)) return
      await registration?.update().catch(() => undefined)
      activateWaiting()
      reload(latest.buildId)
    } catch { /* An update check never blocks the local-first application. */ }
    finally { checking = false }
  }

  let controllerChanged = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controllerChanged) return
    controllerChanged = true
    // The release check normally performs this reload. This path also covers
    // browser-initiated worker updates between checks.
    void latestRelease().then(latest => {
      if (isNewRelease(latest)) reload(latest.buildId)
    }).catch(() => undefined)
  })

  navigator.serviceWorker.register('/sw.js', {
    scope: '/',
    updateViaCache: 'none',
  }).then(value => {
    registration = value
    activateWaiting()
    value.addEventListener('updatefound', () => {
      const installing = value.installing
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed') activateWaiting()
      })
    })
    void value.update().catch(() => undefined)
    void check()
  }).catch(() => {
    // Offline startup and restricted browser modes still use local data.
  })

  window.addEventListener('pageshow', check)
  window.addEventListener('online', check)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check()
  })
  window.setInterval(() => { void check() }, CHECK_INTERVAL_MS)
}
