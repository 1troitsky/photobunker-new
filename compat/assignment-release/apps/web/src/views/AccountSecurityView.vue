<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { appPinEnabled, appPinLegacy, setAppPin, removeAppPin, lockApp } from '../app/lock'
import { pt, pinError } from '../app/pin-text'
import { localDeletePinEnabled,localDeletePinReady,localDeletePinFailure,loadLocalDeletePin,configureLocalDeletePin,disableLocalDeletePin } from '../app/local-delete-pin'
import { localDeleteText as ld, localDeleteError } from '../app/local-delete-text'
import { freshLocalDeletePreflight, type DeleteScope } from '../app/local-delete-preflight'
import { commitLocalDeletion, deletionBlocked } from '../app/local-delete-run'
import AppSheet from '../components/AppSheet.vue'
import { emergencyReady,emergencyActive,emergencyFailure,emergencyBusy,loadEmergencyRegistration,clearEmergencyView,configureEmergencyPin,disableEmergencyPin } from '../app/emergency'
import { et,emergencyError } from '../app/emergency-text'
import { appLocked, appLockReady } from '../app/lock'
const appPin = ref(''), oldPin = ref(''), pinNotice = ref(''), pinBusy = ref(false)
const emergencyNew=ref(''),emergencyRepeat=ref(''),emergencyOld=ref(''),
  emergencyApp=ref(''),emergencyPB1=ref(''),emergencyNotice=ref('')
async function saveEmergency() {
  if(emergencyBusy.value)return
  const next=emergencyNew.value,repeat=emergencyRepeat.value,
    pb1=emergencyPB1.value,app=emergencyApp.value,old=emergencyOld.value
  emergencyNew.value='';emergencyRepeat.value='';emergencyPB1.value=''
  emergencyNotice.value=''
  try{await configureEmergencyPin(next,repeat,pb1,app,old);emergencyNotice.value=et('saved')}
  catch(e){emergencyNotice.value=emergencyError(e)}
  finally{emergencyApp.value='';emergencyOld.value=''}
}
async function removeEmergency() {
  if(emergencyBusy.value)return
  const old=emergencyOld.value,pb1=emergencyPB1.value,app=emergencyApp.value
  emergencyOld.value='';emergencyPB1.value='';emergencyApp.value='';emergencyNotice.value=''
  try{await disableEmergencyPin(old,pb1,app);emergencyNotice.value=et('revoked')}
  catch(e){emergencyNotice.value=emergencyError(e)}
}
async function savePin() {
  if (pinBusy.value) return
  const value = appPin.value, old = oldPin.value
  const owner = account.value?.id, device = deviceId.value
  pinBusy.value = true
  pinNotice.value = ''
  try {
    await setAppPin(value, old)
    if (owner === account.value?.id && device === deviceId.value) pinNotice.value = pt('saved')
  } catch (error) { pinNotice.value = pinError(error) }
  finally { appPin.value = ''; oldPin.value = ''; pinBusy.value = false }
}
async function disablePin() {
  if (pinBusy.value) return
  pinBusy.value = true
  pinNotice.value = ''
  try {
    await removeAppPin(oldPin.value)
    pinNotice.value = pt('disabled')
  } catch (error) { pinNotice.value = pinError(error) }
  finally { appPin.value = ''; oldPin.value = ''; pinBusy.value = false }
}
watch(() => `${account.value?.id}:${deviceId.value}`, () => {
  appPin.value = ''; oldPin.value = ''; pinNotice.value = ''
}, { flush: 'sync' })

import { useRouter } from 'vue-router'
import ScreenHeader from '../components/ScreenHeader.vue'
import AppIcon from '../components/AppIcon.vue'
import { account, deviceId, loadIdentity } from '../identity/store'
import { identityRequest } from '../identity/api'
import { accessCode } from '../server/api'
import { a } from '../identity/text'
import { q } from '../crypto/text'
type Device = {
  id: string
  name: string
  revoked_at: string | null
  matrix_revoke_pending: boolean
  last_seen_at: string | null
}
const deletePinNew = ref(''), deletePinRepeat = ref(''), deletePinOld = ref(''),
  deletePinApp = ref(''), recoveryPb1 = ref(''), actionPin = ref(''),
  deletePinNotice = ref(''), deletePinBusy = ref(false), destructiveSheet = ref(false),
  exactScope = ref<DeleteScope>(), finalConfirm = ref(false)
