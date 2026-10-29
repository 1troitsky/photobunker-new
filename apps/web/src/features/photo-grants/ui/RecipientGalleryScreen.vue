<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import {useRoute} from 'vue-router'
import {identity,onIdentityCleanup,registerDecryptedObjectUrl,revokeDecryptedObjectUrl} from '../../identity'
import {language} from '../../ui-preview'
import {listRecipientThumbnails,type RecipientThumbnailRef} from '../application/recipient-list'
import {readRecipientThumbnail} from '../application/recipient-thumbnail'

const route=useRoute()
const grantId=computed(()=>String(route.params.grantId??''))
const ru=computed(()=>language.value==='ru')
const labels=computed(()=>ru.value?{
  title:'Полученные фотографии',back:'К участникам',note:'Только зашифрованные миниатюры. Оригиналы, метаданные и экспорт не открываются.',
  loading:'Проверка разрешений…',none:'Доступных миниатюр пока нет.',
  blocked:'Просмотр миниатюр пока не включён на сервере или доступ отозван.',
  offline:'Для проверки доступа нужно подключение к интернету.',
  error:'Не удалось получить фотографии.',open:'Расшифровать миниатюру',close:'Закрыть',
  loadMore:'Показать ещё',expiry:'Истекает',refresh:'Обновить права',working:'Расшифровка…',
}:{
  title:'Received photos',back:'Participants',note:'Encrypted thumbnails only. Originals, private metadata and export are not available.',
  loading:'Checking access…',none:'No accessible thumbnails.',
  blocked:'Thumbnail access is not enabled on the server or was revoked.',
  offline:'A network connection is required to check permissions.',
  error:'Unable to retrieve photos.',open:'Decrypt thumbnail',close:'Close',
  loadMore:'Load more',expiry:'Expires',refresh:'Refresh permissions',working:'Decrypting…',
})
const items=ref<RecipientThumbnailRef[]>([])
const visibleItems=computed(()=>items.value.filter(item=>item.expiresAt>now.value))
const cursor=ref<string|null>(null),finished=ref(false),loading=ref(false)
const error=ref(''),opening=ref<string|null>(null),now=ref(Date.now())
const urls=ref<Record<string,string>>({})
let generation=0,stopped=false,clock:number|undefined
function clearUrls(){
  for(const url of Object.values(urls.value))revokeDecryptedObjectUrl(url)
  urls.value={}
}
function reset(){
  generation++;clearUrls();items.value=[];cursor.value=null
  finished.value=false;loading.value=false;opening.value=null;error.value=''
}
const release=onIdentityCleanup(reset)
function valid(account:string,device:string,token:number){
  return !stopped&&token===generation&&identity.value?.accountId===account&&
    identity.value?.deviceId===device&&!identity.value.offline
}
function date(ms:number){
  return new Intl.DateTimeFormat(ru.value?'ru-RU':'en-US',{dateStyle:'medium'}).format(ms)
}
async function load(more=false){
  const active=identity.value
  if(!active||active.offline||!navigator.onLine){
    if(!more){reset();error.value=labels.value.offline}
    return
  }
  if(loading.value)return
  if(!more)reset()
  const token=generation,grant=grantId.value,after=more?cursor.value:null
  loading.value=true;error.value=''
  try{
    const page=await listRecipientThumbnails(grant,after)
    if(!valid(active.accountId,active.deviceId,token)||grant!==grantId.value)return
    const fresh=page.photos.filter(p=>p.expiresAt>Date.now())
    items.value=more?[...items.value,...fresh]:fresh
    cursor.value=page.nextCursor
    finished.value=page.nextCursor===null
    now.value=Date.now()
  }catch(e){
    if(valid(active.accountId,active.deviceId,token))
      error.value=e instanceof Error&&e.message.endsWith('_404')?
        labels.value.blocked:labels.value.error
  }finally{if(token===generation)loading.value=false}
}
async function show(item:RecipientThumbnailRef){
  const active=identity.value,token=generation,grant=grantId.value
  if(!active||opening.value||item.expiresAt<=Date.now())return
  const key=item.photoId+'/'+item.assetId
  if(urls.value[key]){revokeDecryptedObjectUrl(urls.value[key]);delete urls.value[key];return}
  opening.value=key;error.value=''
  try{
    const blob=await readRecipientThumbnail(grant,item.photoId,item.assetId)
    if(!valid(active.accountId,active.deviceId,token)||grantId.value!==grant||
       item.expiresAt<=Date.now())return
    const url=URL.createObjectURL(blob)
    registerDecryptedObjectUrl(url)
    if(!valid(active.accountId,active.deviceId,token)){revokeDecryptedObjectUrl(url);return}
    urls.value={...urls.value,[key]:url}
  }catch(e){
    if(valid(active.accountId,active.deviceId,token))
      error.value=e instanceof Error&&e.message.endsWith('_404')?
        labels.value.blocked:labels.value.error
  }finally{if(token===generation)opening.value=null}
}
function visible(){
  if(document.hidden){reset();return}
  void load()
}
function onFocus(){if(!document.hidden){clearUrls();void load()}}
function tick(){
  now.value=Date.now()
  for(const item of items.value){
    if(item.expiresAt<=now.value){
      const key=item.photoId+'/'+item.assetId
      if(urls.value[key]){revokeDecryptedObjectUrl(urls.value[key]);delete urls.value[key]}
    }
  }
}
onMounted(()=>{
  stopped=false;void load()
  document.addEventListener('visibilitychange',visible)
  window.addEventListener('focus',onFocus)
  window.addEventListener('online',onFocus)
  window.addEventListener('pagehide',reset)
  clock=window.setInterval(tick,5000)
})
onUnmounted(()=>{
  stopped=true;reset();release()
  document.removeEventListener('visibilitychange',visible)
  window.removeEventListener('focus',onFocus)
  window.removeEventListener('online',onFocus)
  window.removeEventListener('pagehide',reset)
  if(clock!==undefined)window.clearInterval(clock)
})
watch([grantId,()=>identity.value?.accountId,()=>identity.value?.deviceId],()=>{
  reset()
  if(identity.value)void load()
},{flush:'sync'})
</script>

