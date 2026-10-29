import { account } from '../identity/store'
import { ensureAccountPhotos } from '../identity/setup'
import { cachedContext, loadProtection, prepareContext, protectionEnabled } from './store'
import { checkCapture } from './protocol'

// A valid offline plan works immediately. Missing/expired plans are renewed here,
// before the shutter becomes available, without navigating away from the camera.
export async function cameraContext(assignmentId?: string, approve = false) {
  const owner = account.value?.id
  if (!owner) throw new Error('crypto.account_required')
  let context
  if (!approve) {
    try { context = await cachedContext(assignmentId) } catch { /* Prepare below. */ }
  }
  if (!context) {
    await loadProtection()
    if (!protectionEnabled.value) await ensureAccountPhotos()
    try { context = await prepareContext(assignmentId, approve) }
    catch (error) {
      if (error instanceof Error && error.message === 'crypto.strong_required') {
        await ensureAccountPhotos()
        context = await prepareContext(assignmentId, approve)
      } else throw error
    }
  }
  if (owner !== account.value?.id) throw new Error('crypto.cancelled')
  checkCapture(context.plan, owner)
  return context
}
