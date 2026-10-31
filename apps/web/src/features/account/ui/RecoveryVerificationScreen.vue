<script setup lang="ts">
import {computed,onUnmounted,ref} from 'vue'
import {identity,onIdentityCleanup} from '../../identity'
import {language} from '../../ui-preview'
import {attestRemotePhotoRecovery,inspectRemoteRecoveryCoverage,
  type CloudRecoveryCoverage} from '../infrastructure/second-device-recovery'

const ru=computed(()=>language.value==='ru')
const copy=computed(()=>ru.value?{
  title:'Проверка восстановления',intro:'На втором доверенном устройстве введите UUID фотографии, созданной другим устройством того же аккаунта. Все важные объекты будут заново скачаны с сервера и расшифрованы.',
  photo:'UUID фотографии',verify:'Проверить облачное восстановление',
  checking:'Загружаем и расшифровываем все объекты…',success:'Второе устройство подтвердило расшифровку объектов',
  error:'Не удалось завершить проверку: ',locked:'Требуется активный аккаунт и соединение с сервером.',
  warning:'Результат — подписанное подтверждение устройства, а не гарантия резервной копии. Удаление фотографий и ключей по-прежнему запрещено.',
  back:'Назад к защите данных',count:'Проверенных объектов:',
  coverage:'Посмотреть подтверждения других устройств',
  coverageState:'Актуальных объектов',coverageDevices:'Другие проверявшие устройства',
  complete:'Все объекты подтверждены',partial:'Подтверждение неполное',none:'Подтверждений пока нет',
}:{
  title:'Verify recovery',intro:'On a second trusted device, enter the photo UUID originally captured on another device of the same account. Every critical cloud object is re-downloaded and decrypted.',
  photo:'Photo UUID',verify:'Verify cloud recovery',
  checking:'Downloading and decrypting every object…',success:'Second device attested decrypted objects',
  error:'Verification could not complete: ',locked:'Active Identity and server connection required.',
  warning:'This is a signed device attestation, not a backup guarantee. Photo and key destruction remain disabled.',
  back:'Back to Data Safety',count:'Verified objects:',
  coverage:'View attestations from other devices',
  coverageState:'Current critical objects',coverageDevices:'Other attesting devices',
  complete:'All objects attested',partial:'Incomplete attestation',none:'No independent attestations yet',
})
const photoId=ref(''),loading=ref(false),failure=ref(''),verified=ref<number|null>(null)
const coverage=ref<CloudRecoveryCoverage|null>(null)
let epoch=0,stopped=false
function reset(){epoch++;loading.value=false;failure.value='';verified.value=null;coverage.value=null}
const unregister=onIdentityCleanup(reset)
async function verify(){
  const current=identity.value,ticket=++epoch
  if(!current||current.offline)return
  loading.value=true;failure.value='';verified.value=null;coverage.value=null
  try{
    const results=await attestRemotePhotoRecovery(photoId.value.trim())
    if(stopped||ticket!==epoch||identity.value?.accountId!==current.accountId||
      identity.value?.deviceId!==current.deviceId)return
    verified.value=results.length
  }catch(error){
    if(!stopped&&ticket===epoch)failure.value=
      error instanceof Error?error.message:'recovery.failed'
  }finally{if(!stopped&&ticket===epoch)loading.value=false}
}
async function inspectCoverage(){
  const current=identity.value,ticket=++epoch
  if(!current||current.offline)return
  loading.value=true;failure.value='';verified.value=null;coverage.value=null
  try{
    const result=await inspectRemoteRecoveryCoverage(photoId.value.trim())
    if(stopped||ticket!==epoch||identity.value?.accountId!==current.accountId||
      identity.value?.deviceId!==current.deviceId)return
    coverage.value=result
  }catch(error){
    if(!stopped&&ticket===epoch)failure.value=
      error instanceof Error?error.message:'recovery.coverage_failed'
  }finally{if(!stopped&&ticket===epoch)loading.value=false}
}
onUnmounted(()=>{stopped=true;reset();unregister()})
</script>
<template>
  <section class="pb-recovery-verify" data-testid="second-device-recovery">
    <nav><RouterLink to="/profile/data-safety">{{copy.back}}</RouterLink></nav>
    <h1>{{copy.title}}</h1>
    <p>{{copy.intro}}</p>
    <p role="note">{{copy.warning}}</p>
    <form @submit.prevent="verify">
      <label>{{copy.photo}}
        <input v-model="photoId" type="text" spellcheck="false" autocomplete="off"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          pattern="[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}"
          required>
      </label>
      <button type="submit" :disabled="loading||!identity||identity.offline">{{copy.verify}}</button>
      <button type="button" :disabled="loading||!identity||identity.offline||!photoId"
        @click="inspectCoverage">{{copy.coverage}}</button>
    </form>
    <p v-if="!identity||identity.offline" role="status">{{copy.locked}}</p>
    <p v-if="loading" role="status">{{copy.checking}}</p>
    <p v-if="failure" role="alert">{{copy.error}}{{failure}}</p>
    <p v-if="verified!==null" role="status">{{copy.success}}. {{copy.count}} {{verified}}</p>
    <section v-if="coverage" class="pb-recovery-coverage" role="status">
      <h2>{{copy.coverageState}}: {{coverage.criticalAssets}}</h2>
      <p v-if="!coverage.devices.length">{{copy.none}}</p>
      <p v-else>{{copy.coverageDevices}}: {{coverage.devices.length}}</p>
      <ul><li v-for="device in coverage.devices" :key="device.deviceId">
        {{device.verifiedAssets}} / {{coverage.criticalAssets}} — {{device.complete?copy.complete:copy.partial}}
      </li></ul>
    </section>
  </section>
</template>
<style scoped>
.pb-recovery-verify{max-width:740px;margin:0 auto;padding:24px 16px 120px;display:grid;gap:16px}
.pb-recovery-verify h1{font-size:24px;margin:0}
.pb-recovery-verify p{margin:0;font-size:13px;line-height:1.6;color:var(--secondary)}
.pb-recovery-verify form{display:grid;gap:14px}
.pb-recovery-verify label{display:grid;gap:8px;font-size:13px}
.pb-recovery-verify input{min-height:44px;padding:10px;border:1px solid var(--border);border-radius:10px;background:var(--panel);color:var(--text)}
.pb-recovery-verify button{min-height:44px;padding:10px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text)}
</style>

<style scoped>
.pb-recovery-coverage{padding:16px;border:1px solid var(--border);border-radius:12px;display:grid;gap:8px}
.pb-recovery-coverage h2{font-size:16px;margin:0}
.pb-recovery-coverage li{font-size:13px;line-height:1.6}
</style>
