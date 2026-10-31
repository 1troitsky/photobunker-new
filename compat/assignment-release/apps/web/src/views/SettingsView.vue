<script setup lang="ts">
import { ref } from 'vue'
import ScreenHeader from '../components/ScreenHeader.vue'
import AppIcon from '../components/AppIcon.vue'
import { locale, setLocale, t, type Locale } from '../i18n'
import { q } from '../crypto/text'
import { a } from '../identity/text'
import { account, deviceId, sessionState, offlineCaptureIdentity } from '../identity/store'
import { appLockReady, appLocked } from '../app/lock'
import { locationEnabled, locationPreferenceSaved, locationState, requestLocation, setLocationEnabled } from '../profiles/location'
import { locationText } from '../profiles/location-text'
import { visibility, privacyPending, privacyError, setPresenceVisibility,
  flushPresencePreference, type PresenceVisibility } from '../profiles/presence'
import { presenceText, visibilityLabel } from '../profiles/presence-text'
const languageSaved = ref(true)
function changeLanguage(value: Locale) { languageSaved.value = setLocale(value) }
async function changePrivacy(event:Event){
  const field=event.target as HTMLSelectElement
  try { await setPresenceVisibility(field.value as PresenceVisibility) }
  catch { privacyError.value='save';field.value=visibility.value }
}
</script>

<template>
  <section class="native-screen settings-screen">
    <ScreenHeader :title="t('settingsTitle')" back="/profile" />
    <div class="screen-body">
      <div class="settings-panel">
        <RouterLink to="/settings/data" class="account-link"><AppIcon name="device" /><span><strong>{{ q('Данные и хранилище') }}</strong><small>{{ q('Фотографии, занятое место и удаление аккаунта') }}</small></span><AppIcon name="chevron" /></RouterLink>
        <RouterLink to="/profile/security" class="account-link"><AppIcon name="lock" /><span><strong>{{ a('security') }}</strong><small>{{ a('devices') }}</small></span><AppIcon name="chevron" /></RouterLink>
      </div>
      <div class="settings-panel">
        <div class="setting-row">
          <span class="setting-icon"><AppIcon name="globe" /></span>
          <div class="setting-description">
            <h2 id="gps-label">{{ locationText('enabled') }}</h2>
            <p>{{ locationText('description') }}</p>
            <p>{{ locationText('noBackground') }}</p>
          </div>
          <button type="button" class="secondary-button" :aria-pressed="locationEnabled"
            @click="setLocationEnabled(!locationEnabled)">
            {{ locationText(locationEnabled ? 'disable' : 'enable') }}
          </button>
        </div>
        <p v-if="!locationPreferenceSaved" class="preference-notice" role="status">{{ locationText('notSaved') }}</p>
        <p v-if="locationEnabled && locationState === 'permission'" class="field-hint">{{ locationText('permission') }}</p>
        <p v-if="locationEnabled && (locationState === 'denied' || locationState === 'unavailable')" class="field-hint">{{ locationText('denied') }}</p>
        <p v-if="locationEnabled && locationState === 'pending'" class="field-hint">{{ locationText('pending') }}</p>
        <button v-if="locationEnabled && locationState === 'permission' && account && deviceId && appLockReady && !appLocked"
          type="button" class="quiet-button"
          @click="requestLocation(account.id + ':' + deviceId)">{{ locationText('enable') }}</button>
      </div>
      <div class="settings-panel">
        <div class="setting-row">
          <span class="setting-icon"><AppIcon name="users" /></span>
          <div class="setting-description">
            <h2 id="presence-privacy-label">{{ presenceText('title') }}</h2>
            <p>{{ presenceText('description') }}</p>
            <p>{{ presenceText('hint') }}</p>
          </div>
          <select class="presence-visibility-select" :value="visibility"
            :aria-label="presenceText('title')" :disabled="!account || appLocked ||
              (sessionState !== 'authenticated' && !(sessionState === 'offline' && offlineCaptureIdentity))"
            @change="changePrivacy">
            <option v-for="choice in (['all','contacts','nobody'] as PresenceVisibility[])"
              :key="choice" :value="choice">{{ visibilityLabel(choice) }}</option>
          </select>
        </div>
        <p v-if="privacyPending" class="preference-notice" role="status">{{ presenceText('pending') }}</p>
        <p v-if="privacyError" class="preference-notice" role="status">{{ presenceText(privacyError) }}</p>
        <button v-if="privacyPending" class="quiet-button" type="button"
          @click="flushPresencePreference">{{ presenceText('retry') }}</button>
      </div>
      <div class="settings-panel">
        <div class="setting-row">
          <span class="setting-icon"><AppIcon name="globe" /></span>
          <div class="setting-description"><h2 id="language-label">{{ t('language') }}</h2><p>{{ t('languageHint') }}</p></div>
          <div class="language-switch" role="group" aria-labelledby="language-label">
            <button lang="ru" :aria-pressed="locale === 'ru'" @click="changeLanguage('ru')">Русский</button>
            <button lang="en" :aria-pressed="locale === 'en'" @click="changeLanguage('en')">English</button>
          </div>
        </div>
        <p v-if="!languageSaved" class="preference-notice" role="status">{{ t('languageUnavailable') }}</p>
      </div>
    </div>
  </section>
</template>
