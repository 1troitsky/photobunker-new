import { watch } from 'vue'
import { account } from './store'
import { identityRequest } from './api'
import { appLocked } from '../app/lock'

// Timers, Matrix sync and gallery polling never renew the inactivity deadline.
export function startActivity() {
  let lastOwner = '', lastSent = 0, busy = false, pending = false
  async function send() {
    const owner = account.value?.id
    if (!owner || document.hidden || appLocked.value || !navigator.onLine || busy || !pending) return
    if (owner === lastOwner && Date.now() - lastSent < 60000) return
    busy = true
    try {
      await identityRequest('/activity', 'POST', undefined, owner)
      if (account.value?.id === owner) { lastOwner = owner; lastSent = Date.now(); pending = false }
    } catch { /* Keep a failed foreground activity pending for the next gesture/online. */ }
    finally { busy = false }
  }
  function interacted(event: Event) { if (event.isTrusted) { pending = true; void send() } }
  function foreground() { if (!document.hidden) { pending = true; void send() } }
  const stop = watch([() => account.value?.id, appLocked], () => { pending = true; void send() }, { immediate: true })
  document.addEventListener('pointerdown', interacted, { passive: true })
  document.addEventListener('keydown', interacted, { passive: true })
  document.addEventListener('visibilitychange', foreground)
  window.addEventListener('online', send)
  return () => {
    stop()
    document.removeEventListener('pointerdown', interacted)
    document.removeEventListener('keydown', interacted)
    document.removeEventListener('visibilitychange', foreground)
    window.removeEventListener('online', send)
  }
}
