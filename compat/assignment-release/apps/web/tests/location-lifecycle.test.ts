// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type PositionHandler = PositionCallback
let permissionState: PermissionState
let permissionChanges: Set<() => void>
let callback: PositionHandler | undefined
let errorCallback: PositionErrorCallback | undefined
const watchPosition = vi.fn((_success: PositionCallback, _error: PositionErrorCallback) => {
  callback = _success
  errorCallback = _error
  return 14
})
const clearWatch = vi.fn()
const query = vi.fn(async () => ({
  get state() { return permissionState },
  addEventListener(_name: string, cb: () => void) { permissionChanges.add(cb) },
  removeEventListener(_name: string, cb: () => void) { permissionChanges.delete(cb) },
}) as PermissionStatus)
function fix(time = Date.now(), accuracy = 12): GeolocationPosition {
  return {
    timestamp: time,
    coords: { latitude: 41.72, longitude: 44.77, accuracy },
  } as GeolocationPosition
}
async function getService() {
  return import('../src/profiles/location')
}
async function settled() { await Promise.resolve(); await Promise.resolve() }

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
  watchPosition.mockClear()
  clearWatch.mockClear()
  query.mockClear()
  permissionState = 'prompt'
  permissionChanges = new Set()
  callback = undefined
  errorCallback = undefined
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query } })
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true, value: { watchPosition, clearWatch },
  })
})
afterEach(async () => {
  const service = await getService()
  service.stopLocation()
})

describe('R1-01 / a single private foreground GPS lifecycle', () => {
  it('never calls geolocation without a previously granted permission', async () => {
    const gps = await getService()
    gps.startGrantedLocation('account-a:device-a')
    await settled()
    expect(query).toHaveBeenCalledWith({ name: 'geolocation' })
    expect(watchPosition).not.toHaveBeenCalled()
    expect(gps.locationState.value).toBe('permission')
    permissionState = 'denied'
    for (const listener of permissionChanges) listener()
    expect(watchPosition).not.toHaveBeenCalled()
    expect(gps.latestLocation.value).toBeUndefined()
  })
  it('opens just one watch after prior permission and uses a bounded cached fix', async () => {
    permissionState = 'granted'
    const gps = await getService()
    gps.startGrantedLocation('account-a:device-a')
    gps.startGrantedLocation('account-a:device-a')
    await settled()
    expect(watchPosition).toHaveBeenCalledTimes(1)
    callback?.(fix())
    expect(gps.locationState.value).toBe('ready')
    expect(gps.locationAt(Date.now(), 15, 20)?.accuracy).toBe(12)
    expect(gps.locationAt(Date.now(), 15, 10)).toBeUndefined()
    expect(gps.locationAt(Date.now() + 35_000, 15)).toBeUndefined()
    callback?.(fix(Date.now() - 70_000))
    expect(gps.locationAt(Date.now(), 15)?.accuracy).toBe(12)
    gps.stopLocation()
    expect(clearWatch).toHaveBeenCalledWith(14)
    expect(gps.locationAt(Date.now())).toBeUndefined()
  })
  it('only prompts through explicit user action, not the automatic check', async () => {
    const gps = await getService()
    gps.startGrantedLocation('account-a:device-a')
    await settled()
    expect(watchPosition).not.toHaveBeenCalled()
    gps.requestLocation('account-a:device-a')
    expect(watchPosition).toHaveBeenCalledTimes(1)
    callback?.(fix())
    expect(gps.locationAt(Date.now())).toBeDefined()
  })
  it('discards scope A samples on account switch and ignores delayed callbacks', async () => {
    permissionState = 'granted'
    const gps = await getService()
    gps.startGrantedLocation('account-a:device-a')
    await settled()
    const oldCallback = callback
    oldCallback?.(fix())
    expect(gps.locationAt(Date.now())).toBeDefined()
    gps.startGrantedLocation('account-b:device-b')
    await settled()
    expect(clearWatch).toHaveBeenCalledWith(14)
    expect(gps.locationAt(Date.now())).toBeUndefined()
    oldCallback?.(fix())
    expect(gps.locationAt(Date.now())).toBeUndefined()
    callback?.(fix())
    expect(gps.locationAt(Date.now())).toBeDefined()
  })
  it('stops immediately on opt-out, does not reveal old coordinates after opt-in', async () => {
    permissionState = 'granted'
    const gps = await getService()
    gps.startGrantedLocation('account-a:device-a')
    await settled()
    callback?.(fix())
    expect(gps.setLocationEnabled(false)).toBe(true)
    expect(localStorage.getItem('photobunker.location.enabled.v1')).toBe('false')
    expect(clearWatch).toHaveBeenCalledWith(14)
    expect(gps.locationAt(Date.now())).toBeUndefined()
    gps.startGrantedLocation('account-a:device-a')
    await settled()
    expect(watchPosition).toHaveBeenCalledTimes(1)
    gps.setLocationEnabled(true)
    gps.startGrantedLocation('account-a:device-a')
    await settled()
    expect(watchPosition).toHaveBeenCalledTimes(2)
    expect(gps.locationAt(Date.now())).toBeUndefined()
  })
  it('removes a previously accepted coordinate if browser permission is revoked', async () => {
    permissionState = 'granted'
    const gps = await getService()
    gps.startGrantedLocation('account-a:device-a')
    await settled()
    callback?.(fix())
    expect(gps.locationAt(Date.now())).toBeDefined()
    permissionState = 'denied'
    for (const listener of [...permissionChanges]) listener()
    expect(gps.locationState.value).toBe('denied')
    expect(gps.locationAt(Date.now())).toBeUndefined()
    expect(clearWatch).toHaveBeenCalledWith(14)
    callback?.(fix())
    expect(gps.locationAt(Date.now())).toBeUndefined()
    errorCallback?.({ code: 1 } as GeolocationPositionError)
  })
  it('keeps the same watch available after a transient position timeout', async () => {
    permissionState = 'granted'
    const gps = await getService()
    const notices: boolean[] = []
    const unsubscribe = gps.subscribeLocation((_position, permanent) => notices.push(!!permanent))
    gps.startGrantedLocation('account-a:device-a')
    await settled()
    errorCallback?.({ code: 3 } as GeolocationPositionError)
    expect(gps.locationState.value).toBe('unavailable')
    expect(notices.at(-1)).toBe(false)
    expect(clearWatch).not.toHaveBeenCalled()
    callback?.(fix())
    expect(gps.locationAt(Date.now())).toBeDefined()
    unsubscribe()
  })
  it('stops this tab when another tab disables location', async () => {
    permissionState = 'granted'
    const gps = await getService()
    gps.startGrantedLocation('account-a:device-a')
    await settled()
    callback?.(fix())
    localStorage.setItem('photobunker.location.enabled.v1', 'false')
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'photobunker.location.enabled.v1', newValue: 'false',
    }))
    expect(gps.locationEnabled.value).toBe(false)
    expect(gps.locationAt(Date.now())).toBeUndefined()
    expect(clearWatch).toHaveBeenCalledWith(14)
  })
  it('does not trigger a permission prompt on browsers lacking Permissions API', async () => {
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined })
    const gps = await getService()
    gps.startGrantedLocation('account-a:device-a')
    await settled()
    expect(gps.locationState.value).toBe('permission')
    expect(watchPosition).not.toHaveBeenCalled()
    gps.requestLocation('account-a:device-a')
    expect(watchPosition).toHaveBeenCalledTimes(1)
  })
})
