<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import {identity,onIdentityCleanup} from '../../identity'
import {language} from '../../ui-preview'
import {openLocalPhotoVault} from '../../local-storage'
import type {PhotoHeader,SyncState} from '../../local-storage'
import {flushPhotoSync,onPhotoSync} from '../../photo-sync'
import {captureError} from '../infrastructure/browser-camera'
import type {CaptureMetadata} from '../domain/policy'

type Item={header:PhotoHeader;metadata:CaptureMetadata}
const ru=computed(()=>language.value==='ru'),loading=ref(Boolean(identity.value)),locked=ref(false),error=ref(''),refreshing=ref(false)
const rows=ref<Item[]>([]),filter=ref(''),states=ref<Record<string,SyncState>>({})
let stopEvents:(()=>void)|null=null
let generation=0
const copy=computed(()=>ru.value?{
  title:'Локальные фотографии',explanation:'Зашифрованные снимки текущего аккаунта. Статус облака указан для каждого файла.',
  login:'Для просмотра откройте свой анонимный аккаунт.',create:'Создать аккаунт',restore:'Восстановить доступ',
  empty:'Здесь пока нет фотографий',emptyHint:'Сделайте первый снимок камерой.',camera:'Открыть камеру',
  locked:'Фотографии скрыты до подтверждения доверенного времени.',reload:'Проверить время и обновить',
  failure:'Ошибка чтения зашифрованных фотографий.',partial:'Часть записей повреждена или недоступна.',
  local:'Только на устройстве',syncing:'Синхронизация…',synced:'В облаке · проверено',retry:'Повтор загрузки',sync:'Синхронизировать',retention:'Истекает',view:'Открыть',loading:'Загрузка защищённого списка…',
  mode:'Режим',refresh:'Обновить список',
}:{
  title:'Local photographs',explanation:'Encrypted photos for this account. Cloud status is shown for each file.',
  login:'Unlock your anonymous account to view photos.',create:'Create account',restore:'Restore access',
  empty:'No photos yet',emptyHint:'Take your first photo.',camera:'Open camera',
  locked:'Photos are hidden until trusted time is revalidated.',reload:'Revalidate time and refresh',
  failure:'Unable to read encrypted local photos.',partial:'Some records are corrupt or inaccessible.',
  local:'On device only',syncing:'Syncing…',synced:'Cloud verified',retry:'Upload retry',sync:'Sync now',retention:'Expires',view:'Open',loading:'Loading protected list…',
  mode:'Mode',refresh:'Refresh list',
})
function syncLabel(state:SyncState|undefined):string {
  switch(state){
    case 'syncing':return copy.value.syncing
    case 'synced':return copy.value.synced
    case 'retry':return copy.value.retry
    case 'expired':return copy.value.locked
    default:return copy.value.local
  }
}
const visible=computed(()=>rows.value.filter(row=>row.header.photoId.toLowerCase().includes(filter.value.toLowerCase())))
function dispose(){generation++;rows.value=[];states.value={};loading.value=false;locked.value=false;error.value=''}
const release=onIdentityCleanup(dispose)
function timestamp(value:number):string{return new Intl.DateTimeFormat(language.value==='ru'?'ru-RU':'en-US',{dateStyle:'medium',timeStyle:'short'}).format(value)}
async function load(force=false){
  const ticket=++generation,active=identity.value
  error.value='';locked.value=false
  if(!active){loading.value=false;return}
  loading.value=rows.value.length===0;refreshing.value=force||rows.value.length>0
  try{
    const vault=openLocalPhotoVault()
    if(!vault.time.status().trusted)await vault.time.restoreFromStorage()
    if(!vault.time.status().trusted&&(force||!active.offline))await vault.time.refreshFromServer()
    if(!vault.time.status().trusted)throw new Error('time.untrusted')
    // No image assets are decrypted for the list; only encrypted per-photo metadata.
    await vault.reconcile()
    const headers=await vault.list()
    const records:Item[]=[]
    let broken=0
    for(const header of headers){
      if(ticket!==generation)return
      try{
        const metadata=await vault.readMetadata(header.photoId) as CaptureMetadata
        if(metadata?.policyVersion!==1||!Number.isSafeInteger(metadata.capturedAt)||metadata.expiresAt!==header.expiresAt)
          throw new Error('storage.invalid_metadata')
        records.push({header,metadata})
      }catch{broken++}
    }
    const fresh:Record<string,SyncState>={}
    for(const item of records){
      if(ticket!==generation)return
      fresh[item.header.photoId]=await vault.syncState(item.header.photoId)
    }
    records.sort((a,b)=>b.metadata.capturedAt-a.metadata.capturedAt||b.header.photoId.localeCompare(a.header.photoId))
    if(ticket===generation&&identity.value?.accountId===active.accountId&&identity.value?.deviceId===active.deviceId){
      states.value=fresh
      rows.value=records
      if(broken)error.value=copy.value.partial+' ('+broken+')'
    }
  }catch(e){
    if(ticket!==generation)return
    if(String(e).includes('time.')||String(e).includes('storage.account_locked'))locked.value=true
    else error.value=copy.value.failure+' '+captureError(e)
  }finally{if(ticket===generation){loading.value=false;refreshing.value=false}}
}
function visibleAgain(){if(!document.hidden)void load()}
onMounted(()=>{stopEvents=onPhotoSync(e=>{states.value={...states.value,[e.photoId]:e.state}});void load();window.addEventListener('focus',visibleAgain);window.addEventListener('online',visibleAgain)})
onUnmounted(()=>{stopEvents?.();stopEvents=null;dispose();release();window.removeEventListener('focus',visibleAgain);window.removeEventListener('online',visibleAgain)})
watch(identity,(a,b)=>{if(a?.accountId!==b?.accountId||a?.deviceId!==b?.deviceId)void load()})
</script>

