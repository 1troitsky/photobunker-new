<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import {useRoute} from 'vue-router'
import {identity,onIdentityCleanup,registerDecryptedObjectUrl,revokeDecryptedObjectUrl} from '../../identity'
import {openLocalPhotoVault} from '../../local-storage'
import {language} from '../../ui-preview'

const route=useRoute()
const ru=computed(()=>language.value==='ru')
const url=ref(''),error=ref(''),loading=ref(false)
let ticket=0
const id=computed(()=>String(route.params.photoId??''))
const copy=computed(()=>ru.value?{
  title:'Защищённый просмотр',back:'Назад к фотографиям',loading:'Расшифровка на этом устройстве…',
  locked:'Недоступно: заблокирован аккаунт, время недостоверно или файл повреждён.',
  local:'Защищённый снимок',noSave:'Изображение не сохраняется в Photos/DCIM.',
  account:'Откройте аккаунт, чтобы просмотреть фотографию.',
  image:'Приватная фотография',edit:'Редактировать',card:'Карточка',
}:{
  title:'Protected local viewer',back:'Back to photos',loading:'Decrypting on this device…',
  locked:'Unavailable: account locked, untrusted time or corrupt ciphertext.',
  local:'Protected photograph',noSave:'No system Photos/DCIM writes.',
  account:'Unlock your account to view this photo.',
  image:'Private photograph',edit:'Edit photograph',card:'Photo Card',
})
function clear(){
  ticket++
  if(url.value){revokeDecryptedObjectUrl(url.value);url.value=''}
}
const release=onIdentityCleanup(clear)
async function show(){
  clear()
  const current=++ticket,active=identity.value,photo=id.value
  if(!active){error.value=copy.value.account;return}
  error.value='';loading.value=true
  try{
    const vault=openLocalPhotoVault()
    if(!vault.time.status().trusted)await vault.time.restoreFromStorage()
    const header=await vault.readHeader(photo)
    if(!header)throw new Error('storage.photo_unavailable')
    const blob=await vault.read(photo,header.assetId)
    if(current!==ticket || identity.value?.accountId!==active.accountId ||
      identity.value?.deviceId!==active.deviceId)return
    if(blob.type && blob.type!=='application/octet-stream')throw new Error('storage.wrong_media_type')
    const candidate=new Blob([blob],{type:'image/jpeg'})
    const value=URL.createObjectURL(candidate)
    if(current!==ticket){URL.revokeObjectURL(value);return}
    registerDecryptedObjectUrl(value)
    url.value=value
  }catch{
    if(current===ticket)error.value=copy.value.locked
  }finally{if(current===ticket)loading.value=false}
}
function failDecode(){clear();error.value=copy.value.locked}
function hide(){if(document.hidden)clear()}
onMounted(()=>{void show();document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',clear)})
onUnmounted(()=>{clear();release();document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',clear)})
watch(id,()=>{void show()})
watch(identity,()=>{void show()})
</script>
<template>
  <section
    class="protected-viewer"
    data-testid="local-photo-viewer"
  >
    <nav class="viewer-nav">
      <RouterLink
        to="/photos"
        class="subtle-button"
      >{{ copy.back }}</RouterLink>
      <RouterLink :to="'/photos/'+id+'/edit'">{{ copy.edit }}</RouterLink>
      <RouterLink :to="'/photos/'+id+'/card'">{{ copy.card }}</RouterLink>
      <span>{{ copy.local }}</span>
    </nav>
    <h2>{{ copy.title }}</h2>
    <div class="viewer-stage">
      <p
        v-if="loading"
        role="status"
      >
        {{ copy.loading }}
      </p>
      <p
        v-else-if="error"
        role="alert"
      >
        {{ error }}
      </p>
      <img
        v-else-if="url"
        :src="url"
        :alt="copy.image"
        referrerpolicy="no-referrer"
        decoding="async"
        @error="failDecode"
      >
    </div>
    <p class="viewer-note">
      {{ copy.noSave }}
    </p>
  </section>
</template>
<style scoped>
.protected-viewer{max-width:1100px;margin:0 auto}
.viewer-nav{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.viewer-nav span,.viewer-note{font-size:12px;color:var(--secondary)}
.protected-viewer h2{font-size:19px;margin:20px 0 10px}
.viewer-stage{display:grid;place-items:center;min-height:270px;max-height:75dvh;background:#101216;border-radius:15px;overflow:hidden;color:#f2f3f5}
.viewer-stage img{max-width:100%;max-height:75dvh;object-fit:contain}
.viewer-stage p{font-size:13px;padding:16px;text-align:center}
</style>
