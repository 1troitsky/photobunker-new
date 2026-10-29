<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import ScreenHeader from '../components/ScreenHeader.vue'
import { createRoot, parseKit } from '../identity/keys'
import { account, register, recover, deviceId, signingOut } from '../identity/store'
import { IdentityError, IdentityNetworkError, IdentityTimeoutError } from '../identity/api'
import { rememberAccountKey, stageImportedPhotoKey } from '../identity/vault'
import { parseRecoveryBackup } from '../identity/recovery'
import { q } from '../crypto/text'
import { a } from '../identity/text'
import { s } from '../studio/text'
import { guardReload } from '../studio/unsaved'
import { downloadFile } from '../studio/export'
import { profileReturnTo } from '../identity/person'
import { startOnboarding } from '../identity/onboarding'

const route = useRoute(), router = useRouter(), busy = ref(false), error = ref(''),
  kitSaved = ref(false), kit = ref(''), registered = ref(false)
const connecting = computed(() => route.query.mode === 'connect')
const recovering = computed(() => route.query.mode === 'recover' || connecting.value)
let root: Awaited<ReturnType<typeof createRoot>> | undefined, done = false, sequence = 0, registeredScope = ''
const dirty = computed(() => !!kit.value && !done)
guardReload(dirty, busy)

function message(failure: unknown) {
  const code = failure instanceof Error ? failure.message : ''
  if (failure instanceof IdentityTimeoutError) return a('authTimeout')
  if (failure instanceof IdentityNetworkError) return a('authNetwork')
  if (failure instanceof IdentityError) {
    if (failure.status === 429) return a('authRateLimited')
    if (failure.status >= 500) return a('authServer')
    if (failure.status === 409) return a('authConflict')
    if (failure.status === 403) return a('authOrigin')
    if (failure.status === 401) return a('denied')
    return a('failed')
  }
  if (['invalid_backup', 'identity.invalid_key', 'identity.invalid_kit', 'recovery.wrong_account'].includes(code))
    return a('invalidKit')
  if (['identity.storage_unavailable', 'identity.storage_blocked', 'crypto.storage_failed',
    'crypto.storage_unavailable', 'crypto.storage_blocked', 'recovery.storage_unavailable',
    'QuotaExceededError', 'SecurityError', 'UnknownError', 'InvalidStateError'].includes(code) ||
    failure instanceof DOMException && ['QuotaExceededError', 'SecurityError', 'UnknownError', 'InvalidStateError'].includes(failure.name))
    return a('authStorage')
  if (code === 'recovery.legacy_photo_key') return a('authLegacyPhotos')
  if (code === 'identity.challenge_mismatch' || code === 'recovery.invalid') return a('authCrypto')
  if (code === 'recovery.cancelled' || code === 'crypto.account_changed' ||
    failure instanceof DOMException && failure.name === 'AbortError')
    return a('authCancelled')
  return a('failed')
}

async function prepare() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    root = await createRoot()
    kit.value = root.kit
  } catch (failure) { error.value = message(failure) }
  finally { busy.value = false }
}

