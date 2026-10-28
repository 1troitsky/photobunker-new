<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import {useRouter} from 'vue-router'
import {identity,onIdentityCleanup} from '../../identity'
import {language} from '../../ui-preview'
import {openLocalPhotoVault,claimName} from '../../local-storage'
import {flushPhotoSync,onPhotoSync} from '../../photo-sync'
import {localGallery,remoteHeaders,hydratePhoto} from '../application/library'
import type {CloudPhoto} from '../../local-storage'
import GalleryThumbnail from './GalleryThumbnail.vue'
import {checkMetadata} from '../domain/metadata'
import {startGrantedGps,requestGps,captureGps,gpsStatus,stopGps,setGpsEnabled} from '../infrastructure/location'

type Row={id:string;nameId:string|null;title:string;capturedAt:number;expiresAt:number;
  state:'local'|'syncing'|'synced'|'retry'|'expired';remote?:CloudPhoto;loaded:boolean}
const router=useRouter(),ru=computed(()=>language.value==='ru')
const rows=ref<Row[]>([]),loading=ref(false),cloudBusy=ref(false),error=ref(''),query=ref('')
const layout=ref<'grid'|'list'>('grid'),editing=ref(''),editTitle=ref(''),saving=ref(false)
const gps=ref(gpsStatus()),gpsAllowed=ref(true)
let generation=0,stopped=false
const txt=computed(()=>ru.value?{
  heading:'Фотографии',sub:'Приватная галерея · только зашифрованные материалы',capture:'Камера',
  empty:'Фотографий пока нет',emptyHint:'Сделайте снимок или подключитесь к облаку.',search:'Название или NAME-ID',
  grid:'Сетка',list:'Список',refresh:'Обновить',sync:'Синхронизировать',pending:'Имя ожидается',
  local:'На устройстве',syncing:'Синхронизация…',synced:'В облаке',retry:'Повтор загрузки',remote:'Из облака',
  title:'Название',save:'Сохранить',cancel:'Отмена',open:'Открыть',edit:'Изменить название',
  locked:'Для галереи откройте анонимный аккаунт.',restore:'Восстановить доступ',create:'Создать аккаунт',
  gps:'Геолокация',gpsGrant:'Разрешить GPS',gpsOff:'Отключить GPS',gpsOn:'Включить GPS',
  gpsSave:'Добавить свежие координаты',gpsMissing:'Свежая GPS-точка недоступна',
  noGps:'Без GPS',loading:'Загрузка зашифрованных фотографий…',
  cloudError:'Облако недоступно — локальные фотографии сохранены.',error:'Не удалось прочитать галерею.',
}:{
  heading:'Photos',sub:'Private gallery · encrypted photos only',capture:'Camera',
  empty:'No photographs yet',emptyHint:'Capture a photo or reconnect to the cloud.',search:'Title or NAME-ID',
  grid:'Grid',list:'List',refresh:'Refresh',sync:'Sync now',pending:'Name pending',
  local:'On device',syncing:'Syncing…',synced:'Cloud verified',retry:'Retry',remote:'Cloud only',
  title:'Title',save:'Save',cancel:'Cancel',open:'Open',edit:'Edit title',
  locked:'Unlock your anonymous account to view the gallery.',restore:'Restore access',create:'Create account',
  gps:'Location',gpsGrant:'Allow GPS',gpsOff:'Disable GPS',gpsOn:'Enable GPS',
  gpsSave:'Add fresh coordinates',gpsMissing:'No recent GPS fix available',
  noGps:'No GPS',loading:'Loading encrypted photographs…',
  cloudError:'Cloud unavailable — local photos remain safe.',error:'Could not open gallery.',
})
const filtered=computed(()=>rows.value.filter(r=>{
  const term=query.value.trim().toLowerCase()
  return !term||r.title.toLowerCase().includes(term)||(r.nameId??'').toLowerCase().includes(term)||
    r.id.toLowerCase().includes(term)
}))
const labels=computed(()=>({local:txt.value.local,syncing:txt.value.syncing,synced:txt.value.synced,
  retry:txt.value.retry,expired:txt.value.pending}))
