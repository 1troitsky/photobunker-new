<script setup lang="ts">
import {ref,watch,onUnmounted} from 'vue'
import {identity,registerDecryptedObjectUrl,revokeDecryptedObjectUrl,onIdentityCleanup} from '../../identity'
import {thumbnail} from '../application/library'
const props=defineProps<{photoId:string;label?:string}>()
const url=ref('')
let epoch=0
function clear(){epoch++;if(url.value){revokeDecryptedObjectUrl(url.value);url.value=''}}
const release=onIdentityCleanup(clear)
async function show(){
  clear()
  if(!identity.value)return
  const id=props.photoId,token=epoch,active=identity.value
  try{
    const blob=await thumbnail(id)
    if(!blob)return
    if(token!==epoch||identity.value?.accountId!==active.accountId||
      identity.value?.deviceId!==active.deviceId)return
    const imageUrl=URL.createObjectURL(blob)
    if(token!==epoch){URL.revokeObjectURL(imageUrl);return}
    registerDecryptedObjectUrl(imageUrl);url.value=imageUrl
  }catch{/* missing or corrupt: placeholder remains */}
}
function broken(){clear()}
watch(()=>[props.photoId,identity.value?.accountId,identity.value?.deviceId],()=>{void show()},{immediate:true})
onUnmounted(()=>{clear();release()})
</script>
<template>
  <img v-if="url" :src="url" :alt="label??''" loading="lazy" decoding="async"
    referrerpolicy="no-referrer" class="gallery-thumb-image" @error="broken">
  <span v-else class="gallery-thumb-placeholder" aria-hidden="true">▧</span>
</template>
<style scoped>
.gallery-thumb-image,.gallery-thumb-placeholder{width:100%;height:100%;object-fit:cover;display:grid;place-items:center}
.gallery-thumb-placeholder{background:var(--panel);color:var(--muted);font-size:28px}
</style>