async function submit() {
  if (busy.value || signingOut.value || !kit.value || !recovering.value && (!root || !kitSaved.value)) return
  const attempt = ++sequence
  busy.value = true
  error.value = ''
  try {
    let completedScope = ''
    if (recovering.value) {
      const backup = parseRecoveryBackup(kit.value)
      if (connecting.value) {
        const parsed = await parseKit(backup.accountKey)
        if (!account.value || account.value.rootKey !== parsed.publicKey) throw new Error('recovery.wrong_account')
      } else await recover(backup.accountKey, undefined, route.query.pinReset === '1')
      if (attempt !== sequence) throw new DOMException('Sign-in cancelled', 'AbortError')
      const scope = `${account.value?.id}:${deviceId.value}`
      completedScope = scope
      await rememberAccountKey(backup.accountKey)
      if (scope !== `${account.value?.id}:${deviceId.value}`) throw new DOMException('Account changed', 'AbortError')
      // Old PB4 backups are stored encrypted locally first; photo setup can
      // publish them in the background without holding up the profile.
      if (backup.photoKey) await stageImportedPhotoKey(backup.photoKey)
    } else {
      if (!root) return
      if (!registered.value) {
        await register(root)
        registered.value = true
        registeredScope = `${account.value?.id}:${deviceId.value}`
      }
      if (attempt !== sequence) throw new DOMException('Sign-in cancelled', 'AbortError')
      if (registeredScope !== `${account.value?.id}:${deviceId.value}`) throw new DOMException('Account changed', 'AbortError')
      completedScope = registeredScope
      await rememberAccountKey(root.kit)
    }
    if (attempt !== sequence || !account.value || signingOut.value || completedScope !== `${account.value.id}:${deviceId.value}`)
      throw new DOMException('Account changed', 'AbortError')
    done = true
    void startOnboarding()
    await router.replace(profileReturnTo(route.query.returnTo))
    kit.value = ''
    root = undefined
  } catch (failure) {
    if (attempt === sequence) error.value = message(failure)
  } finally { if (attempt === sequence) busy.value = false }
}

function saveKit() {
  if (kit.value) downloadFile(new File([kit.value], 'photobunker-account-key.txt', { type: 'text/plain' }))
}
async function importBackup(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  try {
    if (!file || file.size > 8192) throw new Error('invalid_backup')
    const value = await file.text()
    parseRecoveryBackup(value)
    kit.value = value
    error.value = ''
  } catch { error.value = a('invalidKit') }
  finally { input.value = '' }
}
onBeforeRouteLeave(() => done || !busy.value && (!dirty.value || confirm(s('leave'))))
onBeforeUnmount(() => { sequence++; kit.value = ''; root = undefined })
</script>
<template>
  <section class="native-screen native-editor">
    <ScreenHeader :title="connecting ? q('Подключить ключ аккаунта') : a(recovering ? 'signInKey' : 'create')" :back="route.query.from === 'welcome' && !account ? '/welcome' : '/profile'" />
    <form class="native-form editor-body" @submit.prevent="submit">
      <p class="field-hint">{{ recovering ? q('Введите единственный ключ аккаунта или выберите сохранённый файл. Приложение само подключит фотографии и переписку.') : q('Создайте аккаунт и сохраните один ключ. Он подключает фотографии и переписку на ваших устройствах.') }}</p>
      <template v-if="recovering">
        <label>{{ a('kit') }}<textarea v-model="kit" rows="5" spellcheck="false" autocapitalize="off" autocomplete="off" /></label>
        <label>{{ q('Импортировать ключ аккаунта') }}<input type="file" accept=".txt,text/plain" :disabled="busy" @change="importBackup" /></label>
      </template>
      <template v-else>
        <button v-if="!kit" type="button" class="primary-button" :disabled="busy" @click="prepare">{{ a('create') }}</button>
        <template v-else>
          <p class="field-hint">{{ q('Ключ сохраняется на этом устройстве. Резервная копия позволит войти после выхода или потери устройства.') }}</p>
          <label>{{ a('kit') }}<textarea :value="kit" readonly rows="5" spellcheck="false" autocomplete="off" /></label>
          <button type="button" class="secondary-button" :disabled="busy" @click="saveKit">{{ a('downloadKit') }}</button>
          <label class="plain-check"><input v-model="kitSaved" type="checkbox" />{{ a('kitSaved') }}</label>
        </template>
      </template>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <footer class="editor-footer">
        <button type="button" class="secondary-button" :disabled="busy" @click="router.push('/profile')">{{ s('cancel') }}</button>
        <button class="primary-button" :disabled="busy || signingOut || !kit || (!recovering && !kitSaved)">{{ s(busy ? 'saving' : 'done') }}</button>
      </footer>
    </form>
  </section>
</template>
