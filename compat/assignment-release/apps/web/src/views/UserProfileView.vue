<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  account,
  deviceId,
  loadIdentity,
  sessionState,
  offlineCaptureIdentity,
  identityUnavailable,
  logout,
  profileSaved,
  sessionNotice,
  signingOut,
} from '../identity/store'
import { a } from '../identity/text'
import { profileReturnTo } from '../identity/person'
import { onboarding, startOnboarding } from '../identity/onboarding'
import AppIcon from '../components/AppIcon.vue'
import ScreenHeader from '../components/ScreenHeader.vue'
import AppSheet from '../components/AppSheet.vue'
import { q } from '../crypto/text'
import { accountKey } from '../identity/vault'
import { downloadFile } from '../studio/export'
import { purgeAccountFromDevice, pendingDeviceCleanup as cleanupPending, accountDeletionNotice as deletionNotice } from '../identity/storage'
import { delivery } from '../delivery/queue'
import { u } from '../app/text'
import { s } from '../studio/text'
import { computed } from 'vue'
import { usePeerPresence } from '../profiles/presence'
import { presenceLabel } from '../profiles/presence-text'
import { inAppId } from '../identity/display'
const ownPresence=usePeerPresence(computed(()=>account.value?.publicId||''))
const router = useRouter(), route = useRoute(),
  authBusy = ref(false),
  authError = ref(''),
  copied = ref(false)
const logoutOpen = ref(false)
watch(() => account.value?.id, id => {
  if (id) { deletionNotice.value = false; localStorage.removeItem('pb-account-deletion-notice') }
}, { immediate: true })
async function retryCleanup() {
  if (!cleanupPending.value || authBusy.value) return
  authBusy.value = true; authError.value = ''
  try { await purgeAccountFromDevice(cleanupPending.value); localStorage.removeItem('pb-deleted-account-cleanup'); cleanupPending.value = null }
  catch { authError.value = q('Не удалось завершить очистку. Закройте другие окна приложения и повторите.') }
  finally { authBusy.value = false }
}
async function saveKey() {
  try {
    const key = await accountKey()
    if (!key) throw new Error('recovery.key_required')
    downloadFile(new File([key], 'photobunker-account-key.txt', { type: 'text/plain' }))
  } catch { authError.value = a('failed') }
}
watch(sessionState, (state) => {
  if (state === 'authenticated') void startOnboarding()
}, { immediate: true })
async function signOut() {
  authBusy.value = true
  try {
    await logout()
    logoutOpen.value = false
  } catch {
    authError.value = a('failed')
  } finally {
    authBusy.value = false
  }
}
async function copyId() {
  try {
    await navigator.clipboard.writeText(inAppId(account.value!.publicId, account.value!.userId))
    copied.value = true
  } catch {
    authError.value = a('failed')
  }
}
</script>