<template>
  <section
    class="secure-photo-list"
    data-testid="local-photo-list"
  >
    <header class="local-photos-header">
      <div><h2>{{ copy.title }}</h2><p>{{ copy.explanation }}</p></div>
      <RouterLink
        to="/camera"
        class="primary-button"
      >{{ copy.camera }}</RouterLink>
    </header>
    <template v-if="!identity">
      <div
        class="secure-empty"
        role="status"
      >
        <p>{{ copy.login }}</p>
        <RouterLink
          to="/account/create"
          class="subtle-button"
        >{{ copy.create }}</RouterLink>
        <RouterLink
          to="/account/restore"
          class="subtle-button"
        >{{ copy.restore }}</RouterLink>
      </div>
    </template>
    <template v-else>
      <div class="secure-list-tools">
        <label
          class="sr-only"
          for="photo-local-filter"
        >{{ ru?'Найти по ID':'Filter by ID' }}</label>
        <input
          id="photo-local-filter"
          v-model="filter"
          type="search"
          :placeholder="ru?'Поиск по ID':'Search by ID'"
          :disabled="locked||loading"
        >
        <button
          type="button"
          class="subtle-button"
          :disabled="loading||refreshing"
          @click="load(true)"
        >
          {{ copy.refresh }}
        </button>
        <button type="button" class="subtle-button" :disabled="!identity || identity.offline || loading" @click="flushPhotoSync()">{{ copy.sync }}</button>
      </div>
      <p
        v-if="loading"
        role="status"
      >
        {{ copy.loading }}
      </p>
      <div
        v-else-if="locked"
        class="secure-empty"
        role="alert"
      >
        <h2>{{ copy.locked }}</h2><button
          type="button"
          class="primary-button"
          :disabled="refreshing"
          @click="load(true)"
        >
          {{ copy.reload }}
        </button>
      </div>
      <div
        v-else-if="visible.length"
        class="secure-photo-rows"
        role="list"
      >
        <RouterLink
          v-for="item in visible"
          :key="item.header.photoId"
          role="listitem"
          class="secure-photo-row"
          :to="'/photos/'+item.header.photoId"
          :aria-label="copy.view+' '+item.header.photoId"
        >
          <div
            class="ciphertext-icon"
            aria-hidden="true"
          >▧</div>
          <div class="secure-photo-summary"><strong>{{ timestamp(item.metadata.capturedAt) }}</strong>
            <small>{{ item.header.photoId }}</small>
            <span>{{ copy.mode }} {{ item.metadata.mode }} · {{ copy.retention }} {{ timestamp(item.header.expiresAt) }}</span>
          </div>
          <span class="secure-local-label">{{ syncLabel(states[item.header.photoId]) }}</span>
        </RouterLink>
      </div>
      <div
        v-else
        class="secure-empty"
        role="status"
      >
        <h2>{{ copy.empty }}</h2><p>{{ copy.emptyHint }}</p>
      </div>
      <p
        v-if="error"
        role="alert"
        class="identity-error"
      >
        {{ error }}
      </p>
    </template>
  </section>
</template>
<style scoped>
.secure-photo-list{max-width:900px;margin:0 auto}
.local-photos-header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin-bottom:19px}
.local-photos-header h2{font-size:23px;margin:0 0 6px}
.local-photos-header p{font-size:12px;color:var(--secondary);margin:0;max-width:450px}
.secure-list-tools{display:flex;gap:9px;margin-bottom:18px;flex-wrap:wrap}
.secure-list-tools input{background:var(--surface);border:1px solid var(--border);border-radius:10px;color:var(--text);min-height:44px;padding:9px 11px;flex:1;min-width:120px}
.secure-photo-rows{display:grid;gap:10px}
.secure-photo-row{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:12px;display:flex;align-items:center;gap:13px;min-height:89px;color:var(--text)}
.secure-photo-row:focus-visible,.secure-photo-row:hover{border-color:var(--accent)}
.ciphertext-icon{height:55px;width:55px;flex:0 0 55px;display:grid;place-items:center;border-radius:10px;background:var(--panel);color:var(--secondary);font-size:24px}
.secure-photo-summary{min-width:0;flex:1;display:grid;gap:4px}
.secure-photo-summary strong{font-size:13px}
.secure-photo-summary small{font-family:monospace;overflow-wrap:anywhere;font-size:10px;color:var(--muted)}
.secure-photo-summary span,.secure-local-label{font-size:11px;color:var(--secondary)}
.secure-local-label{white-space:nowrap}
.secure-empty{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:10px;min-height:210px;padding:18px;text-align:center;background:var(--surface);border:1px solid var(--border);border-radius:14px}
.secure-empty h2,.secure-empty p{width:100%;font-size:15px}
@media(max-width:420px){.secure-local-label{font-size:10px;white-space:normal;max-width:100px;text-align:right}.local-photos-header h2{font-size:19px}}
</style>
