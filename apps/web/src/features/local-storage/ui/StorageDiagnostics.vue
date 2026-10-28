<script setup lang="ts">
import { computed, ref } from 'vue'
import { identity } from '../../identity'
import { openLocalPhotoVault, probeStorageCapabilities } from '../index'
import type { Capabilities, TimeStatus } from '../domain/contracts'
import { language } from '../../ui-preview'

const ru=computed(()=>language.value==='ru')
const busy=ref(false),state=ref<Capabilities|null>(null),time=ref<TimeStatus|null>(null),error=ref('')
const title=computed(()=>ru.value?'Проверка локального хранилища':'Local storage diagnostics')
const status=(flag:boolean)=>flag?(ru.value?'Работает':'Available'):(ru.value?'Недоступно':'Unavailable')
async function probe(persist:boolean){
  busy.value=true;error.value=''
  try{
    state.value=await probeStorageCapabilities(persist)
    if(identity.value)time.value=await openLocalPhotoVault().time.restoreFromStorage()
  }catch(e){error.value=e instanceof Error?e.message:'storage.probe_failed'}
  finally{busy.value=false}
}
async function refreshTime(){
  busy.value=true;error.value=''
  try{time.value=await openLocalPhotoVault().time.refreshFromServer()}
  catch(e){error.value=e instanceof Error?e.message:'time.proof_failed'}
  finally{busy.value=false}
}
</script>

<template>
  <section
    class="storage-diagnostics"
    aria-labelledby="storage-diagnostics-title"
  >
    <h2 id="storage-diagnostics-title">
      {{ title }}
    </h2>
    <p>
      {{ ru?'Диагностика проверяет реальную запись, чтение и удаление. Она не сохраняет фотографии.':
        'Real write/read/delete tests for encrypted storage. Does not save photos.' }}
    </p>
    <div class="storage-diagnostic-actions">
      <button
        type="button"
        class="subtle-button"
        :disabled="busy"
        @click="probe(false)"
      >
        {{ ru?'Проверить хранилище':'Test local storage' }}
      </button>
      <button
        type="button"
        class="subtle-button"
        :disabled="busy"
        @click="probe(true)"
      >
        {{ ru?'Запросить постоянное хранение':'Request persistent storage' }}
      </button>
    </div>
    <dl
      v-if="state"
      class="storage-diagnostic-results"
      aria-live="polite"
    >
      <dt>HTTPS / Secure context</dt><dd>{{ status(state.secureContext) }}</dd>
      <dt>IndexedDB + CryptoKey</dt><dd>{{ status(state.indexedDB && state.structuredCloneKey) }}</dd>
      <dt>OPFS</dt><dd>{{ status(state.opfs) }}</dd>
      <dt>Encrypted Blob fallback</dt><dd>{{ status(state.fallbackBlob) }}</dd>
      <dt>{{ ru?'Выбранное хранилище':'Active backend' }}</dt><dd>{{ state.backend??'BLOCKED' }}</dd>
      <dt>Persisted</dt><dd>{{ state.persisted }}</dd>
      <dt>Persistence request</dt><dd>{{ state.persistRequest }}</dd>
      <dt>{{ ru?'Использовано / квота':'Usage / quota' }}</dt>
      <dd>
        {{ state.usage===null?'?':(state.usage/1048576).toFixed(1)+' MB' }}
        / {{ state.quota===null?'?':(state.quota/1048576).toFixed(1)+' MB' }}
      </dd>
      <dt>{{ ru?'Предупреждение':'Warning' }}</dt><dd>{{ state.warning??'—' }}</dd>
    </dl>
    <div
      v-if="identity"
      class="storage-diagnostic-clock"
    >
      <p>
        {{ ru?'Время сервера нужно для чтения и безопасной очистки просроченных фото.':
          'Authenticated server time is required for access and proven expiry.' }}
      </p>
      <button
        type="button"
        class="subtle-button"
        :disabled="busy || identity.offline"
        @click="refreshTime"
      >
        {{ ru?'Проверить серверное время':'Revalidate server time' }}
      </button>
      <p
        v-if="time"
        role="status"
      >
        {{ time.trusted?(ru?'Доверенное время':'Trusted time'):(ru?'Доступ заблокирован':'Access locked') }}
        · {{ time.reason }}
      </p>
    </div>
    <p
      v-if="error"
      role="alert"
      class="identity-error"
    >
      {{ error }}
    </p>
    <small>{{ ru?'Это результаты только данного браузера. Проверки iOS/Android требуют реального устройства.':
      'Results apply to this browser only. Actual iOS/Android testing is separate.' }}</small>
  </section>
</template>
<style scoped>
.storage-diagnostics {margin-top:18px;padding:23px;border:1px solid var(--border);border-radius:17px;background:var(--surface)}
.storage-diagnostics h2 {font-size:19px;margin:0 0 8px}
.storage-diagnostics p,.storage-diagnostics small{font-size:12px;color:var(--secondary)}
.storage-diagnostic-actions{display:flex;flex-wrap:wrap;gap:9px;margin:18px 0}
.storage-diagnostic-results{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px 12px;
 padding:13px;border-radius:13px;background:var(--panel);font-size:12px}
.storage-diagnostic-results dt{color:var(--secondary)}
.storage-diagnostic-results dd{margin:0;text-align:right;overflow-wrap:anywhere;font-weight:600}
.storage-diagnostic-clock{margin-top:14px;padding-top:15px;border-top:1px solid var(--border)}
@media(max-width:390px){.storage-diagnostics{padding:13px}}
</style>
