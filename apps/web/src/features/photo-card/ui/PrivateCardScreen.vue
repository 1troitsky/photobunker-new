<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import {useRoute} from 'vue-router'
import {identity,onIdentityCleanup} from '../../identity'
import {GalleryThumbnail} from '../../gallery'
import {language} from '../../ui-preview'
import {loadPrivateCard} from '../application/load'
import type {PrivateCard} from '../domain/card'

const route=useRoute()
const photoId=computed(()=>String(route.params.photoId??''))
const ru=computed(()=>language.value==='ru')
const card=ref<PrivateCard|null>(null),loading=ref(false),error=ref('')
const reveal=ref(false),notice=ref(''),now=ref(Date.now())
let generation=0,clock:number|undefined
const txt=computed(()=>ru.value?{
  title:'Карточка фотографии',private:'Только для владельца · локально',
  note:'Это приватная карточка. Общий доступ и внешние ссылки пока недоступны.',
  back:'К фотографии',gallery:'Галерея',loading:'Чтение зашифрованных метаданных…',
  locked:'Аккаунт заблокирован или снимок недоступен.',
  expired:'Срок хранения снимка истёк.',noName:'Имя ожидается',captured:'Снято',
  expires:'Удаляется',size:'Размер',format:'Формат',mode:'Режим',assignment:'Задание',
  personal:'Личный снимок',gps:'Геолокация',showGps:'Показать координаты',
  hideGps:'Скрыть координаты',copyGps:'Копировать',copied:'Скопировано',
  copyFailed:'Не удалось скопировать',sync:'Хранение',local:'На устройстве',
  synced:'В облаке',retry:'Ожидает повтор',syncing:'Синхронизация',
  unavailable:'Карточка не найдена или не может быть расшифрована.',retryAction:'Повторить',
  shareThumbnail:'Передать миниатюру участнику',
}:{
  title:'Photo Card',private:'Owner only · local',
  note:'This card is private. External links and shared access are not available yet.',
  back:'Back to photo',gallery:'Gallery',loading:'Reading encrypted metadata…',
  locked:'Account locked or photograph unavailable.',
  expired:'This photo has expired.',noName:'Name pending',captured:'Captured',
  expires:'Expires',size:'Dimensions',format:'Format',mode:'Mode',assignment:'Assignment',
  personal:'Personal photograph',gps:'Location',showGps:'Show coordinates',
  hideGps:'Hide coordinates',copyGps:'Copy',copied:'Copied',
  copyFailed:'Could not copy',sync:'Storage',local:'On device',
  synced:'In cloud',retry:'Retry pending',syncing:'Syncing',
  unavailable:'Card not found or cannot be decrypted.',retryAction:'Retry',
  shareThumbnail:'Share thumbnail with participant',
})
const visible=computed(()=>card.value&&identity.value&&card.value.expiresAt>now.value?card.value:null)
const expired=computed(()=>!!card.value&&card.value.expiresAt<=now.value)
function date(value:number){
  return new Intl.DateTimeFormat(ru.value?'ru-RU':'en-US',{dateStyle:'medium',timeStyle:'short'}).format(value)
}
function clear(){
  generation++;card.value=null;loading.value=false;error.value='';reveal.value=false;notice.value=''
}
const release=onIdentityCleanup(clear)
async function load(){
  const token=++generation,active=identity.value,id=photoId.value
  card.value=null;notice.value='';reveal.value=false
  if(!active||!id){error.value=txt.value.locked;return}
  error.value='';loading.value=true
  try{
    const result=await loadPrivateCard(id)
    if(token!==generation||identity.value?.accountId!==active.accountId||
      identity.value?.deviceId!==active.deviceId||photoId.value!==id)return
    card.value=result;now.value=Date.now()
  }catch{
    if(token===generation)error.value=txt.value.unavailable
  }finally{if(token===generation)loading.value=false}
}
const location=computed(()=>visible.value?.gps)
const coordinates=computed(()=>location.value?
  location.value.latitude.toFixed(6)+', '+location.value.longitude.toFixed(6):'')
async function copyCoordinates(){
  if(!visible.value||!location.value||!reveal.value)return
  const token=generation,position=coordinates.value
  try{
    await navigator.clipboard.writeText(position)
    if(generation===token&&visible.value&&reveal.value)notice.value=txt.value.copied
  }catch{if(generation===token)notice.value=txt.value.copyFailed}
}
function hide(){
  if(document.hidden)clear()
  else if(identity.value)void load()
}
onMounted(()=>{
  document.addEventListener('visibilitychange',hide)
  clock=window.setInterval(()=>{now.value=Date.now()},5000)
  void load()
})
onUnmounted(()=>{
  clear();release();document.removeEventListener('visibilitychange',hide)
  if(clock!==undefined)window.clearInterval(clock)
})
watch([photoId,()=>identity.value?.accountId,()=>identity.value?.deviceId],()=>{
  clear()
  if(identity.value)void load()
},{flush:'sync'})
</script>

