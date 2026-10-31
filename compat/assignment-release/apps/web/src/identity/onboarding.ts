import { ref } from 'vue'
import { account, deviceId } from './store'
import { accountKey } from './vault'
import { ensureAccountPhotos } from './setup'
import { ensureNewAccountMessaging } from './messaging-setup'
import { identityRequest } from './api'

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
 * Deferred best-effort preparation. Nothing here grants photo read access or
 * marks Matrix as ready without its own cryptographic confirmation.
 * Each operation is independently retryable on returning to Profile / online.
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
    const tasks: Promise<void>[] = []
    if (onboarding.value.photos !== 'ready') {
      update('photos', 'pending')
      tasks.push(ensureAccountPhotos()
        .then(() => update('photos', 'ready'))
        .catch(() => update('photos', 'error')))
    }
    if (onboarding.value.messaging !== 'ready') {
      update('messaging', 'pending')
      const owner = account.value!.id
      tasks.push(identityRequest('/matrix/provision', 'POST', undefined, owner)
        .then(() => {
          if (!current()) return
          return ensureNewAccountMessaging()
        })
        .then(() => { if (current()) update('messaging', 'ready') })
        .catch(() => update('messaging', 'error')))
    }
    await Promise.all(tasks)
  })().finally(() => { if (running?.scope === scope) running = undefined })
  running = { scope, promise }
  return promise
}

if (typeof window !== 'undefined')
  window.addEventListener('online', () => { void startOnboarding() })
