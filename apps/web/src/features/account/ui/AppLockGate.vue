<script setup lang="ts">
import {computed,ref} from 'vue'
import {useRouter} from 'vue-router'
import {appLockState,unlockAppPin,forgetRuntime} from '../../identity'
import {language} from '../../ui-preview'
const ru=computed(()=>language.value==='ru')
const pin=ref(''),busy=ref(false),error=ref(''),router=useRouter()
async function recover(){
  if(busy.value)return
  forgetRuntime()
  pin.value=''
  await router.replace('/account/restore')
}
const copy=computed(()=>ru.value?{
  title:'PhotoBunker заблокирован',hint:'Введите PIN устройства. Это не ключ восстановления аккаунта.',
  unlock:'Разблокировать',loading:'Проверяем PIN…',
  unavailable:'PIN-хранилище повреждено или недоступно. Автоматический обход запрещён.',
  failed:'Неверный PIN, задержка после ошибок или ошибка хранения. Доступ не предоставлен.',
  recovery:'Восстановление через Recovery Key создаёт новое доверенное устройство. Локальные фото и ключи не удаляются.',
  recover:'Восстановить по ключу',
}:{
  title:'PhotoBunker locked',hint:'Enter the device PIN. This is not your account Recovery Key.',
  unlock:'Unlock',loading:'Verifying PIN…',
  unavailable:'PIN storage is corrupt or unavailable. Automatic bypass is forbidden.',
  failed:'Wrong PIN, retry cooldown or storage failure. Access remains blocked.',
  recovery:'Recovery Key restoration enrolls a new trusted device. Existing local photos and keys are not erased.',
  recover:'Restore with Recovery Key',
})
async function unlock(){
  if(busy.value||!appLockState.value.ready)return
  busy.value=true;error.value=''
  try{await unlockAppPin(pin.value);pin.value=''}
  catch{pin.value='';error.value=copy.value.failed}
  finally{busy.value=false}
}
</script>
<template>
  <main class="pb-lock-gate" data-testid="pb2-app-lock">
    <form class="pb-lock-panel" @submit.prevent="unlock">
      <h1>{{copy.title}}</h1><p>{{copy.hint}}</p>
      <p v-if="!appLockState.ready" role="alert">{{copy.unavailable}}</p>
      <template v-else>
        <label for="app-lock-pin">PIN</label>
        <input id="app-lock-pin" v-model="pin" type="password" inputmode="numeric"
          pattern="[0-9]{6,8}" minlength="6" maxlength="8" autocomplete="off"
          :disabled="busy" required>
        <button type="submit" :disabled="busy||pin.length<6">{{busy?copy.loading:copy.unlock}}</button>
      </template>
      <p v-if="error" role="alert">{{error}}</p>
      <p class="pb-lock-note">{{copy.recovery}}</p>
      <button type="button" :disabled="busy" @click="recover">{{copy.recover}}</button>
    </form>
  </main>
</template>
<style scoped>
.pb-lock-gate{min-height:100dvh;display:grid;place-items:center;padding:24px;background:var(--panel);color:var(--text)}
.pb-lock-panel{display:grid;gap:14px;width:min(100%,400px);padding:24px;background:var(--surface);border:1px solid var(--border);border-radius:16px}
.pb-lock-panel h1{font-size:23px;margin:0}.pb-lock-panel p{font-size:13px;line-height:1.55;margin:0}
.pb-lock-panel input,.pb-lock-panel button{font:inherit;min-height:48px;border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--panel);color:var(--text)}
.pb-lock-panel button{cursor:pointer}.pb-lock-note{color:var(--secondary)}
</style>
