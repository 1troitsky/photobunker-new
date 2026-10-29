import { watch } from 'vue'
import { account, loadIdentity } from '../identity/store'
import { loadStudio } from '../studio/store'
import { refreshLibrary } from '../local/library'
import { deliver } from './photos'
import { pendingCount, queueError } from './state'
export function startWorkspace() {
  let busy = false, again = false, stopped = false
  const refresh = async () => {
    if (stopped || !account.value || document.hidden) return
    if (busy) { again = true; return }
    busy = true
    try {
      await loadStudio()
      await deliver()
      await refreshLibrary()
    } catch {
      queueError.value = 'network'
    } finally {
      busy = false
      if (again) { again = false; void refresh() }
    }
  }
  const stop = watch(
    () => account.value?.id,
    () => {
      pendingCount.value = 0
      queueError.value = ''
      void refreshLibrary()
      void refresh()
    },
  )
  const wake = () => {
    void refresh()
  }
  const timer = setInterval(wake, 15000)
  window.addEventListener('photobunker-outbox', wake)
  window.addEventListener('online', wake)
  window.addEventListener('focus', wake)
  document.addEventListener('visibilitychange', wake)
  void loadIdentity()
  wake()
  return () => {
    stopped = true
    stop()
    clearInterval(timer)
    window.removeEventListener('photobunker-outbox', wake)
    window.removeEventListener('online', wake)
    window.removeEventListener('focus', wake)
    document.removeEventListener('visibilitychange', wake)
  }
}