function dispose(){generation++;rows.value=[];editing.value='';error.value='';loading.value=false;cloudBusy.value=false;stopGps()}
const release=onIdentityCleanup(dispose)
function scoped(token:number,account:string,device:string):boolean{
  return !stopped&&token===generation&&identity.value?.accountId===account&&identity.value?.deviceId===device
}
function mapping(item:Awaited<ReturnType<typeof localGallery>>[number]):Row{
  return{id:item.header.photoId,nameId:item.nameId,title:item.title,capturedAt:item.capturedAt,
    expiresAt:item.header.expiresAt,state:item.state,loaded:true}
}
async function refresh(){
  const token=++generation,active=identity.value
  if(!active){rows.value=[];loading.value=false;return}
  loading.value=rows.value.length===0;error.value=''
  try{
    const local=await localGallery()
    if(!scoped(token,active.accountId,active.deviceId))return
    rows.value=local.map(mapping)
    loading.value=false
  }catch{
    if(scoped(token,active.accountId,active.deviceId)){error.value=txt.value.error;loading.value=false}
  }
  if(active.offline||!navigator.onLine)return
  cloudBusy.value=true
  try{
    const remote=await remoteHeaders()
    if(!scoped(token,active.accountId,active.deviceId))return
    const remoteIds=new Set(remote.map(p=>p.photoId))
    for(const item of (await localGallery()).filter(x=>remoteIds.has(x.header.photoId)&&
      (!x.header.nameId||x.header.namePending))){
      if(!scoped(token,active.accountId,active.deviceId))return
      try{await claimName(item.header.photoId,item.header.nameId??null,item.header.leaseId,item.header.nameNumber)}
      catch{/* idempotent claim can retry on next foreground refresh */}
    }
    const merged=new Map(rows.value.map(row=>[row.id,row]))
    for(const p of remote){
      if(p.expiresAt<=Date.now()||merged.has(p.photoId))continue
      merged.set(p.photoId,{id:p.photoId,title:'',nameId:p.nameId,capturedAt:0,
        expiresAt:p.expiresAt,state:'synced',remote:p,loaded:false})
    }
    rows.value=[...merged.values()].sort((a,b)=>b.capturedAt-a.capturedAt||a.id.localeCompare(b.id))
    // Hydrate a small bounded batch; further items hydrate when opened.
    for(const p of remote.filter(p=>!rows.value.find(r=>r.id===p.photoId)?.loaded).slice(0,4)){
      if(!scoped(token,active.accountId,active.deviceId))return
      try{await hydratePhoto(p);const local=await localGallery()
        if(!scoped(token,active.accountId,active.deviceId))return
        const byId=new Map(local.map(i=>[i.header.photoId,mapping(i)]))
        rows.value=rows.value.map(row=>byId.get(row.id)??row)
      }catch{/* keep cloud placeholder, never claim local save */}
    }
  }catch{if(scoped(token,active.accountId,active.deviceId))error.value=txt.value.cloudError}
  finally{if(scoped(token,active.accountId,active.deviceId))cloudBusy.value=false}
}
async function open(row:Row){
  if(!row.loaded&&row.remote){
    try{await hydratePhoto(row.remote);await router.push('/photos/'+row.id)}
    catch{error.value=txt.value.cloudError}
  }else await router.push('/photos/'+row.id)
}
function startEdit(row:Row){editing.value=row.id;editTitle.value=row.title}
async function save(){
  const id=editing.value,active=identity.value
  if(!id||!active)return
  saving.value=true
  try{
    const vault=openLocalPhotoVault()
    const previous=checkMetadata(await vault.readMetadata(id))
    const title=editTitle.value.trim()
    if(title.length>160)throw Error('gallery.title_invalid')
    await vault.editMetadata(id,{...previous,schemaVersion:1,title})
    editing.value=''
    await refresh()
  }catch{error.value=txt.value.error}
  finally{saving.value=false}
}
async function addGps(row:Row){
  try{
    const vault=openLocalPhotoVault(),meta=checkMetadata(await vault.readMetadata(row.id))
    const fix=captureGps(Date.now())
    if(!fix||Date.now()-meta.capturedAt>300000){error.value=txt.value.gpsMissing;return}
    await vault.editMetadata(row.id,{...meta,schemaVersion:1,gps:fix,gpsStatus:'ready'})
    await refresh()
  }catch{error.value=txt.value.error}
}
function toggleGps(){
  gpsAllowed.value=!gpsAllowed.value;setGpsEnabled(gpsAllowed.value)
  if(gpsAllowed.value)startGrantedGps()
  gps.value=gpsStatus()
}
function request(){requestGps();gps.value=gpsStatus()}
let offSync:()=>void=()=>{}
function focus(){if(!document.hidden){startGrantedGps();void refresh()}}
onMounted(()=>{
  stopped=false;startGrantedGps();gps.value=gpsStatus();offSync=onPhotoSync(ev=>{
    const r=rows.value.find(x=>x.id===ev.photoId);if(r)r.state=ev.state
  })
  void refresh();window.addEventListener('focus',focus);window.addEventListener('online',focus)
})
onUnmounted(()=>{stopped=true;dispose();release();offSync();window.removeEventListener('focus',focus);window.removeEventListener('online',focus)})
watch(identity,(a,b)=>{if(a?.accountId!==b?.accountId||a?.deviceId!==b?.deviceId){dispose();if(a){startGrantedGps();void refresh()}}})
function date(n:number){return n?new Intl.DateTimeFormat(ru.value?'ru-RU':'en-US',{dateStyle:'medium',timeStyle:'short'}).format(n):''}
</script>
<template>
  <section class="gallery-root" data-testid="encrypted-gallery">
    <header class="gallery-header">
      <div><h2>{{ txt.heading }}</h2><p>{{ txt.sub }}</p></div>
      <RouterLink to="/camera" class="primary-button">{{ txt.capture }}</RouterLink>
    </header>
    <template v-if="!identity">
      <div class="gallery-empty"><p>{{ txt.locked }}</p>
        <RouterLink to="/account/create" class="subtle-button">{{ txt.create }}</RouterLink>
        <RouterLink to="/account/restore" class="subtle-button">{{ txt.restore }}</RouterLink>
      </div>
    </template>
    <template v-else>
      <div class="gallery-controls">
        <input v-model="query" type="search" :aria-label="txt.search" :placeholder="txt.search">
        <button type="button" class="subtle-button" :aria-pressed="layout==='grid'" @click="layout='grid'">{{ txt.grid }}</button>
        <button type="button" class="subtle-button" :aria-pressed="layout==='list'" @click="layout='list'">{{ txt.list }}</button>
        <button type="button" class="subtle-button" :disabled="cloudBusy||loading" @click="refresh">{{ txt.refresh }}</button>
        <button type="button" class="subtle-button" :disabled="identity.offline" @click="flushPhotoSync(true)">{{ txt.sync }}</button>
      </div>
      <div class="gallery-gps">
        <span>{{ txt.gps }} · {{ gps }}</span>
        <button type="button" class="subtle-button" @click="toggleGps">{{ gpsAllowed?txt.gpsOff:txt.gpsOn }}</button>
        <button v-if="gpsAllowed" type="button" class="subtle-button" @click="request">{{ txt.gpsGrant }}</button>
      </div>
      <p v-if="loading" role="status">{{ txt.loading }}</p>
      <div v-else-if="!filtered.length" class="gallery-empty">
        <h3>{{ txt.empty }}</h3><p>{{ txt.emptyHint }}</p>
      </div>
      <div v-else :class="['gallery-items',layout]" role="list">
        <article v-for="item in filtered" :key="item.id" class="gallery-item" role="listitem">
          <button type="button" class="gallery-photo" :aria-label="txt.open+' '+(item.nameId??item.id)" @click="open(item)">
            <GalleryThumbnail v-if="item.loaded" :photo-id="item.id" :label="item.title||item.nameId||''"/>
            <span v-else class="gallery-cloud-symbol" aria-hidden="true">▧</span>
          </button>
          <div class="gallery-info">
            <strong>{{ item.title||item.nameId||txt.pending }}</strong>
            <small>{{ item.nameId||txt.pending }}</small>
            <small>{{ date(item.capturedAt) }}</small>
            <span class="gallery-state">{{ item.remote&&!item.loaded?txt.remote:labels[item.state] }}</span>
            <div class="gallery-actions">
              <button type="button" :disabled="!item.loaded" @click="startEdit(item)">{{ txt.edit }}</button>
              <button type="button" :disabled="!item.loaded||!gpsAllowed" @click="addGps(item)">{{ txt.gpsSave }}</button>
            </div>
          </div>
        </article>
      </div>
      <form v-if="editing" class="gallery-editor" @submit.prevent="save">
        <label>{{ txt.title }}<input v-model="editTitle" type="text" maxlength="160" autocomplete="off"></label>
        <button type="submit" :disabled="saving">{{ txt.save }}</button>
        <button type="button" @click="editing=''">{{ txt.cancel }}</button>
      </form>
      <p v-if="cloudBusy" role="status">{{ txt.syncing }}</p>
      <p v-if="error" role="alert" class="identity-error">{{ error }}</p>
    </template>
  </section>
