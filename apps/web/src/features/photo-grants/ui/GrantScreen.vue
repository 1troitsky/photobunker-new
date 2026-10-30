<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import {useRoute} from 'vue-router'
import {identity,onIdentityCleanup} from '../../identity'
import {language} from '../../ui-preview'
import {openAssignments} from '../../assignments'
import {localGallery} from '../../gallery'
import {inviteToAssignment,acceptAssignmentGrant,changeAssignmentGrant,
  fetchAssignmentGrants,flushGrantOperations,grantOutboxStatus,publishRecipientThumbnail,thumbnailShareStatuses,
  type ServerGrant,type GrantRole,type GrantOutboxState,type ThumbnailShareStatus} from '../index'

const ru=computed(()=>language.value==='ru'),route=useRoute()
const copy=computed(()=>ru.value?{
 title:'Участники заданий',viewPhotos:'Полученные миниатюры',choosePhoto:'Выберите снимок',publish:'Подготовить миниатюру для участника',published:'Зашифрованная миниатюра подготовлена.',shareQueued:'Зашифрованная миниатюра поставлена в очередь отправки (не подтверждена сервером).',pendingOp:'В очереди',retryOp:'Повтор после ошибки',delivered:'Подтверждено сервером',conflictOp:'Сервер отклонил операцию — требуется проверка',state:'Состояние операций',note:'Приглашение не открывает фотографии. Общий доступ будет включён только после проверки E2EE и серверных прав.',
 back:'К заданиям',loading:'Загружаем приглашения…',
 account:'Сначала откройте аккаунт',offline:'Приглашения требуют подключения к серверу.',
 new:'Пригласить участника',assignment:'Задание',recipient:'ID аккаунта получателя',
 role:'Роль',curator:'Куратор',contributor:'Участник',viewer:'Наблюдатель',
 invite:'Создать приглашение',pending:'Ожидает принятия',accepted:'Приглашение принято',
 incoming:'Входящие',outgoing:'Отправленные',none:'Приглашений пока нет',
 grant:'Приглашение',code:'Одноразовый код — передайте получателю приватно',
 once:'Сохраните код сейчас. После закрытия экрана повторно показать его нельзя.',
 copy:'Копировать код',copied:'Скопировано',close:'Скрыть код',
 accept:'Принять',decline:'Отклонить',revoke:'Отозвать',leave:'Покинуть',
 enterCode:'Введите код от отправителя',sync:'Отправить ожидающие операции',
 queued:'Операция записана в зашифрованную очередь. Подтверждение ожидается.',
 error:'Операция не выполнена.',refresh:'Обновить',
}:{
 title:'Assignment participants',viewPhotos:'Received thumbnails',choosePhoto:'Select a photo',publish:'Prepare encrypted thumbnail',published:'Encrypted thumbnail prepared.',shareQueued:'Encrypted thumbnail queued; server delivery is not confirmed yet.',pendingOp:'Queued locally',retryOp:'Retry scheduled',delivered:'Server confirmed',conflictOp:'Server rejected operation — review required',state:'Operations',note:'An invitation does not unlock photos. Sharing remains disabled until independent E2EE and server ACL verification.',
 back:'Assignments',loading:'Loading invitations…',account:'Unlock account first',
 offline:'Invitations require an online connection.',
 new:'Invite a participant',assignment:'Assignment',recipient:'Recipient account ID',
 role:'Role',curator:'Curator',contributor:'Contributor',viewer:'Viewer',
 invite:'Create invitation',pending:'Awaiting acceptance',accepted:'Invitation accepted',
 incoming:'Incoming',outgoing:'Outgoing',none:'No invitations yet',
 grant:'Invitation',code:'One-time invitation code — deliver privately',
 once:'Save the code now. It cannot be shown again after leaving this screen.',
 copy:'Copy code',copied:'Copied',close:'Hide code',
 accept:'Accept',decline:'Decline',revoke:'Revoke',leave:'Leave',
 enterCode:'Enter code received from the sender',sync:'Send pending operations',
 queued:'Operation saved in encrypted outbox. Awaiting server confirmation.',
 error:'Operation failed.',refresh:'Refresh',
})
const assignments=ref<{id:string;title:string}[]>([])
const photoOptions=ref<{id:string;assignmentId:string;title:string}[]>([])
const selectedPhoto=ref<Record<string,string>>({})
const selected=ref(''),recipient=ref(''),role=ref<GrantRole>('contributor')
const grants=ref<ServerGrant[]>([]),outbox=ref<GrantOutboxState[]>([]),shareOutbox=ref<ThumbnailShareStatus[]>([]),inputCode=ref<Record<string,string>>({})
const invitation=ref<{grantId:string;code:string}|null>(null)
const busy=ref(false),loading=ref(false),notice=ref(''),error=ref('')
let epoch=0,stopped=false
function clear(){
  epoch++;grants.value=[];outbox.value=[];shareOutbox.value=[];assignments.value=[];invitation.value=null
  inputCode.value={};selectedPhoto.value={};photoOptions.value=[];notice.value='';error.value=''
}
const release=onIdentityCleanup(clear)
const own=computed(()=>grants.value.filter(x=>x.ownerId===identity.value?.accountId))
const incoming=computed(()=>grants.value.filter(x=>x.recipientId===identity.value?.accountId))
function photoChoices(row:ServerGrant){
  return photoOptions.value.filter(x=>x.assignmentId===row.assignmentId)
}
async function reload(){
  const active=identity.value,token=++epoch
  if(!active){clear();return}
  loading.value=true;error.value=''
  try{
    const assignmentsNow=await openAssignments().list()
    if(token!==epoch||stopped||identity.value?.accountId!==active.accountId||
       identity.value?.deviceId!==active.deviceId)return
    outbox.value=await grantOutboxStatus()
    shareOutbox.value=await thumbnailShareStatuses()
    if(token!==epoch||stopped)return
    assignments.value=assignmentsNow.filter(a=>a.sync==='synced'&&a.status!=='completed')
      .map(a=>({id:a.id,title:a.title}))
    const requested=typeof route.query.assignment==='string'?route.query.assignment:''
    if(!assignments.value.some(x=>x.id===selected.value))
      selected.value=assignments.value.find(x=>x.id===requested)?.id??assignments.value[0]?.id??''
    if(active.offline||!navigator.onLine){notice.value=copy.value.offline;return}
    grants.value=await fetchAssignmentGrants()
    if(token!==epoch||stopped)return
    try{
      const photos=await localGallery()
      if(token!==epoch||stopped)return
      photoOptions.value=photos.filter(p=>p.state==='synced'&&
        p.header.capture?.assignmentId&&p.header.thumbnailAssetId&&
        p.header.expiresAt>Date.now()).map(p=>({id:p.header.photoId,
          assignmentId:p.header.capture!.assignmentId,title:p.title||p.nameId||p.header.photoId}))
      const requestedPhoto=typeof route.query.photo==='string'?route.query.photo:''
      const requestedAssignment=typeof route.query.assignment==='string'?route.query.assignment:''
      if(requestedPhoto&&requestedAssignment&&
        photoOptions.value.some(p=>p.id===requestedPhoto&&p.assignmentId===requestedAssignment)){
        for(const grant of grants.value){
          if(grant.ownerId===active.accountId&&grant.state==='accepted'&&
            grant.assignmentId===requestedAssignment&&!selectedPhoto.value[grant.grantId])
            selectedPhoto.value[grant.grantId]=requestedPhoto
        }
      }
    }catch{photoOptions.value=[]}
  }catch(e){if(token===epoch)error.value=e instanceof Error?e.message:copy.value.error}
  finally{if(token===epoch)loading.value=false}
}
async function invite(){
  if(!selected.value||!recipient.value||busy.value)return
  busy.value=true;error.value='';notice.value='';invitation.value=null
  try{
    const created=await inviteToAssignment(selected.value,recipient.value.trim(),role.value)
    // Code exists in reactive runtime memory only; it is never saved to storage or URL.
    invitation.value=created;recipient.value='';notice.value=copy.value.queued
    outbox.value=await grantOutboxStatus()
    void flushGrantOperations()
  }catch(e){error.value=e instanceof Error?e.message:copy.value.error}
  finally{busy.value=false}
}
async function act(row:ServerGrant,kind:'accept'|'decline'|'revoke'|'leave'){
  if(busy.value)return
  busy.value=true;error.value='';notice.value=''
  try{
    if(kind==='accept'){
      const code=inputCode.value[row.grantId]??''
      await acceptAssignmentGrant(row.grantId,code)
    }else await changeAssignmentGrant(row,kind)
    inputCode.value[row.grantId]=''
    notice.value=copy.value.queued
    outbox.value=await grantOutboxStatus()
    void flushGrantOperations()
  }catch(e){error.value=e instanceof Error?e.message:copy.value.error}
  finally{busy.value=false}
}