<template>
  <section class="recipient-gallery" data-testid="recipient-photo-gallery">
    <RouterLink to="/assignment-grants" class="subtle-button">{{ labels.back }}</RouterLink>
    <h1>{{ labels.title }}</h1>
    <p class="recipient-note">{{ labels.note }}</p>
    <button class="subtle-button" type="button" :disabled="loading" @click="load()">
      {{ labels.refresh }}
    </button>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="loading" role="status">{{ labels.loading }}</p>
    <p v-else-if="items.length===0&&!error">{{ labels.none }}</p>
    <div class="recipient-grid">
      <article v-for="item in visibleItems" :key="item.photoId+'/'+item.assetId" class="recipient-photo">
        <template v-if="item.expiresAt>now">
          <img v-if="urls[item.photoId+'/'+item.assetId]"
            :src="urls[item.photoId+'/'+item.assetId]" alt=""
            class="recipient-preview">
          <div v-else class="recipient-placeholder" aria-hidden="true"/>
          <div class="recipient-photo-caption">
            <small>{{ labels.expiry }}: {{ date(item.expiresAt) }}</small>
            <button class="subtle-button" type="button"
              :disabled="opening!==null||loading" @click="show(item)">
              {{ opening===item.photoId+'/'+item.assetId?labels.working:
                urls[item.photoId+'/'+item.assetId]?labels.close:labels.open }}
            </button>
          </div>
        </template>
      </article>
    </div>
    <button v-if="!finished&&items.length>0" type="button" class="subtle-button"
      :disabled="loading" @click="load(true)">{{ labels.loadMore }}</button>
    <button v-else-if="!finished&&!loading&&!error" type="button" class="subtle-button"
      @click="load(true)">{{ labels.loadMore }}</button>
  </section>
</template>

<style scoped>
.recipient-gallery{max-width:960px;margin:auto;padding:20px 16px 130px}
.recipient-gallery h1{margin:20px 0 10px;font-size:24px}
.recipient-note{color:var(--secondary);font-size:13px;margin-bottom:18px}
.recipient-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px;margin:20px 0}
.recipient-photo{min-width:0;background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden}
.recipient-placeholder{aspect-ratio:4/3;background:var(--panel)}
.recipient-preview{width:100%;aspect-ratio:4/3;object-fit:contain;background:var(--panel);display:block}
.recipient-photo-caption{display:flex;flex-direction:column;gap:10px;padding:12px}
.recipient-photo-caption small{color:var(--muted);font-size:11px}
@media(max-width:650px){.recipient-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}}
</style>