<template>
  <section class="native-screen account-screen">
    <ScreenHeader :title="u('profile')" />
    <div class="screen-body">
      <section class="account-card">
        <span class="account-avatar"><img v-if="account?.fields.avatar" :src="account.fields.avatar" :alt="a('avatar')" /><AppIcon v-else name="user" /></span>
        <div v-if="account">
          <h2>
            {{ account.fields.name || (account.fields.username ? `@${account.fields.username}` : q('Мой профиль')) }}
          </h2>
          <p class="account-user-id">{{ inAppId(account.publicId, account.userId) }}</p>
          <p class="field-hint presence-label" role="status">{{ presenceLabel(ownPresence) }}</p>
          <div class="inline-actions">
            <button class="quiet-button" @click="copyId">
              {{ a(copied ? 'copied' : 'copy') }}</button
            ><button v-if="!offlineCaptureIdentity" class="quiet-button" @click="router.push('/profile/edit')">
              {{ a('editProfile') }}
            </button>
          </div>
        </div>
        <div v-else>
          <h2>{{ a('noAccount') }}</h2>
          <p>{{ a('accountHint') }}</p>
        </div>
      </section>
      <div v-if="account && offlineCaptureIdentity" class="form-notice" role="status">
        <p>{{ a('sessionLocalOnly') }}</p>
        <RouterLink to="/profile/account?mode=recover" class="quiet-button">{{ a('signInKey') }}</RouterLink>
      </div>
      <div v-if="account && !offlineCaptureIdentity && onboarding.scope === `${account.id}:${deviceId}` &&
        (onboarding.key === 'missing' || onboarding.key === 'error' ||
          onboarding.photos === 'error' || onboarding.messaging === 'error')" class="form-notice" role="status">
        <p v-if="onboarding.key === 'missing'">{{ a('authKeyMissing') }}</p>
        <p v-if="onboarding.key === 'error'">{{ a('authStorage') }}</p>
        <template v-if="onboarding.key === 'ready'">
          <p v-if="onboarding.photos === 'error'">{{ a('authPhotoDeferred') }}</p>
          <p v-if="onboarding.messaging === 'error'">{{ a('authMessagesDeferred') }}</p>
        </template>
        <RouterLink v-if="onboarding.key === 'missing'" to="/profile/account?mode=connect" class="quiet-button">{{ a('signInKey') }}</RouterLink>
        <button v-else type="button" class="quiet-button" @click="startOnboarding()">{{ a('authRetrySetup') }}</button>
      </div>
      <p v-if="profileSaved && account" class="form-notice" role="status">
        {{ a('profileSaved') }}
      </p>
      <p v-if="signingOut" class="field-hint" role="status">{{ q('Завершаем выход на устройстве…') }}</p>
      <p v-if="sessionNotice && !account" class="form-error" role="alert">
        {{ a('sessionExpired') }}
      </p>
      <dl v-if="account && !offlineCaptureIdentity" class="native-facts account-fields">
        <template
          v-for="field in [
            'username',
            'email',
            'phone',
            'links',
            'about',
          ] as const"
          :key="field"
          ><div v-if="account.fields[field]">
            <dt>{{ a(field) }} · {{ a(account.visibility[field]) }}</dt>
            <dd>{{ account.fields[field] }}</dd>
          </div></template
        >
      </dl>
      <p v-if="identityUnavailable" class="form-error" role="status">
        {{ a('unavailable') }}
        <button class="quiet-button" @click="loadIdentity(true)">
          {{ s('restore') }}
        </button>
      </p>
      <div v-if="!account" class="identity-entry-actions">
        <button class="primary-button" :disabled="signingOut" @click="router.push({ path: '/profile/account', query: { returnTo: profileReturnTo(route.query.returnTo) } })">
          {{ a('create') }}</button
        ><button
          class="secondary-button"
          :disabled="signingOut"
          @click="router.push({ path: '/profile/account', query: { mode: 'recover', returnTo: profileReturnTo(route.query.returnTo) } })"
        >
          {{ a('signInKey') }}</button>

      </div>
      <p v-if="!account && deletionNotice" class="field-hint" role="status">{{ q('Аккаунт закрыт. Очистка данных на сервере выполняется автоматически.') }}</p>
      <div v-if="!account && cleanupPending" class="form-error" role="alert"><p>{{ q('Закройте другие окна приложения, чтобы завершить удаление локальных данных.') }}</p><button class="secondary-button" :disabled="authBusy" @click="retryCleanup">{{ q('Завершить очистку устройства') }}</button></div>
      <p v-if="authError" class="form-error" role="alert">{{ authError }}</p>
      <template v-if="account && !offlineCaptureIdentity">
      <section class="preference-group profile-settings" :aria-label="u('preferences')">
        <h2 class="profile-section-title">{{ u('preferences') }}</h2>
        <RouterLink to="/settings" class="account-link"><AppIcon name="settings" /><span><strong>{{ q('Настройки приложения') }}</strong><small>{{ q('Оформление, язык и экран при запуске') }}</small></span><AppIcon name="chevron" /></RouterLink>
        <RouterLink to="/profile/security" class="account-link"><AppIcon name="lock" /><span><strong>{{ q('Конфиденциальность и безопасность') }}</strong><small>{{ q('Видимость профиля, PIN-коды и устройства') }}</small></span><AppIcon name="chevron" /></RouterLink>
        <RouterLink to="/settings/data" class="account-link"><AppIcon name="device" /><span><strong>{{ q('Данные и хранилище') }}</strong><small>{{ q('Кэш, облако, очереди и резервные копии') }}</small></span><AppIcon name="chevron" /></RouterLink>
        <RouterLink to="/payment" class="account-link"><AppIcon name="key" /><span><strong>{{ q('Тариф и оплата') }}</strong><small>{{ q('Лимиты плана и Web3-оплата') }}</small></span><AppIcon name="chevron" /></RouterLink>
        <RouterLink to="/status" class="account-link"><AppIcon name="sync" /><span><strong>{{ q('Статус') }}</strong><small>{{ q('Подключение, отправка и процессы устройства') }}</small></span><AppIcon name="chevron" /></RouterLink>
      </section>
      <p v-if="account" class="field-hint">{{ a('signOutHint') }}</p>
      <button
        v-if="account"
        class="quiet-button subtle-danger"
        :disabled="authBusy || signingOut"
        @click="logoutOpen = true"
      >
        {{ a('signOut') }}
      </button>
      </template>
    </div>
    <AppSheet :open="logoutOpen" :title="q('Выйти из аккаунта?')" :busy="authBusy || signingOut" @close="logoutOpen = false">
      <div class="logout-sheet-body">
        <div class="logout-sheet-copy">
          <p>{{ q('Ключ аккаунта будет удалён с этого устройства. Чтобы снова открыть данные, понадобится сохранённый ключ.') }}</p>
          <p class="logout-sheet-warning">{{ q('Потерянный ключ восстановить нельзя.') }}</p>
          <p v-if="delivery.pending" class="field-hint">{{ q('Сначала дождитесь отправки фотографий с этого устройства.') }}</p>
        </div>
        <div class="logout-sheet-actions">
          <button class="primary-button full-button" :disabled="authBusy" @click="logoutOpen = false">{{ q('Остаться в аккаунте') }}</button>
          <button class="secondary-button full-button" :disabled="authBusy" @click="saveKey">{{ q('Сохранить ключ в файл') }}</button>
          <button class="danger-button full-button logout-sheet-danger" :disabled="authBusy || signingOut" @click="signOut">{{ q('Выйти без сохранения') }}</button>
        </div>
        <p v-if="authError" class="form-error" role="alert">{{ authError }}</p>
      </div>
    </AppSheet>
  </section>
</template>
