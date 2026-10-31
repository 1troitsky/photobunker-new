<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import {identity,onIdentityCleanup,appLockState,configureAppPin,lockApp} from '../../identity'
import {language} from '../../ui-preview'
import {inspectDeviceDataSafety} from '../application/data-safety'
import type {SafetyDecision} from '../domain/data-safety'
import {configureDevicePin,devicePinConfigured,type DevicePinKind} from '../infrastructure/device-pin'

const ru=computed(()=>language.value==='ru')
const copy=computed(()=>ru.value?{
  title:'Защита данных и PIN',intro:'Проверка только читает состояние хранилища. Ничего не удаляет и не меняет.',
  locked:'Сначала откройте аккаунт.',check:'Проверить состояние',checking:'Проверяем защищённое хранилище…',
  failed:'Не удалось безопасно прочитать состояние хранилища.',
  photos:'Локальных фото',unconfirmed:'Без подтверждения синхронизации',
  outbox:'Незавершённых операций',inFlight:'Синхронизация / повтор',
  warning:'Удаление устройства и экстренная очистка недоступны. Даже синхронизированное фото нельзя считать восстановимым без проверки на другом устройстве.',
  appPin:'PIN блокировки приложения',deletePin:'PIN локального удаления',emergencyPin:'Экстренный PIN',
  inactive:'Недоступен до отдельной проверки безопасности',back:'Назад в профиль',
  enabled:'PIN настроен',configure:'Настроить PIN',lockNow:'Заблокировать сейчас',
  pinHint:'6–8 цифр. PIN не заменяет ключ восстановления. Не сохраняется в открытом виде.',
  pinMismatch:'PIN не совпадают.',pinFailed:'Настройка PIN не удалась — проверьте хранилище.',
  issues:'Причины запрета удаления',
  time_untrusted:'Недостоверное время',offline:'Нет связи с сервером',
  local_copies_unconfirmed:'Есть фотографии без подтверждённой синхронизации',
  operations_pending:'Есть незавершённые локальные операции',
  remote_recovery_not_proven:'Восстановление на втором устройстве не доказано',
  device_erase_not_implemented:'Механизм безопасного удаления не реализован',
  photo_journal_incomplete:'Есть незавершённые зашифрованные записи',stores_not_inspected:'Все хранилища ещё не проверены',
  otherQueues:'Операции заданий, команд и доступа',journals:'Незавершённые записи файлов',
  sharedCiphertext:'Общие зашифрованные записи аккаунта',unknownCiphertext:'Осиротевшие или неопределённые записи',
  account_shared_ciphertext:'Есть общие для аккаунта зашифрованные данные',
  unattributed_local_artifacts:'Есть файлы с неустановленным владельцем или без ссылки',
  pinSetup:'Подготовить отдельный PIN (8 цифр)',pinReady:'PIN сохранён. Удаление не активировано.',pinFailure:'PIN не сохранён',
  verifyOnly:'Настройка этих PIN не разрешает удаление. Экстренный режим пока не включён.',
}:{
  title:'Data protection and PIN',intro:'This check only reads storage state. It never deletes or changes data.',
  locked:'Unlock the account first.',check:'Inspect device data',checking:'Inspecting encrypted storage…',
  failed:'Could not safely inspect this storage.',
  photos:'Local photos',unconfirmed:'Without confirmed sync',
  outbox:'Pending operations',inFlight:'Syncing / retry',
  warning:'Device erasure and emergency wipe are disabled. A synced photo is not proven recoverable until it has been restored on another trusted device.',
  appPin:'App lock PIN',deletePin:'Local deletion PIN',emergencyPin:'Emergency PIN',
  inactive:'Unavailable pending separate security acceptance',back:'Back to profile',
  enabled:'PIN configured',configure:'Configure PIN',lockNow:'Lock now',
  pinHint:'6–8 digits. PIN does not replace the Recovery Key. Never stored in plaintext.',
  pinMismatch:'PIN entries do not match.',pinFailed:'PIN setup failed — inspect device storage.',
  issues:'Reasons deletion is blocked',
  time_untrusted:'Untrusted time',offline:'Server unavailable',
  local_copies_unconfirmed:'Photos without confirmed cloud sync',
  operations_pending:'Pending local operations',
  remote_recovery_not_proven:'Recovery on a second device is unverified',
  device_erase_not_implemented:'Safe device-erasure workflow is not implemented',
  photo_journal_incomplete:'Unfinished encrypted file writes remain',stores_not_inspected:'Not all stores were inspected',
  otherQueues:'Assignment, team and sharing operations',journals:'Unfinished file writes',
  sharedCiphertext:'Account-shared encrypted records',unknownCiphertext:'Unattributed or orphan records',
  account_shared_ciphertext:'Account-shared ciphertext is retained',
  unattributed_local_artifacts:'Unattributed or orphaned local files exist',
  pinSetup:'Prepare separate PIN (8 digits)',pinReady:'PIN saved. Erasure is not enabled.',pinFailure:'PIN was not saved',
  verifyOnly:'Setting these PINs never authorizes deletion. Emergency mode is not enabled.',
})
const report=ref<SafetyDecision|null>(null),busy=ref(false),failed=ref(false)
const pin=ref(''),pinConfirm=ref(''),pinError=ref(''),pinBusy=ref(false)
const prepared=ref<Record<DevicePinKind,boolean>>({'local-delete':false,emergency:false})
const setup=ref<DevicePinKind|null>(null),separatePin=ref(''),separateConfirm=ref('')
const separateError=ref(''),separateBusy=ref(false)
async function scanPins(){
  const current=identity.value
  if(!current)return
  try{
    const first=await devicePinConfigured('local-delete')
    const second=await devicePinConfigured('emergency')
    if(identity.value?.accountId===current.accountId&&identity.value?.deviceId===current.deviceId)
      prepared.value={'local-delete':first,emergency:second}
  }catch{separateError.value=copy.value.pinFailure}
}
async function saveSeparatePin(kind:DevicePinKind){
  if(separatePin.value!==separateConfirm.value){separateError.value=copy.value.pinMismatch;return}
  separateBusy.value=true;separateError.value=''
  try{
    await configureDevicePin(kind,separatePin.value)
    setup.value=null;separatePin.value='';separateConfirm.value=''
    await scanPins()
  }catch{separateError.value=copy.value.pinFailure}
  finally{separateBusy.value=false}
}
async function setPin(){
  pinError.value=''
  if(pin.value!==pinConfirm.value){pinError.value=copy.value.pinMismatch;return}
  pinBusy.value=true
  try{await configureAppPin(pin.value);pin.value='';pinConfirm.value=''}
  catch{pinError.value=copy.value.pinFailed}
  finally{pinBusy.value=false}
}
let epoch=0,stopped=false
function clear(){epoch++;report.value=null;busy.value=false;failed.value=false
  pin.value='';pinConfirm.value='';pinError.value=''
  separatePin.value='';separateConfirm.value='';setup.value=null;separateError.value=''
  prepared.value={'local-delete':false,emergency:false}}
