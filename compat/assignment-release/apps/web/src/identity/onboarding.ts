import { ref } from 'vue'
import { account, deviceId } from './store'
import { accountKey } from './vault'
import { ensureAccountPhotos } from './setup'

type Stage = 'idle' | 'pending' | 'ready' | 'error'
export const onboarding = ref<{
  scope: string
  key: 'unknown' | 'ready' | 'missing' | 'error'
  photos: Stage
  messaging: Stage
}>({ scope: '', key: 'unknown', photos: 'idle', messaging: 'idle' })

const currentScope = () => account.value && deviceId.value ? `${account.value.id}:${deviceId.value}` : ''
let running: { scope: string; promise: Promise<void> } | undefined

/**
 * Deferred best-effort photo preparation. Messaging/Matrix is deliberately
 * not provisioned as part of account creation: it is outside the product
 * baseline and must never slow down the camera and photo library.
 */
export function startOnboarding(): Promise<void> {
  const scope = currentScope()
  if (!scope) return Promise.resolve()
  if (running?.scope === scope) return running.promise
  if (onboarding.value.scope !== scope)
    onboarding.value = { scope, key: 'unknown', photos: 'idle', messaging: 'idle' }
  const current = () => currentScope() === scope
  const update = (field: 'photos' | 'messaging', state: Stage) => {
    if (current()) onboarding.value = { ...onboarding.value, [field]: state }
  }
  const promise = (async () => {
    let key: string | undefined
    try {
      key = await accountKey()
    } catch {
      if (current()) onboarding.value = { ...onboarding.value, key: 'error' }
      return
    }
    if (!current()) return
    onboarding.value = { ...onboarding.value, key: key ? 'ready' : 'missing' }
    if (!key) return
    if (onboarding.value.photos !== 'ready') {
      update('photos', 'pending')
      await ensureAccountPhotos()
        .then(() => update('photos', 'ready'))
        .catch(() => update('photos', 'error'))
    }
  })().finally(() => { if (running?.scope === scope) running = undefined })
  running = { scope, promise }
  return promise
}

if (typeof window !== 'undefined')
  window.addEventListener('online', () => { void startOnboarding() })
