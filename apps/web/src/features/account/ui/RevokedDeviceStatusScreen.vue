<script setup lang="ts">
import {computed,onMounted,ref} from 'vue'
import {language} from '../../ui-preview'
import {revokedDeviceStatuses,deliverPendingRevocations} from '../index'
import type {RevokedDeviceStatus} from '../infrastructure/revocation-outbox'

const ru=computed(()=>language.value==='ru')
const copy=computed(()=>ru.value?{
 title:'Отзыв доступа устройства',back:'Вернуться',refresh:'Проверить снова',
 pending:'Ожидает подтверждения сервера',revoked:'Доступ отозван сервером',
 clean:'Локальные PIN-верификаторы очищены',cleanPending:'Локальная очистка PIN ещё не завершена',
 data:'Зашифрованные данные сохранены. Это не полное удаление устройства.',
 noIntent:'Нет зарегистрированных намерений об отзыве',
 unreadable:'Не удалось безопасно прочитать журнал.',report:'Остатки зашифрованного хранилища',
warning:'Ни облачные фотографии, ни ключи восстановления, ни локальные копии не уничтожены.',
}:{
 title:'Device access revocation',back:'Return',refresh:'Check again',
 pending:'Waiting for server confirmation',revoked:'Device access revoked by server',
 clean:'Local PIN verifiers cleared',cleanPending:'Local PIN cleanup remains pending',
 data:'Encrypted data is retained. This is not a full device wipe.',
 noIntent:'No device-revocation intents recorded',
 unreadable:'Could not safely read the local journal.',report:'Remaining encrypted storage',
warning:'Cloud photos, recovery keys and local copies have not been destroyed.',
})
const items=ref<RevokedDeviceStatus[]>([])
const busy=ref(false),failed=ref(false)
async function reload(){
  if(busy.value)return
  busy.value=true;failed.value=false
  try{
    await deliverPendingRevocations()
    const rows=await revokedDeviceStatuses()
    items.value=rows
  }catch{failed.value=true}finally{busy.value=false}
}
onMounted(()=>{void reload()})
const pending=(item:RevokedDeviceStatus)=>item.serverState==='pending'
</script>
<template>
  <main class="pb-device-status" data-testid="revoked-device-status">
    <nav><RouterLink to="/welcome">{{copy.back}}</RouterLink></nav>
    <h1>{{copy.title}}</h1>
    <p role="note">{{copy.warning}}</p>
    <button type="button" :disabled="busy" @click="reload">{{copy.refresh}}</button>
    <p v-if="failed" role="alert">{{copy.unreadable}}</p>
    <p v-else-if="!items.length&&!busy">{{copy.noIntent}}</p>
    <section v-for="item in items" :key="item.operationId" class="pb-status-card">
      <h2>{{item.intent==='emergency'?'Emergency':'Local Delete'}}</h2>
      <p><strong>{{pending(item)?copy.pending:copy.revoked}}</strong></p>
      <p>{{item.localCredentialCleanup==='completed'?copy.clean:copy.cleanPending}}</p>
      <p>{{copy.data}}</p>

    </section>
  </main>
</template>
<style scoped>
.pb-device-status{display:grid;gap:14px;max-width:720px;margin:0 auto;padding:24px 16px 120px}
.pb-device-status h1{font-size:24px;margin:0}.pb-device-status h2{font-size:17px;margin:0}
.pb-device-status h3{font-size:15px;margin:0}
.pb-device-status p{margin:0;font-size:13px;line-height:1.6}
.pb-device-status button{min-height:44px;padding:10px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text)}
.pb-status-card{display:grid;gap:10px;padding:18px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}
.pb-status-card dl{display:grid;gap:10px;grid-template-columns:repeat(3,minmax(0,1fr));margin:0}
.pb-status-card dt{font-size:12px;color:var(--secondary)}
.pb-status-card dd{font-size:18px;font-weight:600;margin:2px 0 0}
@media(max-width:480px){.pb-status-card dl{grid-template-columns:1fr}}
</style>