const unsubscribe=onIdentityCleanup(clear)
async function inspect(){
  const ticket=++epoch,account=identity.value
  report.value=null;failed.value=false
  if(!account){failed.value=true;return}
  busy.value=true
  try{
    const result=await inspectDeviceDataSafety()
    if(stopped||epoch!==ticket||identity.value?.accountId!==account.accountId||
      identity.value?.deviceId!==account.deviceId)return
    report.value=result
  }catch{
    if(!stopped&&ticket===epoch)failed.value=true
  }finally{if(!stopped&&ticket===epoch)busy.value=false}
}
onMounted(()=>{stopped=false;if(identity.value){void inspect();void scanPins()}})
onUnmounted(()=>{stopped=true;clear();unsubscribe()})
watch(()=>[identity.value?.accountId,identity.value?.deviceId],()=>{
  clear();if(identity.value){void inspect();void scanPins()}
},{flush:'sync'})
const issueLabel=(code:string)=>copy.value[code as keyof typeof copy.value]??code
</script>
<template>
  <section class="pb-data-safety" data-testid="g5-data-safety">
    <nav><RouterLink to="/profile">{{copy.back}}</RouterLink></nav>
    <h1>{{copy.title}}</h1><p>{{copy.intro}}</p>
    <div class="pb-data-safety-panel">
      <h2>{{copy.appPin}}</h2>
      <p>{{copy.pinHint}}</p>
      <p v-if="appLockState.configured">{{copy.enabled}}</p>
      <button v-if="appLockState.configured" type="button" @click="lockApp">{{copy.lockNow}}</button>
      <form v-else-if="identity && appLockState.ready" class="pb-pin-settings" @submit.prevent="setPin">
        <label>PIN <input v-model="pin" type="password" inputmode="numeric" pattern="[0-9]{6,8}"
          minlength="6" maxlength="8" autocomplete="new-password" required></label>
        <label>PIN × 2 <input v-model="pinConfirm" type="password" inputmode="numeric"
          pattern="[0-9]{6,8}" minlength="6" maxlength="8" autocomplete="new-password" required></label>
        <button type="submit" :disabled="pinBusy||!pin||pin!==pinConfirm">{{copy.configure}}</button>
        <p v-if="pinError" role="alert">{{pinError}}</p>
      </form>
      <p v-else>{{copy.inactive}}</p>
      <p role="note">{{copy.verifyOnly}}</p>
      <section v-for="kind in (['local-delete','emergency'] as DevicePinKind[])" :key="kind">
        <h2>{{kind==='local-delete'?copy.deletePin:copy.emergencyPin}}</h2>
        <p>{{prepared[kind]?copy.pinReady:copy.inactive}}</p>
        <button v-if="!prepared[kind]&&setup!==kind" type="button"
          @click="setup=kind;separatePin='';separateConfirm='';separateError=''">{{copy.pinSetup}}</button>
        <form v-if="setup===kind&&!prepared[kind]" class="pb-pin-settings" @submit.prevent="saveSeparatePin(kind)">
          <label>PIN <input v-model="separatePin" type="password" inputmode="numeric" autocomplete="new-password"
            pattern="[0-9]{8}" minlength="8" maxlength="8" required></label>
          <label>PIN × 2 <input v-model="separateConfirm" type="password" inputmode="numeric" autocomplete="new-password"
            pattern="[0-9]{8}" minlength="8" maxlength="8" required></label>
          <button type="submit" :disabled="separateBusy||separatePin!==separateConfirm">{{copy.pinSetup}}</button>
          <p v-if="separateError" role="alert">{{separateError}}</p>
        </form>
      </section>
    </div>
    <p role="note">{{copy.warning}}</p>
    <button type="button" :disabled="busy||!identity" @click="inspect">{{copy.check}}</button>
    <p v-if="!identity" role="status">{{copy.locked}}</p>
    <p v-else-if="busy" role="status">{{copy.checking}}</p>
    <p v-else-if="failed" role="alert">{{copy.failed}}</p>
    <template v-else-if="report">
      <dl class="pb-data-safety-facts">
        <div><dt>{{copy.photos}}</dt><dd>{{report.photoCount}}</dd></div>
        <div><dt>{{copy.unconfirmed}}</dt><dd>{{report.unconfirmedCount}}</dd></div>
        <div><dt>{{copy.outbox}}</dt><dd>{{report.outboxCount}}</dd></div>
        <div><dt>{{copy.inFlight}}</dt><dd>{{report.inFlightCount}}</dd></div>
        <div v-if="report.storeRisk"><dt>{{copy.otherQueues}}</dt>
          <dd>{{report.storeRisk.assignmentPending+report.storeRisk.collaborationPending+report.storeRisk.grantPending}}</dd></div>
        <div v-if="report.storeRisk"><dt>{{copy.journals}}</dt><dd>{{report.storeRisk.photoJournals}}</dd></div>
        <div v-if="report.storeRisk?.ownership"><dt>{{copy.sharedCiphertext}}</dt>
          <dd>{{report.storeRisk.ownership.accountShared}}</dd></div>
        <div v-if="report.storeRisk?.ownership"><dt>{{copy.unknownCiphertext}}</dt>
          <dd>{{report.storeRisk.ownership.unattributed+(report.storeRisk.orphanArtifacts??0)}}</dd></div>
      </dl>
      <h2>{{copy.issues}}</h2>
      <ul><li v-for="reason in report.blockingReasons" :key="reason">{{issueLabel(reason)}}</li></ul>
    </template>
  </section>
