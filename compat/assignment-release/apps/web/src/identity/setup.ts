import { account, deviceId } from './store'
import { accountKey, readAccountSecrets, saveAccountSecrets, pendingImportedPhotoKey, clearImportedPhotoKey } from './vault'
import { rememberedKit } from '../crypto/trusted'
import { loadProtection, protectionEnabled, cryptoError, strongUnlocked, beginSetup, candidateKit, confirmSetup, unlock, prepareContext } from '../crypto/store'
let setup: { scope: string; promise: Promise<void> } | undefined
export function ensureAccountPhotos(): Promise<void> {
  const owner = account.value?.id, device = deviceId.value
  const scope = `${owner}:${device}`
  if (setup?.scope === scope) return setup.promise
  const check = () => { if (!owner || account.value?.id !== owner || deviceId.value !== device) throw new Error('recovery.cancelled') }
  if (setup) return setup.promise.catch(() => {}).then(() => { check(); return ensureAccountPhotos() })
  const promise = (async () => {
    const root = await accountKey()
    if (!root) throw new Error('recovery.key_required')
    check()
    await loadProtection()
    check()
    if (cryptoError.value) throw new Error('recovery.unavailable')
    const saved = await readAccountSecrets()
    check()
    if (protectionEnabled.value) {
      const imported = await pendingImportedPhotoKey()
      check()
      const photoKey = imported || await rememberedKit() || saved?.photoKey
      if (!photoKey) throw new Error('recovery.legacy_photo_key')
      // Validate an explicitly imported key before replacing a saved backup.
      // Keep its staged copy until unlock and recovery publication both succeed.
      if (imported || !strongUnlocked.value) await unlock(photoKey)
      check()
      if (saved?.photoKey !== photoKey) await saveAccountSecrets({ photoKey })
      check()
      if (imported) await clearImportedPhotoKey()
    } else {
      if (!candidateKit.value) await beginSetup(root)
      check()
      await confirmSetup()
    }
    check()
    await prepareContext()
    check()
  })().finally(() => { if (setup?.scope === scope) setup = undefined })
  setup = { scope, promise }
  return promise
}
