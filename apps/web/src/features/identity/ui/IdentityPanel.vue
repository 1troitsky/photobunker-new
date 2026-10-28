<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { identity, logout, availableDevices, loginWithDevice, offlineUnlock,
  pairingRequests, approvePairing, revokeDevice, rotateRecoveryKey, createPB2 } from '../index'
import { hasPendingRotation } from '../index'
import type { LocalDevice } from '../index'
import { AppIcon, language } from '../../ui-preview'

const ru=computed(()=>language.value==='ru')
const busy=ref(false),error=ref(''),notice=ref('')
const local=ref<LocalDevice[]>([])
const pairings=ref<{id:string;device_id:string;device_spki:string;ecdh_spki:string;fingerprint:string}[]>([])
const fingerprint=ref<Record<string,string>>({})
const nextRecovery=ref(''),confirm=ref(false)
const rotationPending=ref(false)
const txt=computed(()=>({
  guest:ru.value?'Анонимный аккаунт пока не открыт':'No anonymous account unlocked',
  loss:ru.value?'Без ключа и доверенных устройств восстановление невозможно.':'Recovery without the key and all trusted devices is impossible.',
  online:ru.value?'Устройство подтверждено':'Trusted device verified',
  offline:ru.value?'Локальный доступ · сервер не проверен':'Offline access · server not verified',
  devices:ru.value?'Доступные на этом устройстве аккаунты':'Accounts available on this device',
  login:ru.value?'Войти':'Sign in',
  offlineOpen:ru.value?'Открыть локально без сети':'Unlock local data offline',
  logout:ru.value?'Выйти':'Sign out',
  revoke:ru.value?'Отозвать устройство':'Revoke device',
  pending:ru.value?'Запросы подключения':'Pairing requests',
  refresh:ru.value?'Обновить':'Refresh',
  approve:ru.value?'Сравнить отпечаток и подтвердить':'Compare fingerprint and approve',
  code:ru.value?'Введите первые 12 символов отпечатка с нового устройства':'Enter the first 12 characters displayed on the new device',
  rotate:ru.value?'Сменить ключ восстановления':'Rotate Recovery Key',
  saved:ru.value?'Новый ключ сохранён в безопасном месте':'I saved the new key securely',
  apply:ru.value?'Подтвердить смену ключа':'Confirm rotation',
  resumeRotation:ru.value?'Введите новый ключ, который вы сохранили перед незавершённой сменой':'Enter the new key saved before the interrupted rotation',
  noReset:ru.value?'Поддержка не сможет вернуть утраченный ключ.':'Support cannot recover a lost key.',
  error:ru.value?'Операция не завершена:':'Operation not completed:',
}))
async function refresh(){
  try{
    local.value=await availableDevices()
    if(identity.value && !identity.value.offline){
      pairings.value=await pairingRequests()
      rotationPending.value=await hasPendingRotation()
    }else rotationPending.value=false
  }catch(e){error.value=txt.value.error+' '+String(e)}
}
onMounted(()=>{void refresh()})
async function run(action:()=>Promise<void>){
  busy.value=true;error.value='';notice.value=''
  try{await action();await refresh()}
  catch(e){error.value=txt.value.error+' '+(e instanceof Error?e.message:String(e))}
  finally{busy.value=false}
}
async function generateRotation(){
  try{nextRecovery.value=(await createPB2()).encoded;confirm.value=false}
  catch(e){error.value=String(e)}
}
async function applyRotation(){
  await run(async()=>{await rotateRecoveryKey(nextRecovery.value.trim());nextRecovery.value='';confirm.value=false;rotationPending.value=false})
}
async function leave(){
  await run(async()=>{await logout();await refresh()})
}
</script>
<template>
  <section
    class="identity-panel"
    aria-labelledby="identity-panel-title"
  >
    <h2 id="identity-panel-title">
      {{ ru?'Анонимная идентификация':'Anonymous identity' }}
    </h2>
    <p class="hint">
      {{ txt.loss }}
    </p>
    <div
      v-if="identity"
      class="identity-summary"
      data-testid="identity-authenticated"
    >
      <AppIcon name="shield" /><div>
        <strong>{{ identity.offline?txt.offline:txt.online }}</strong>
        <small>{{ identity.accountId }}</small><small>{{ identity.deviceId }}</small>
      </div>
      <button
        type="button"
        class="subtle-button"
        :disabled="busy"
        @click="leave"
      >
        {{ txt.logout }}
      </button>
    </div>
    <div
      v-else
      class="identity-actions"
    >
      <p>{{ txt.guest }}</p>
      <RouterLink
        to="/account/create"
        class="primary-button"
      >{{ ru?'Создать аккаунт':'Create account' }}</RouterLink>
      <RouterLink
        to="/account/restore"
        class="subtle-button"
      >{{ ru?'Восстановить по ключу':'Restore by key' }}</RouterLink>
    </div>
    <div class="identity-settings-group">
      <h3>{{ txt.devices }}</h3>
      <div
        v-for="device in local"
        :key="device.deviceId"
        class="identity-device-row"
      >
        <span><AppIcon name="shield" /><small>{{ device.accountId }} · {{ device.deviceId.slice(0,8) }}</small></span>
        <button
          type="button"
          :disabled="busy"
          @click="run(()=>loginWithDevice(device))"
        >
          {{ txt.login }}
        </button>
        <button
          type="button"
          :disabled="busy"
          @click="run(()=>offlineUnlock(device))"
        >
          {{ txt.offlineOpen }}
        </button>
      </div>
    </div>
    <template v-if="identity && !identity.offline">
      <div class="identity-settings-group">
        <div class="identity-section-heading">
          <h3>{{ txt.pending }}</h3><button
            type="button"
            class="subtle-button"
            @click="refresh"
          >
            {{ txt.refresh }}
          </button>
        </div>
        <div
          v-for="request in pairings"
          :key="request.id"
          class="identity-pair-request"
        >
          <span>{{ request.fingerprint.slice(0,12) }}</span>
          <label>{{ txt.code }}<input
            v-model="fingerprint[request.id]"
            maxlength="12"
            spellcheck="false"
            autocomplete="off"
          ></label>
          <button
            class="subtle-button"
            type="button"
            :disabled="busy"
            @click="run(()=>approvePairing(request,fingerprint[request.id]??''))"
          >
            {{ txt.approve }}
          </button>
        </div>
        <p
          v-if="!pairings.length"
          class="hint"
        >
          {{ ru?'Ожидающих запросов нет':'No pending requests' }}
        </p>
      </div>
      <div class="identity-settings-group">
        <h3>{{ txt.rotate }}</h3>
        <p class="hint">
          {{ txt.noReset }}
        </p>
        <button
          v-if="!nextRecovery && !rotationPending"
          type="button"
          class="subtle-button"
          @click="generateRotation"
        >
          {{ txt.rotate }}
        </button>
        <div
          v-else
          class="identity-form"
        >
          <label
            v-if="rotationPending"
            for="rotation-key"
          >{{ txt.resumeRotation }}</label>
          <textarea
            id="rotation-key"
            v-model="nextRecovery"
            :readonly="!rotationPending"
            rows="4"
            spellcheck="false"
          />
          <label class="identity-confirm"><input
            v-model="confirm"
            type="checkbox"
          >{{ txt.saved }}</label>
          <button
            class="primary-button"
            type="button"
            :disabled="busy||!confirm||!nextRecovery"
            @click="applyRotation"
          >
            {{ txt.apply }}
          </button>
        </div>
      </div>
      <div class="identity-settings-group">
        <h3>{{ ru?'Отзыв устройств':'Device revocation' }}</h3>
        <button
          v-if="identity"
          type="button"
          class="subtle-button"
          :disabled="busy"
          @click="run(()=>revokeDevice(identity!.deviceId))"
        >
          {{ txt.revoke }}
        </button>
      </div>
    </template>
    <p
      v-if="error"
      role="alert"
      class="identity-error"
    >
      {{ error }}
    </p>
    <p
      v-if="notice"
      role="status"
    >
      {{ notice }}
    </p>
  </section>
</template>