</template>
<style scoped>
.pb-data-safety{max-width:760px;margin:0 auto;padding:24px 16px 130px;display:grid;gap:14px}
.pb-data-safety h1{font-size:24px;margin:0}
.pb-data-safety h2{font-size:17px;margin:0}
.pb-data-safety p{color:var(--secondary);font-size:13px;line-height:1.55;margin:0}
.pb-pin-settings{display:grid;gap:10px}.pb-pin-settings label{display:grid;gap:5px}
.pb-pin-settings input{min-height:44px;border:1px solid var(--border);border-radius:10px;background:var(--panel);color:var(--text);padding:10px}
.pb-data-safety-panel{display:grid;gap:10px;border:1px solid var(--border);background:var(--surface);border-radius:12px;padding:16px}
.pb-data-safety button{min-height:44px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);padding:10px}
.pb-data-safety-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0}
.pb-data-safety-facts div{padding:14px;border:1px solid var(--border);border-radius:10px;min-width:0}
.pb-data-safety-facts dt{color:var(--secondary);font-size:12px}
.pb-data-safety-facts dd{font-size:18px;font-weight:600;margin:4px 0 0}
.pb-data-safety li{margin:6px 0}
@media(max-width:420px){.pb-data-safety-facts{grid-template-columns:1fr}}
</style>