<template>
  <section class="private-card" data-testid="native-private-photo-card">
    <nav class="private-card-nav">
      <RouterLink :to="'/photos/'+encodeURIComponent(photoId)" class="subtle-button">{{ txt.back }}</RouterLink>
      <RouterLink to="/photos" class="subtle-button">{{ txt.gallery }}</RouterLink>
    </nav>
    <header><span>{{ txt.private }}</span><h1>{{ txt.title }}</h1><p>{{ txt.note }}</p></header>
    <p v-if="loading" role="status">{{ txt.loading }}</p>
    <p v-else-if="expired" role="alert">{{ txt.expired }}</p>
    <div v-else-if="error||!visible" role="alert">
      <p>{{ error||txt.locked }}</p>
      <button type="button" class="subtle-button" @click="load">{{ txt.retryAction }}</button>
    </div>
    <template v-else>
      <div class="private-card-preview"><GalleryThumbnail :photo-id="visible.photoId" :label="visible.title||visible.nameId||''"/></div>
      <h2>{{ visible.title||visible.nameId||txt.noName }}</h2>
      <dl class="private-card-facts">
        <div><dt>NAME-ID</dt><dd>{{ visible.namePending?txt.noName:(visible.nameId||txt.noName) }}</dd></div>
        <div><dt>{{ txt.captured }}</dt><dd>{{ date(visible.capturedAt) }}</dd></div>
        <div><dt>{{ txt.expires }}</dt><dd>{{ date(visible.expiresAt) }}</dd></div>
        <div><dt>{{ txt.size }}</dt><dd>{{ visible.width }} × {{ visible.height }}</dd></div>
        <div><dt>{{ txt.format }}</dt><dd>{{ visible.mime }}</dd></div>
        <div><dt>{{ txt.mode }}</dt><dd>{{ visible.mode }}</dd></div>
        <div><dt>{{ txt.assignment }}</dt><dd>{{ visible.assignmentId??txt.personal }}</dd></div>
        <div><dt>{{ txt.sync }}</dt><dd>{{ visible.sync==='synced'?txt.synced:
          visible.sync==='syncing'?txt.syncing:visible.sync==='retry'?txt.retry:txt.local }}</dd></div>
      </dl>
      <RouterLink v-if="visible.assignmentId&&visible.sync==='synced'"
        :to="{path:'/assignment-grants',query:{assignment:visible.assignmentId,photo:visible.photoId}}"
        class="subtle-button private-card-share">{{ txt.shareThumbnail }}</RouterLink>
      <section v-if="location" class="private-card-location">
        <h3>{{ txt.gps }}</h3>
        <button type="button" class="subtle-button" :aria-expanded="reveal"
          @click="reveal=!reveal;notice=''">{{ reveal?txt.hideGps:txt.showGps }}</button>
        <div v-if="reveal"><code>{{ coordinates }}</code>
          <button type="button" class="subtle-button" @click="copyCoordinates">{{ txt.copyGps }}</button>
          <span role="status">{{ notice }}</span></div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.private-card{max-width:850px;margin:0 auto;padding:22px 22px 120px}
.private-card-nav{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px}
.private-card header span{color:var(--accent);font-size:12px;font-weight:700}
.private-card h1{font-size:24px;margin:6px 0}
.private-card header p{font-size:12px;color:var(--secondary);margin-bottom:20px}
.private-card-preview{width:100%;max-height:330px;aspect-ratio:16/9;border-radius:14px;overflow:hidden}
.private-card h2{font-size:21px;margin:24px 0}
.private-card-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.private-card-facts div{padding:14px;background:var(--surface);border-radius:11px;border:1px solid var(--border);min-width:0}
.private-card-facts dt{color:var(--muted);font-size:11px;margin-bottom:6px}
.private-card-facts dd{font-size:13px;margin:0;overflow-wrap:anywhere}
.private-card-location{margin-top:24px}
.private-card-share{display:inline-flex;margin-top:18px}
.private-card-location>div{display:flex;flex-wrap:wrap;align-items:center;gap:9px;margin-top:12px}
.private-card-location code{overflow-wrap:anywhere;font-size:12px}
@media(max-width:600px){.private-card{padding:16px}.private-card-facts{grid-template-columns:1fr}}
</style>
