<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { appPinEnabled, appPinLegacy, appPinLength, setAppPin, removeAppPin, lockApp } from '../app/lock'
import { pt, pinError } from '../app/pin-text'
import { emergencyReady,emergencyActive,emergencyFailure,emergencyBusy,loadEmergencyRegistration,clearEmergencyView,configureEmergencyPin,disableEmergencyPin } from '../app/emergency'
import { et,emergencyError } from '../app/emergency-text'
import { appLocked, appLockReady } from '../app/lock'
import { lockDelayMs, setLockDelay, type LockDelay } from '../app/preferences'
import PasscodeInput from '../components/PasscodeInput.vue'
const appPin = ref(''), repeatPin = ref(''), oldPin = ref(''), pinNotice = ref(''), pinBusy = ref(false)
const pinMode = ref<'summary' | 'edit' | 'disable'>('summary')
type SecurityPanel = 'app' | 'emergency' | 'devices'
const panel = ref<SecurityPanel>()
const emergencyNew=ref(''),emergencyRepeat=ref(''),emergencyOld=ref(''),
  emergencyNotice=ref(''), emergencyAcknowledged=ref(false)
async function saveEmergency() {
  if(emergencyBusy.value)return
  if(!emergencyAcknowledged.value){emergencyNotice.value=et('warning');return}
  const next=emergencyNew.value,repeat=emergencyRepeat.value,old=emergencyOld.value
  emergencyNew.value='';emergencyRepeat.value=''
  emergencyNotice.value=''
  try{await configureEmergencyPin(next,repeat,old);emergencyNotice.value=et('saved');emergencyAcknowledged.value=false}
  catch(e){emergencyNotice.value=emergencyError(e)}
  finally{emergencyOld.value=''}
}
async function removeEmergency() {
  if(emergencyBusy.value)return
  const old=emergencyOld.value
  emergencyOld.value='';emergencyNotice.value=''
  try{await disableEmergencyPin(old);emergencyNotice.value=et('revoked')}
  catch(e){emergencyNotice.value=emergencyError(e)}
}
async function savePin() {
  if (pinBusy.value) return
  const value = appPin.value, old = oldPin.value
  const owner = account.value?.id, device = deviceId.value
  pinBusy.value = true
  pinNotice.value = ''
  try {
    if (value !== repeatPin.value) throw new Error('pin.mismatch')
    await setAppPin(value, old)
    if (owner === account.value?.id && device === deviceId.value) {
      pinNotice.value = pt('saved')
      pinMode.value = 'summary'
    }
  } catch (error) { pinNotice.value = pinError(error) }
  finally { appPin.value = ''; repeatPin.value = ''; oldPin.value = ''; pinBusy.value = false }
}
async function disablePin() {
  if (pinBusy.value) return
  pinBusy.value = true
  pinNotice.value = ''
  try {
    await removeAppPin(oldPin.value)
    pinNotice.value = pt('disabled')
    pinMode.value = 'summary'
  } catch (error) { pinNotice.value = pinError(error) }
  finally { appPin.value = ''; repeatPin.value = ''; oldPin.value = ''; pinBusy.value = false }
}
function startPin(mode: 'edit' | 'disable') {
  appPin.value = ''; repeatPin.value = ''; oldPin.value = ''; pinNotice.value = ''
  pinMode.value = mode
}
function cancelPin() {
  appPin.value = ''; repeatPin.value = ''; oldPin.value = ''; pinNotice.value = ''
  pinMode.value = 'summary'
}
function changeLockDelay(event: Event) {
  setLockDelay(Number((event.target as HTMLSelectElement).value) as LockDelay)
}
watch(() => `${account.value?.id}:${deviceId.value}`, () => {
  appPin.value = ''; repeatPin.value = ''; oldPin.value = ''; pinNotice.value = ''; pinMode.value = 'summary'
}, { flush: 'sync' })

import { useRouter } from 'vue-router'
import ScreenHeader from '../components/ScreenHeader.vue'
import AppIcon from '../components/AppIcon.vue'
import { account, deviceId, loadIdentity } from '../identity/store'
import { identityRequest } from '../identity/api'
import { a } from '../identity/text'
import { q } from '../crypto/text'
type Device = {
  id: string
  name: string
  revoked_at: string | null
  matrix_revoke_pending: boolean
  last_seen_at: string | null
}
const router = useRouter(),
  devices = ref<Device[]>([]),
  busy = ref(false),
  error = ref('')