async function publish(row:ServerGrant){
  const photo=selectedPhoto.value[row.grantId]
  if(busy.value||!photo)return
  busy.value=true;error.value='';notice.value=''
  try{
    await publishRecipientThumbnail(row.grantId,photo)
    notice.value=copy.value.shareQueued
    shareOutbox.value=await thumbnailShareStatuses()
    delete selectedPhoto.value[row.grantId]
  }catch(e){error.value=e instanceof Error?e.message:copy.value.error}
  finally{busy.value=false}
}

async function copyCode(){
  if(!invitation.value)return
  const copied=invitation.value.code
  try{await navigator.clipboard.writeText(copied);notice.value=copy.value.copied}
  catch{error.value=copy.value.error}
}
function wake(){if(!document.hidden)void reload();else invitation.value=null}
onMounted(()=>{
  stopped=false;void reload()
  window.addEventListener('photobunker-grant-updated',wake)
  window.addEventListener('online',wake)
  window.addEventListener('focus',wake)
  document.addEventListener('visibilitychange',wake)
  window.addEventListener('pagehide',clear)
})
onUnmounted(()=>{
  stopped=true;clear();release()
  window.removeEventListener('photobunker-grant-updated',wake)
  window.removeEventListener('online',wake)
  window.removeEventListener('focus',wake)
  document.removeEventListener('visibilitychange',wake)
  window.removeEventListener('pagehide',clear)
})
watch(()=>[identity.value?.accountId,identity.value?.deviceId],()=>{
  clear()
  if(identity.value)void reload()
},{flush:'sync'})
</script>
<template>
  <section class="grant-screen" data-testid="assignment-grants">
    <RouterLink to="/assignments" class="subtle-button">{{ copy.back }}</RouterLink>
    <h1>{{ copy.title }}</h1><p class="grant-note">{{ copy.note }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="!identity">{{ copy.account }}</p>
    <template v-else>
      <p v-if="loading" role="status">{{ copy.loading }}</p>
      <div class="grant-panel">
        <h2>{{ copy.new }}</h2>
        <form class="grant-form" @submit.prevent="invite">
          <label>{{ copy.assignment }}
            <select v-model="selected" :disabled="busy">
              <option v-for="assignment in assignments" :key="assignment.id" :value="assignment.id">
                {{ assignment.title }}
              </option>
            </select>
          </label>
          <label>{{ copy.recipient }}
            <input v-model="recipient" autocomplete="off" autocapitalize="none" spellcheck="false"
              maxlength="36" required :disabled="busy">
          </label>
          <label>{{ copy.role }}
            <select v-model="role" :disabled="busy">
              <option value="curator">{{ copy.curator }}</option>
              <option value="contributor">{{ copy.contributor }}</option>
              <option value="viewer">{{ copy.viewer }}</option>
            </select>
          </label>
          <button class="primary-button" type="submit" :disabled="busy||!selected||identity.offline">
            {{ copy.invite }}
          </button>
        </form>
        <div v-if="invitation" class="grant-code">
          <strong>{{ copy.code }}</strong>
          <code>{{ invitation.code }}</code>
          <p>{{ copy.once }}</p>
          <button type="button" class="subtle-button" @click="copyCode">{{ copy.copy }}</button>
          <button type="button" class="subtle-button" @click="invitation=null">{{ copy.close }}</button>
        </div>
      </div>
      <div v-if="shareOutbox.length" class="grant-panel" role="status">
        <h2>{{ copy.state }} · {{ copy.publish }}</h2>
        <p v-for="share in shareOutbox" :key="share.operationId" class="grant-operation">
          <strong>{{ share.photoId }}</strong> · {{ share.grantId }} ·
          {{ share.state==='conflict'?copy.conflictOp:
            share.state==='retry'?copy.retryOp:share.state==='acknowledged'?copy.delivered:copy.pendingOp }}
          <small v-if="share.lastError">{{ share.lastError }}</small>
        </p>
      </div>
      <div v-if="outbox.length" class="grant-panel" role="status">
        <h2>{{ copy.state }}</h2>
        <p v-for="op in outbox" :key="op.opId" class="grant-operation">
          <strong>{{ op.kind }}</strong> · {{ op.grantId }}
          · {{ op.state==='conflict'?copy.conflictOp:
            op.state==='retry'?copy.retryOp:copy.pendingOp }}
          <small v-if="op.error">{{ op.error }}</small>
        </p>
      </div>
      <div class="grant-panel">
        <header><h2>{{ copy.incoming }}</h2>
          <button class="subtle-button" type="button" @click="reload">{{ copy.refresh }}</button></header>
        <p v-if="!incoming.length">{{ copy.none }}</p>
        <article v-for="item in incoming" :key="item.grantId" class="grant-entry">
          <strong>{{ item.assignmentId }}</strong><small>{{ item.role }} · {{ item.state==='pending'?copy.pending:copy.accepted }}</small>
          <template v-if="item.state==='pending'">
            <input v-model="inputCode[item.grantId]" type="password" autocomplete="off"
              autocapitalize="none" spellcheck="false" :placeholder="copy.enterCode">
            <button class="subtle-button" type="button" :disabled="busy||identity.offline"
              @click="act(item,'accept')">{{ copy.accept }}</button>
            <button class="subtle-button" type="button" :disabled="busy||identity.offline"
              @click="act(item,'decline')">{{ copy.decline }}</button>
          </template>
          <template v-else>
            <RouterLink class="subtle-button" :to="'/assignment-grants/'+item.grantId+'/photos'">
              {{ copy.viewPhotos }}
            </RouterLink>
            <button class="subtle-button" type="button" :disabled="busy||identity.offline"
              @click="act(item,'leave')">{{ copy.leave }}</button>
          </template>
        </article>
      </div>
      <div class="grant-panel">
        <h2>{{ copy.outgoing }}</h2><p v-if="!own.length">{{ copy.none }}</p>
        <article v-for="item in own" :key="item.grantId" class="grant-entry">
          <strong>{{ item.recipientId }}</strong>
          <small>{{ item.role }} · {{ item.state==='pending'?copy.pending:copy.accepted }}</small>
          <template v-if="item.state==='accepted'">
            <select v-model="selectedPhoto[item.grantId]" :aria-label="copy.choosePhoto"
              :disabled="busy||identity.offline||!photoChoices(item).length">
              <option value="">{{ copy.choosePhoto }}</option>
              <option v-for="photo in photoChoices(item)" :key="photo.id" :value="photo.id">
                {{ photo.title }}
              </option>
            </select>
            <small v-if="selectedPhoto[item.grantId]&&route.query.photo===selectedPhoto[item.grantId]"
              class="share-selection-hint">{{ copy.selectionHint }}</small>
            <button type="button" class="subtle-button"
              :disabled="busy||identity.offline||!selectedPhoto[item.grantId]"
              @click="publish(item)">{{ copy.publish }}</button>
          </template>
          <button class="subtle-button" type="button" :disabled="busy||identity.offline"
            @click="act(item,'revoke')">{{ copy.revoke }}</button>
        </article>
      </div>
      <button class="subtle-button" type="button" @click="flushGrantOperations">{{ copy.sync }}</button>
    </template>
  </section>
</template>
<style scoped>
.grant-screen{max-width:880px;margin:0 auto;padding:20px 16px 130px}
.grant-screen h1{font-size:24px;margin:16px 0}
.grant-screen h2{font-size:18px}
.grant-note{font-size:13px;color:var(--secondary)}
.grant-panel{border:1px solid var(--border);background:var(--surface);border-radius:13px;padding:18px;margin:18px 0}
.grant-panel header{display:flex;align-items:center;justify-content:space-between}
.grant-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.grant-form label{display:flex;flex-direction:column;gap:7px;font-size:13px}
.grant-form input,.grant-form select,.grant-entry input{
  min-width:0;width:100%;min-height:44px;border:1px solid var(--border);
  border-radius:9px;padding:8px;background:var(--background);color:var(--text)}
.grant-entry{display:flex;align-items:center;flex-wrap:wrap;gap:9px;
  border-top:1px solid var(--border);padding:12px 0}
.grant-entry strong{font-size:12px;overflow-wrap:anywhere;flex:1 1 220px}
.grant-entry small{font-size:12px;color:var(--secondary)}
.grant-entry input,.grant-entry select{flex:1 1 180px;min-height:44px;background:var(--background);color:var(--text);border:1px solid var(--border);border-radius:9px}
.grant-code{border:1px solid var(--border);padding:12px;border-radius:10px;margin-top:20px}
.grant-code code{display:block;overflow-wrap:anywhere;margin:12px 0;font-size:13px}
.grant-code p{font-size:12px}
.grant-operation{overflow-wrap:anywhere;font-size:12px}
.grant-operation small{display:block;color:var(--secondary)}
@media(max-width:650px){.grant-form{grid-template-columns:1fr}}
</style>
