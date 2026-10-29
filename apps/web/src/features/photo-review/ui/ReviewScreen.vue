<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import {useRoute} from 'vue-router'
import {identity} from '../../identity'
import {language} from '../../ui-preview'
import {loadReview,submitReview,acceptServerReview,type ReviewView,type ReviewDecision} from '../index'
const route=useRoute(),ru=computed(()=>language.value==='ru')
const photoId=computed(()=>typeof route.params.photoId==='string'?route.params.photoId:'')
const status=ref<ReviewView|null>(null),comment=ref(''),decision=ref<Exclude<ReviewDecision,'pending'>>('accepted')
const busy=ref(false),error=ref('')
const copy=computed(()=>ru.value?{
  back:'К фотографии',title:'Проверка снимка',state:'Решение',
  pending:'На рассмотрении',accepted:'Принят',correction:'Исправить',
  reshoot:'Переснять',rejected:'Отклонён',review:'Сохранить решение',respond:'Ответить',
  comment:'Комментарий (зашифрован)',reply:'Ответ автора (зашифрован)',
  offline:'Нет соединения. Решение сохраняется локально до синхронизации.',
  local:'Локально — ждёт подтверждения сервера',conflict:'Конфликт ревизий: локальный текст сохранён.',
  keepRemote:'Принять серверную версию',server:'Подтверждено сервером',
  error:'Не удалось выполнить операцию',locked:'Войдите в аккаунт',
  note:'Комментарий хранится в зашифрованном виде. Review не меняет статус задания.',
}:{
  back:'Back to photo',title:'Photo review',state:'Decision',
  pending:'Pending',accepted:'Accepted',correction:'Changes required',
  reshoot:'Reshoot',rejected:'Rejected',review:'Save review',respond:'Respond',
  comment:'Comment (encrypted)',reply:'Author response (encrypted)',
  offline:'Offline. This decision is saved locally until it syncs.',
  local:'Local — pending server acknowledgement',conflict:'Revision conflict: local text is preserved.',
  keepRemote:'Accept server version',server:'Confirmed by server',
  error:'Could not complete action',locked:'Unlock account first',
  note:'The comment is encrypted. Photo review never changes the assignment state.',
})
let epoch=0
async function refresh(){
  const token=++epoch,actor=identity.value
  if(!actor||!photoId.value){status.value=null;return}
  try{
    const next=await loadReview(photoId.value)
    if(token!==epoch||identity.value?.accountId!==actor.accountId)return
    status.value=next
  }catch(e){if(token===epoch)error.value=e instanceof Error?e.message:copy.value.error}
}
async function send(action:'review'|'respond'){
  if(!photoId.value||busy.value)return
  busy.value=true;error.value=''
  try{
    status.value=await submitReview(photoId.value,action,action==='respond'?null:decision.value,comment.value)
    comment.value=''
  }catch(e){error.value=e instanceof Error?e.message:copy.value.error}
  finally{busy.value=false}
}
async function resolve(){
  if(!photoId.value||busy.value)return
  busy.value=true;error.value=''
  try{status.value=await acceptServerReview(photoId.value)}
  catch(e){error.value=e instanceof Error?e.message:copy.value.error}
  finally{busy.value=false}
}
watch(photoId,()=>{status.value=null;comment.value='';void refresh()})
watch(identity,()=>{epoch++;status.value=null;comment.value='';void refresh()})
onMounted(()=>{void refresh()})
onUnmounted(()=>{epoch++})
</script>
<template>
<section class="review-screen" data-testid="assignment-photo-review">
  <RouterLink :to="'/photos/'+photoId">{{ copy.back }}</RouterLink>
  <h1>{{ copy.title }}</h1>
  <p v-if="!identity" role="status">{{ copy.locked }}</p>
  <template v-else>
    <p v-if="identity.offline" role="status">{{ copy.offline }}</p>
    <p v-if="error" role="alert" class="review-error">{{ error }}</p>
    <div v-if="status" class="review-panel">
      <p>{{ copy.state }}: <strong>{{ copy[status.state] }}</strong></p>
      <p role="status">{{ status.sync==='synced'?copy.server:
        status.sync==='conflict'?copy.conflict:copy.local }}</p>
      <p>{{ copy.note }}</p>
      <p v-if="status.reviewComment"><strong>{{ copy.comment }}:</strong> {{ status.reviewComment }}</p>
      <p v-if="status.responseComment"><strong>{{ copy.reply }}:</strong> {{ status.responseComment }}</p>
      <form class="review-form" @submit.prevent="send('review')">
        <label>{{ copy.state }}
          <select v-model="decision">
            <option value="accepted">{{ copy.accepted }}</option>
            <option value="correction">{{ copy.correction }}</option>
            <option value="reshoot">{{ copy.reshoot }}</option>
            <option value="rejected">{{ copy.rejected }}</option>
          </select>
        </label>
        <label>{{ copy.comment }}
          <textarea v-model="comment" rows="3" maxlength="2000"></textarea>
        </label>
        <button type="submit" :disabled="busy||status.sync==='conflict'||status.sync==='pending'||
          (decision!=='accepted'&&!comment.trim())">{{ copy.review }}</button>
        <button v-if="status.state==='correction'||status.state==='reshoot'"
          type="button" :disabled="busy||status.sync!=='synced'||!comment.trim()"
          @click="send('respond')">{{ copy.respond }}</button>
      </form>
      <button v-if="status.sync==='conflict'" type="button" :disabled="busy||identity.offline"
        @click="resolve">{{ copy.keepRemote }}</button>
      <button type="button" :disabled="busy" @click="refresh">{{ copy.back }} / ↻</button>
    </div>
  </template>
</section>
</template>
<style scoped>
.review-screen{max-width:780px;margin:auto;padding:20px 16px 110px;color:var(--text)}
.review-screen h1{font-size:24px}.review-panel{border:1px solid var(--border);padding:18px;border-radius:14px;background:var(--surface)}
.review-form{display:flex;flex-direction:column;gap:16px;margin:16px 0}
.review-form label{display:flex;flex-direction:column;gap:7px;font-size:13px}
.review-form textarea,.review-form select{font:inherit;background:var(--surface);color:var(--text);
 border:1px solid var(--border);border-radius:8px;padding:10px;min-height:44px}
.review-form button,.review-panel>button{min-height:44px;margin:6px}.review-error{color:var(--danger,#b44)}
</style>