</template>
<style scoped>
.gallery-root{max-width:1240px;margin:auto}
.gallery-header{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:18px}
.gallery-header h2{margin:0 0 5px;font-size:24px}
.gallery-header p{margin:0;font-size:12px;color:var(--secondary)}
.gallery-controls,.gallery-gps{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center}
.gallery-controls input,.gallery-editor input{min-height:44px;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:10px;padding:9px;flex:1;min-width:120px}
.gallery-gps{font-size:12px;color:var(--secondary)}
.gallery-items.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:13px}
.gallery-items.list{display:flex;flex-direction:column;gap:10px}
.gallery-item{min-width:0;background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden}
.gallery-photo{display:block;border:0;padding:0;background:var(--panel);width:100%;aspect-ratio:1;cursor:pointer;overflow:hidden}
.gallery-cloud-symbol{display:grid;place-items:center;width:100%;height:100%;font-size:32px;color:var(--muted)}
.gallery-info{padding:10px;display:flex;flex-direction:column;gap:5px;min-width:0}
.gallery-info strong,.gallery-info small{overflow-wrap:anywhere}
.gallery-info strong{font-size:13px}
.gallery-info small{font-size:11px;color:var(--secondary)}
.gallery-state{font-size:11px;color:var(--secondary)}
.gallery-actions{display:flex;gap:9px;flex-wrap:wrap}
.gallery-actions button{min-height:37px;border:0;background:transparent;color:var(--accent);font-size:11px;text-align:left;padding:2px}
.gallery-editor{margin:15px 0;padding:14px;border:1px solid var(--border);border-radius:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:end}
.gallery-editor label{display:flex;flex:1;flex-direction:column;gap:5px;min-width:160px;font-size:12px}
.gallery-editor button{min-height:42px}
.gallery-empty{min-height:230px;background:var(--surface);border:1px solid var(--border);display:flex;justify-content:center;align-items:center;gap:14px;flex-wrap:wrap;border-radius:14px;padding:20px;text-align:center}
.gallery-empty p,.gallery-empty h3{width:100%;margin:0}
.gallery-items.list .gallery-item{display:flex;align-items:stretch}
.gallery-items.list .gallery-photo{aspect-ratio:1;width:110px;flex:0 0 110px}
@media(max-width:380px){.gallery-items.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.gallery-actions button{font-size:10px}}
</style>