async function refresh() {
  devices.value = (
    await identityRequest<{ devices: Device[] }>('/devices')
  ).devices
}
watch([() => account.value?.id, deviceId, appLocked, appLockReady], () => {
  panel.value = undefined
  clearEmergencyView()
  emergencyNew.value='';emergencyRepeat.value='';emergencyOld.value=''
  emergencyNotice.value='';emergencyAcknowledged.value=false
  if (account.value?.id && !appLocked.value && appLockReady.value) {
    void loadEmergencyRegistration()
  }
}, { immediate: true, flush: 'sync' })
onBeforeUnmount(() => {
  emergencyNew.value='';emergencyRepeat.value='';emergencyOld.value=''
})
onMounted(async () => {
  await loadIdentity()
  if (account.value)
    try {
      await refresh()
    } catch {
      error.value = a('failed')
    }
})
watch(
  () => account.value?.id,
  (id, previous) => {
    if (previous && id !== previous) {
      devices.value = []
    }
    if (id && id !== previous)
      void refresh().catch(() => {
        error.value = a('failed')
      })
  },
)
async function revoke(id: string) {
  if (busy.value || !confirm(a('revokeQuestion'))) return
  busy.value = true
  error.value = ''
  try {
    await identityRequest(`/devices/${id}`, 'DELETE')
    if (id === deviceId.value) {
      await loadIdentity(true)
      await router.replace('/profile')
    } else await refresh()
  } catch {
    error.value = a('failed')
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <section class="native-screen">
    <ScreenHeader :title="a('security')" back="/profile" />
    <div class="screen-body">
      <template v-if="account">
        <div v-if="!panel" class="security-overview">
          <button type="button" class="security-choice" @click="panel = 'app'">
            <span class="setting-icon"><AppIcon name="lock" /></span><span><strong>{{ pt('title') }}</strong>
              <small>{{ appPinEnabled ? q('Включён на этом устройстве') : q('Необязательная блокировка приложения') }}</small></span><AppIcon name="chevron" />
          </button>
          <button type="button" class="security-choice" @click="panel = 'emergency'">
            <span class="setting-icon"><AppIcon name="trash" /></span><span><strong>{{ q('Экстренное удаление') }}</strong>
              <small>{{ emergencyActive ? q('PIN настроен') : q('Настроить отдельный PIN') }}</small></span><AppIcon name="chevron" />
          </button>
          <button type="button" class="security-choice" @click="panel = 'devices'">
            <span class="setting-icon"><AppIcon name="device" /></span><span><strong>{{ a('devices') }}</strong>
              <small>{{ devices.length }} · {{ a('current') }}</small></span><AppIcon name="chevron" />
          </button>
          <button type="button" class="security-choice" @click="router.push('/profile/photos-security')">
            <span class="setting-icon"><AppIcon name="key" /></span><span><strong>{{ q('Ключ аккаунта') }}</strong>
              <small>{{ q('Резервная копия и доступ на других устройствах') }}</small></span><AppIcon name="chevron" />
          </button>
        </div>
        <button v-else type="button" class="quiet-button security-panel-back" @click="panel = undefined">
          <AppIcon name="back" />{{ q('Все настройки безопасности') }}
        </button>
        <form v-if="panel === 'app'" class="native-form form-card security-detail pin-settings" @submit.prevent="savePin">
          <h2>{{ pt('title') }}</h2>
          <div :class="['pin-status-card', { active: appPinEnabled }]">
            <span class="pin-status-icon"><AppIcon :name="appPinEnabled ? 'check' : 'lock'" /></span>
            <span><strong>{{ pt(appPinEnabled ? 'active' : 'inactive') }}</strong>
              <small>{{ pt(appPinEnabled ? 'activeHint' : 'inactiveHint') }}</small></span>
          </div>
          <p v-if="appPinLegacy" class="field-hint" role="status">{{ pt('legacy') }}</p>
          <template v-if="pinMode === 'summary'">
            <label v-if="appPinEnabled" class="pin-delay-setting">
              <span><strong>{{ pt('lockAfter') }}</strong></span>
              <select :value="lockDelayMs" @change="changeLockDelay">
                <option :value="0">{{ pt('immediately') }}</option>
                <option :value="10000">{{ pt('after10s') }}</option>
                <option :value="30000">{{ pt('after30s') }}</option>
                <option :value="60000">{{ pt('after1m') }}</option>
                <option :value="300000">{{ pt('after5m') }}</option>
              </select>
            </label>
            <div class="security-actions">
              <button type="button" class="primary-button" @click="startPin('edit')">
                {{ pt(appPinEnabled ? 'change' : 'enable') }}</button>
              <button v-if="appPinEnabled" type="button" class="secondary-button" @click="lockApp">{{ pt('lock') }}</button>
              <button v-if="appPinEnabled" type="button" class="quiet-button subtle-danger" @click="startPin('disable')">{{ pt('disable') }}</button>
            </div>
            <p class="field-hint pin-security-note">{{ pt('hint') }}</p>
          </template>
          <template v-else-if="pinMode === 'edit'">
            <div v-if="appPinEnabled" class="passcode-setting-field"><strong>{{ pt('oldPin') }}</strong>
              <PasscodeInput v-model="oldPin" :label="pt('oldPin')" :disabled="pinBusy" /></div>
            <div class="passcode-setting-field"><strong>{{ pt('newPin') }}</strong>
              <PasscodeInput v-model="appPin" :length="6" :label="pt('newPin')" :disabled="pinBusy" /></div>
            <div class="passcode-setting-field"><strong>{{ pt('repeatPin') }}</strong>
              <PasscodeInput v-model="repeatPin" :length="6" :label="pt('repeatPin')" :disabled="pinBusy" /></div>
            <div class="inline-actions"><button class="primary-button" :disabled="pinBusy || appPin.length < 4 || appPin !== repeatPin">
              {{ pt(appPinEnabled ? 'change' : 'enable') }}</button>
              <button type="button" class="quiet-button" @click="cancelPin">{{ pt('cancel') }}</button></div>
          </template>
          <template v-else>
            <p class="field-hint">{{ pt('disableConfirm') }}</p>
            <div class="passcode-setting-field"><strong>{{ pt('oldPin') }}</strong>
              <PasscodeInput v-model="oldPin" :label="pt('oldPin')" :disabled="pinBusy" /></div>
            <div class="inline-actions"><button type="button" class="danger-button" :disabled="pinBusy || oldPin.length < 4" @click="disablePin">{{ pt('disable') }}</button>
              <button type="button" class="quiet-button" @click="cancelPin">{{ pt('cancel') }}</button></div>
          </template>
          <p v-if="pinNotice" class="profile-save-state" role="status">{{ pinNotice }}</p>
        </form>
        <section v-if="panel === 'emergency'" class="native-form form-card security-detail" aria-labelledby="emergency-setup-title">
          <h2 id="emergency-setup-title">{{ et('title') }}</h2>
          <div :class="['pin-status-card', { active: emergencyActive }]">
            <span class="pin-status-icon"><AppIcon :name="emergencyActive ? 'check' : 'trash'" /></span>
            <span><strong>{{ emergencyActive ? et('saved') : et('enable') }}</strong>
              <small>{{ et('hint') }}</small></span>
          </div>
          <p class="field-hint" role="alert">{{ et('warning') }}</p>
           <p v-if="!appPinEnabled || appPinLength > 6" class="field-hint" role="status">{{ et('requiresAppPin') }}</p>
          <p v-if="emergencyFailure" role="alert">{{ et('offline') }}</p>
          <button v-if="emergencyFailure" type="button" class="secondary-button"
            :disabled="emergencyBusy" @click="loadEmergencyRegistration">{{ et('retry') }}</button>
          <template v-if="emergencyReady">
            <div v-if="emergencyActive" class="passcode-setting-field"><strong>{{ et('old') }}</strong>
              <PasscodeInput v-model="emergencyOld" :length="12" :label="et('old')" :disabled="emergencyBusy" /></div>
            <div class="passcode-setting-field"><strong>{{ et('next') }}</strong>
              <PasscodeInput v-model="emergencyNew" :length="12" :label="et('next')" :disabled="emergencyBusy" /></div>
            <div class="passcode-setting-field"><strong>{{ et('repeat') }}</strong>
              <PasscodeInput v-model="emergencyRepeat" :length="12" :label="et('repeat')" :disabled="emergencyBusy" /></div>
            <label class="field-hint"><input type="checkbox" v-model="emergencyAcknowledged" /> {{ et('acknowledge') }}</label>
             <button class="primary-button" type="button" :disabled="emergencyBusy || !emergencyAcknowledged || !appPinEnabled || appPinLength > 6 || emergencyNew.length !== appPinLength * 2 || emergencyNew !== emergencyRepeat || (emergencyActive && emergencyOld.length < 6)"
              @click="saveEmergency">{{ et(emergencyActive ? 'change' : 'enable') }}</button>
            <button v-if="emergencyActive" class="quiet-button" type="button"
              :disabled="emergencyBusy || !emergencyOld"
              @click="removeEmergency">{{ et('disable') }}</button>
          </template>
          <p v-if="emergencyNotice" role="status">{{ emergencyNotice }}</p>
        </section>
        <template v-if="panel === 'devices'"><h2 class="section-caption">{{ a('devices') }}</h2>
        <article
          v-for="device in devices"
          :key="device.id"
          class="identity-device form-card"
        >
          <AppIcon name="device" />
          <div>
            <strong>{{ device.name }}</strong
            ><small>{{
              device.revoked_at
                ? a('revoked')
                : device.id === deviceId
                  ? a('current')
                  : ''
            }}</small>
          </div>
          <button
            v-if="!device.revoked_at"
            class="app-icon-button subtle-danger"
            :aria-label="`${a('revoke')}: ${device.name}`"
            :disabled="busy"
            @click="revoke(device.id)"
          >
            <AppIcon name="close" />
          </button>
        </article>
        </template>
      </template>
      <p v-else class="field-hint">{{ a('noAccount') }}</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    </div>
  </section>
</template>