const router = useRouter(),
  devices = ref<Device[]>([]),
  busy = ref(false),
  error = ref(''),
  proved = ref(false),
  matrixReady = ref<boolean>()
async function refresh() {
  devices.value = (
    await identityRequest<{ devices: Device[] }>('/devices')
  ).devices
  try {
    matrixReady.value = (
      await identityRequest<{ matrix: { ready: boolean } }>('/infrastructure')
    ).matrix.ready
  } catch {
    matrixReady.value = false
  }
}
watch([() => account.value?.id, deviceId, appLocked, appLockReady], () => {
  destructiveSheet.value = false; exactScope.value = undefined; finalConfirm.value = false
  deletePinNew.value = ''; deletePinRepeat.value = ''; deletePinOld.value = ''
  deletePinApp.value = ''; recoveryPb1.value = ''; actionPin.value = ''
  clearEmergencyView()
  emergencyNew.value='';emergencyRepeat.value='';emergencyOld.value=''
  emergencyApp.value='';emergencyPB1.value='';emergencyNotice.value=''
  if (account.value?.id && !appLocked.value && appLockReady.value) {
    void loadLocalDeletePin()
    void loadEmergencyRegistration()
  }
}, { immediate: true, flush: 'sync' })
onBeforeUnmount(() => {
  deletePinNew.value = ''; deletePinRepeat.value = ''; deletePinOld.value = ''
  deletePinApp.value = ''; recoveryPb1.value = ''; actionPin.value = ''
  emergencyNew.value='';emergencyRepeat.value='';emergencyOld.value=''
  emergencyApp.value='';emergencyPB1.value=''
})
async function configureDeletePin() {
  if (deletePinBusy.value) return
  const next = deletePinNew.value, repeated = deletePinRepeat.value,
    pb1 = recoveryPb1.value, app = deletePinApp.value, old = deletePinOld.value
  // Clear PB1 and inputs before any async work (JS strings cannot be securely zeroed).
  recoveryPb1.value = ''; deletePinNew.value = ''; deletePinRepeat.value = ''
  deletePinBusy.value = true; deletePinNotice.value = ''
  try {
    await configureLocalDeletePin(next,repeated,pb1,app,old)
    deletePinNotice.value = ld('save')
  } catch(error) { deletePinNotice.value = localDeleteError(error) }
  finally { deletePinOld.value = ''; deletePinApp.value = ''; deletePinBusy.value = false }
}
async function disableDeletePin() {
  if (deletePinBusy.value) return
  deletePinBusy.value = true; deletePinNotice.value = ''
  try { await disableLocalDeletePin(deletePinOld.value,deletePinApp.value);deletePinNotice.value=ld('disabled') }
  catch(error) { deletePinNotice.value=localDeleteError(error) }
  finally { deletePinOld.value='';deletePinApp.value='';deletePinBusy.value=false }
}
async function checkDeleteReadiness() {
  if(deletePinBusy.value || !actionPin.value || !localDeletePinEnabled.value) return
  deletePinBusy.value=true;deletePinNotice.value='';exactScope.value=undefined;finalConfirm.value=false
  try {
    const inspected=await freshLocalDeletePreflight(actionPin.value)
    exactScope.value=inspected.scope
    destructiveSheet.value=true
  } catch(error) { deletePinNotice.value=localDeleteError(error);actionPin.value='' }
  finally {deletePinBusy.value=false}
}
async function clearThisDevice() {
  if(deletePinBusy.value || !finalConfirm.value || !exactScope.value)return
  deletePinBusy.value=true;deletePinNotice.value=''
  const pin=actionPin.value,scope=exactScope.value
  actionPin.value='';destructiveSheet.value=false;exactScope.value=undefined;finalConfirm.value=false
  try {
    const ok=await commitLocalDeletion(pin,scope)
    deletePinNotice.value=ok?ld('finished'):ld('retryNotice')
    if(ok) await router.replace('/welcome')
  } catch(error) {deletePinNotice.value=localDeleteError(error)}
  finally {deletePinBusy.value=false}
}
async function importPB1(event: Event) {
  const input=event.target as HTMLInputElement, file=input.files?.[0]
  try {if(!file || file.size>8192) throw new Error('localDelete.recovery');recoveryPb1.value=await file.text()}
  catch {deletePinNotice.value=ld('recovery')}
  finally {input.value=''}
}
onMounted(async () => {
  await loadIdentity(true)
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
      proved.value = false
      matrixReady.value = undefined
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
async function claim() {
  busy.value = true
  try {
    await identityRequest('/legacy-proof', 'POST', {
      libraryCode: accessCode.value,
    })
    proved.value = true
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
      <template v-if="account"
        ><form class="native-form form-card" @submit.prevent="savePin">
          <h2>{{ pt('title') }}</h2>
          <p class="field-hint">{{ pt('hint') }}</p>
          <p v-if="appPinLegacy" class="field-hint" role="status">{{ pt('legacy') }}</p>
          <label v-if="appPinEnabled">{{ pt('oldPin') }}
            <input v-model="oldPin" type="password" inputmode="numeric"
              pattern="[0-9]*" autocomplete="off" maxlength="8" :disabled="pinBusy" />
          </label>
          <label>{{ pt('newPin') }}
            <input v-model="appPin" type="password" inputmode="numeric"
              pattern="[0-9]*" autocomplete="new-password" maxlength="8"
              minlength="6" :disabled="pinBusy" required />
          </label>
          <button class="secondary-button" :disabled="pinBusy || !appPin">
            {{ pt(appPinEnabled ? 'change' : 'enable') }}</button>
          <button v-if="appPinEnabled" type="button" class="quiet-button"
            :disabled="pinBusy || !oldPin" @click="disablePin">{{ pt('disable') }}</button>
          <button v-if="appPinEnabled" type="button" class="quiet-button"
            :disabled="pinBusy" @click="lockApp">{{ pt('lock') }}</button>
          <p v-if="pinNotice" role="status">{{ pinNotice }}</p>
        </form>
        <section class="native-form form-card" aria-labelledby="local-delete-title">
          <h2 id="local-delete-title">{{ ld('heading') }}</h2>
          <p class="field-hint">{{ ld('boundary') }}</p>
          <p v-if="localDeletePinFailure" role="alert">{{ ld('storage') }}</p>
          <template v-if="localDeletePinReady && !localDeletePinFailure && !deletionBlocked">
            <label v-if="localDeletePinEnabled">{{ ld('current') }}
              <input v-model="deletePinOld" type="password" inputmode="numeric"
                autocomplete="off" maxlength="8" :disabled="deletePinBusy" />
            </label>
            <label>{{ ld('appPin') }}
              <input v-model="deletePinApp" type="password" inputmode="numeric"
                autocomplete="off" maxlength="8" :disabled="deletePinBusy" />
            </label>
            <label>{{ ld('next') }}
              <input v-model="deletePinNew" type="password" inputmode="numeric"
                autocomplete="new-password" maxlength="8" :disabled="deletePinBusy" />
            </label>
            <label>{{ ld('repeat') }}
              <input v-model="deletePinRepeat" type="password" inputmode="numeric"
                autocomplete="new-password" maxlength="8" :disabled="deletePinBusy" />
            </label>
            <label>{{ ld('pb1') }}
              <textarea v-model="recoveryPb1" rows="2" autocomplete="off" spellcheck="false"
                :disabled="deletePinBusy" />
              <input type="file" accept=".txt,text/plain" :disabled="deletePinBusy" @change="importPB1" />
            </label>
            <button type="button" class="secondary-button" :disabled="deletePinBusy"
              @click="configureDeletePin">{{ ld(localDeletePinEnabled ? 'change' : 'enable') }}</button>
            <button v-if="localDeletePinEnabled" type="button" class="quiet-button"
              :disabled="deletePinBusy || !deletePinOld" @click="disableDeletePin">{{ ld('disable') }}</button>
            <div v-if="localDeletePinEnabled" class="native-form">
              <h3>{{ ld('clear') }}</h3>
              <label>{{ ld('current') }}<input v-model="actionPin" type="password"
                inputmode="numeric" autocomplete="off" maxlength="8" :disabled="deletePinBusy" /></label>
              <button class="danger-button" type="button" :disabled="deletePinBusy || !actionPin"
                @click="checkDeleteReadiness">{{ ld('preflight') }}</button>
            </div>
          </template>
          <p v-if="deletePinNotice" role="status">{{ deletePinNotice }}</p>
        </section>
        <section class="native-form form-card" aria-labelledby="emergency-setup-title">
          <h2 id="emergency-setup-title">{{ et('title') }}</h2>
          <p class="field-hint">{{ et('hint') }}</p>
          <p class="field-hint">{{ et('warning') }}</p>
          <p v-if="emergencyFailure" role="alert">{{ et('offline') }}</p>
          <button v-if="emergencyFailure" type="button" class="secondary-button"
            :disabled="emergencyBusy" @click="loadEmergencyRegistration">{{ et('retry') }}</button>
          <template v-if="emergencyReady && !deletionBlocked">
            <label v-if="emergencyActive">{{ et('old') }}
              <input v-model="emergencyOld" type="password" inputmode="numeric"
                autocomplete="off" maxlength="8" :disabled="emergencyBusy" />
            </label>
            <label>{{ et('app') }}
              <input v-model="emergencyApp" type="password" inputmode="numeric"
                autocomplete="off" maxlength="8" :disabled="emergencyBusy" />
            </label>
            <label>{{ et('next') }}
              <input v-model="emergencyNew" type="password" inputmode="numeric"
                autocomplete="new-password" maxlength="8" :disabled="emergencyBusy" />
            </label>
            <label>{{ et('repeat') }}
              <input v-model="emergencyRepeat" type="password" inputmode="numeric"
                autocomplete="new-password" maxlength="8" :disabled="emergencyBusy" />
            </label>
            <label>{{ et('root') }}
              <textarea v-model="emergencyPB1" autocomplete="off" spellcheck="false"
                rows="2" :disabled="emergencyBusy" />
            </label>
            <button class="secondary-button" type="button" :disabled="emergencyBusy"
              @click="saveEmergency">{{ et(emergencyActive ? 'change' : 'enable') }}</button>
            <button v-if="emergencyActive" class="quiet-button" type="button"
              :disabled="emergencyBusy || !emergencyOld || !emergencyPB1"
              @click="removeEmergency">{{ et('disable') }}</button>
          </template>
          <p v-if="emergencyNotice" role="status">{{ emergencyNotice }}</p>
        </section>
        <button
          class="secondary-button"
          @click="router.push('/profile/photos-security')"
        >
          {{ q('Ключ аккаунта') }}
        </button>
        <p class="field-hint">{{ a('securityHint') }}</p>
        <h2 class="section-caption">{{ a('devices') }}</h2>
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
            <p v-if="device.matrix_revoke_pending" class="field-hint">
              {{ a('matrixPending') }}
            </p>
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
        <h2 class="section-caption">{{ a('infrastructure') }}</h2>
        <p class="field-hint">
          {{ a(matrixReady ? 'matrixReady' : 'matrixWaiting') }}
        </p>
        <p class="field-hint">{{ a('kitScope') }}</p>
        <template v-if="accessCode"
          ><h2 class="section-caption">{{ a('legacy') }}</h2>
          <p class="field-hint">{{ a('legacyHint') }}</p>
          <button
            class="secondary-button"
            :disabled="busy || proved"
            @click="claim"
          >
            {{ a('proveLibrary') }}
          </button>
          <p v-if="proved" class="field-hint" role="status">
            {{ a('libraryProved') }}
          </p></template
        ></template
      >
      <p v-else class="field-hint">{{ a('noAccount') }}</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    </div>
  <AppSheet :open="destructiveSheet" :busy="deletePinBusy" :title="ld('confirmTitle')"
      @close="destructiveSheet=false;exactScope=undefined;actionPin='';finalConfirm=false">
      <p>{{ ld('ready') }}</p>
      <p v-if="exactScope"><strong>{{ q('Аккаунт') }}:</strong> <code>{{ exactScope.owner }}</code>
        <strong>{{ q('Устройство') }}:</strong> <code>{{ exactScope.device }}</code></p>
      <p>{{ ld('boundary') }}</p>
      <label class="check-row"><input v-model="finalConfirm" type="checkbox"
        :disabled="deletePinBusy" />{{ ld('confirm') }}</label>
      <button type="button" class="secondary-button"
        @click="destructiveSheet=false;exactScope=undefined;actionPin='';finalConfirm=false">
        {{ ld('cancel') }}</button>
      <button type="button" class="danger-button" :disabled="!finalConfirm || deletePinBusy"
        @click="clearThisDevice">{{ ld('clear') }}</button>
    </AppSheet>
  </section>
</template>
