<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {identity,onIdentityCleanup} from '../../identity'
import {language} from '../../ui-preview'
import {openCollaboration,onCollaborationChange,flushCollaboration,
  prepareTeamAvatar,mayInvite,mayManage,mayManageMember,
  type TeamView,type TeamProfile,type InviteRole,type Contact,type Invite,type OutgoingInvite} from '../index'
const route=useRoute(),router=useRouter()
const ru=computed(()=>language.value==='ru')
const copy=computed(()=>ru.value?{
  teams:'Команды',contacts:'Контакты',addTeam:'Создать команду',newTeam:'Новая команда',
  back:'Назад',save:'Сохранить',cancel:'Отмена',name:'Название',description:'Описание',
  avatar:'Аватар (без метаданных)',noTeams:'Пока нет команд',noContacts:'Контактов пока нет',
  ownId:'Ваш ID аккаунта — поделитесь им с доверенным контактом',
  addContact:'Пригласить контакт по ID аккаунта',request:'Отправить запрос',
  pending:'Ожидает подтверждения',incoming:'Запросы на контакт',accept:'Принять',decline:'Отклонить',
  contactAccepted:'Контакт принят',remove:'Удалить контакт',block:'Заблокировать',
  unblock:'Разблокировать',blocked:'Заблокированные аккаунты',
  invites:'Приглашения в команды',invite:'Пригласить участника',
  outgoing:'Отправленные приглашения',revokeInvite:'Отозвать приглашение',copyLink:'Копировать ссылку на команду',
  invitationCode:'Код приглашения',enterCode:'Введите переданный вам код',
  codeHelp:'Передайте этот код человеку напрямую. Он показывается один раз, не хранится на сервере. Без кода участник не расшифрует профиль команды.',
  codeEnterHelp:'Запросите у пригласившего секретный код, переданный вне PhotoBunker.',
  copy:'Копировать',copied:'Скопировано',role:'Роль',members:'Участники',
  owner:'Владелец',curator:'Куратор',contributor:'Участник',viewer:'Наблюдатель',
  changeRole:'Изменить роль',revoke:'Отозвать доступ',leave:'Покинуть команду',
  delete:'Удалить команду',confirm:'Подтвердите действие',tasks:'Задания команды',
  tasksLater:'Связанные задания появятся после отдельного назначения прав. Членство не открывает фотографии.',
  noChat:'В этом приложении нет чатов.',offline:'Нет соединения — изменения сохраняются локально до синхронизации.',
  waiting:'Ожидает синхронизации',retry:'Повторить',conflict:'Ошибка доступа или конфликт. Проверьте права и повторите вручную.',
  locked:'Ключ команды отсутствует на устройстве. Требуется новое защищённое приглашение.',
  login:'Откройте анонимный аккаунт для команд и контактов.',
  account:'Аккаунт',team:'Команда',updated:'Синхронизировано',security:'Данные команды зашифрованы. Отозванный участник не получит новых данных с сервера.',
  error:'Операция не выполнена',pendingChanges:'Несинхронизированные действия',readOnly:'Только просмотр',
}:{
  teams:'Teams',contacts:'Contacts',addTeam:'Create team',newTeam:'New team',
  back:'Back',save:'Save',cancel:'Cancel',name:'Name',description:'Description',
  avatar:'Avatar (metadata stripped)',noTeams:'No teams yet',noContacts:'No contacts yet',
  ownId:'Your account ID — share with a trusted contact',
  addContact:'Request contact by account ID',request:'Send request',
  pending:'Pending acceptance',incoming:'Contact requests',accept:'Accept',decline:'Decline',
  contactAccepted:'Accepted contact',remove:'Remove contact',block:'Block',
  unblock:'Unblock',blocked:'Blocked accounts',
  invites:'Team invitations',invite:'Invite member',
  outgoing:'Sent invitations',revokeInvite:'Revoke invitation',copyLink:'Copy team link',
  invitationCode:'Invitation code',enterCode:'Enter the code shared with you',
  codeHelp:'Send the code directly to the recipient. It is shown once, never stored on the server. Without it the member cannot decrypt the team profile.',
  codeEnterHelp:'Ask your inviter for the secret code shared outside PhotoBunker.',
  copy:'Copy',copied:'Copied',role:'Role',members:'Members',
  owner:'Owner',curator:'Curator',contributor:'Contributor',viewer:'Viewer',
  changeRole:'Change role',revoke:'Revoke access',leave:'Leave team',
  delete:'Delete team',confirm:'Confirm action',tasks:'Team assignments',
  tasksLater:'Explicit assignment grants will appear here. Membership never unlocks photos.',
  noChat:'This application does not include chat.',offline:'Offline — changes remain local until sync.',
  waiting:'Awaiting sync',retry:'Retry',conflict:'Denied or revision conflict. Recheck access and resolve manually.',
  locked:'The team key is missing on this device. A new secure invitation is required.',
  login:'Unlock your anonymous account to manage teams and contacts.',
  account:'Account',team:'Team',updated:'Synced',security:'Team data stays encrypted. Revoked members cannot fetch new server content.',
  error:'Action could not be completed',pendingChanges:'Pending operations',readOnly:'Read-only',
})
const detailId=computed(()=>typeof route.params.teamId==='string'?route.params.teamId:null)
const showContacts=computed(()=>route.path==='/contacts')
const teams=ref<TeamView[]>([]),contacts=ref<Contact[]>([]),invites=ref<Invite[]>([]),outgoing=ref<OutgoingInvite[]>([]),blocks=ref<string[]>([])
const selected=computed(()=>teams.value.find(x=>x.id===detailId.value))
const loading=ref(false),busy=ref(false),error=ref(''),accountId=ref('')
const creating=ref(false),editing=ref(false),invitePanel=ref(false)
const draft=ref<TeamProfile>({name:'',description:'',avatar:null})
const target=ref(''),inviteTarget=ref(''),inviteRole=ref<InviteRole>('contributor'),roleEdit=ref<Record<string,InviteRole>>({})
const secretCode=ref(''),recipientCode=ref(''),copied=ref(false)
const pendingCount=ref(0)
let epoch=0,closed=false,unsubscribe:()=>void=()=>{}
const unsubscribeIdentity=onIdentityCleanup(()=>{
  epoch++;teams.value=[];contacts.value=[];invites.value=[];outgoing.value=[];blocks.value=[];accountId.value=''
  clearSecret();recipientCode.value='';error.value=''
})
function clearSecret(){secretCode.value='';copied.value=false}
async function reload(){
  const ticket=++epoch,who=identity.value
  if(!who){teams.value=[];contacts.value=[];invites.value=[];outgoing.value=[];blocks.value=[];accountId.value='';return}
  loading.value=true
  try{
    const service=openCollaboration()
    const state=await service.state(),pending=await service.pending()
    if(closed||ticket!==epoch||identity.value?.accountId!==who.accountId||
      identity.value.deviceId!==who.deviceId)return
    accountId.value=who.accountId
    teams.value=state.teams;contacts.value=state.contacts;invites.value=state.invitations;outgoing.value=state.outgoingInvitations
    blocks.value=state.blocks;pendingCount.value=pending.length
  }catch(e){if(ticket===epoch)error.value=e instanceof Error?e.message:copy.value.error}
  finally{if(ticket===epoch)loading.value=false}
}
async function refresh(){await flushCollaboration();await reload()}
async function execute(work:()=>Promise<unknown>,after?:()=>Promise<void>){
  if(busy.value||!identity.value)return
  busy.value=true;error.value=''
  const who=identity.value
  try{
    await work()
    if(identity.value?.accountId!==who.accountId||identity.value.deviceId!==who.deviceId)return
    if(after)await after()
    await reload()
    if(!identity.value?.offline)void flushCollaboration()
  }catch(e){error.value=e instanceof Error?e.message:copy.value.error}
  finally{busy.value=false}
}
function startTeam(){draft.value={name:'',description:'',avatar:null};creating.value=true;editing.value=false;clearSecret()}
function startEdit(){
  const team=selected.value
  if(!team||!mayManage(team.role)||team.sync==='locked')return
  draft.value={...team.profile};editing.value=true;creating.value=false
}
async function onAvatar(event:Event){
  const file=(event.target as HTMLInputElement).files?.[0]
  if(!file)return
  busy.value=true;error.value=''
  try{draft.value.avatar=await prepareTeamAvatar(file)}
  catch(e){error.value=e instanceof Error?e.message:copy.value.error}
  finally{busy.value=false}
}
function saveTeam(){
  const copyDraft={...draft.value}
  execute(async()=>{
    if(editing.value&&detailId.value)await openCollaboration().edit(detailId.value,copyDraft)
    else {
      const team=await openCollaboration().create(copyDraft)
      await router.push('/teams/'+team.id)
    }
  },async()=>{creating.value=false;editing.value=false})
}
function requestContact(){const id=target.value.trim().toLowerCase()
  execute(()=>openCollaboration().contact('contact_request',id),async()=>{target.value=''})}
function contactAction(kind:'contact_accept'|'contact_remove'|'block'|'unblock',id:string){
  execute(()=>openCollaboration().contact(kind,id))
}
function invite(){
  const id=inviteTarget.value.trim().toLowerCase(),role=inviteRole.value,teamId=detailId.value
  if(!teamId)return
  execute(async()=>{
    const item=await openCollaboration().invite(teamId,id,role)
    secretCode.value=item.code;copied.value=false
  },async()=>{inviteTarget.value='';invitePanel.value=false})
}
function acceptInvite(item:Invite){
  const code=recipientCode.value.trim()
  execute(()=>openCollaboration().accept(item,code),async()=>{recipientCode.value=''})
}
function declineInvite(item:Invite){execute(()=>openCollaboration().decline(item.id))}
function revokeInvite(id:string){execute(()=>openCollaboration().revokeInvite(id))}
function editMember(id:string,role:InviteRole|null){
  if(!detailId.value)return
  execute(()=>openCollaboration().member(detailId.value!,id,role))
}
async function removeTeam(){
  const team=selected.value
  if(!team||!window.confirm(copy.value.confirm+'?'))return
  await execute(async()=>{
    if(team.role==='owner')await openCollaboration().removeTeam(team.id)
    else await openCollaboration().leave(team.id)
    await router.push('/teams')
  })
}
async function copyId(){
  if(!accountId.value)return
  try{await navigator.clipboard.writeText(accountId.value);copied.value=true}
  catch{error.value=copy.value.error}
}
async function copyTeamLink(){
  if(!detailId.value)return
  try{
    await navigator.clipboard.writeText(new URL('/teams/'+detailId.value,location.origin).href)
    copied.value=true
  }catch{error.value=copy.value.error}
}
async function copyCode(){
  if(!secretCode.value)return
  try{await navigator.clipboard.writeText(secretCode.value);copied.value=true}
  catch{error.value=copy.value.error}
}
watch(()=>route.fullPath,()=>{clearSecret();creating.value=false;editing.value=false;invitePanel.value=false;void reload()})
watch(identity,()=>{clearSecret();void reload()})
onMounted(()=>{closed=false;unsubscribe=onCollaborationChange(()=>{void reload()});void reload();void flushCollaboration()})
onUnmounted(()=>{closed=true;epoch++;unsubscribeIdentity();unsubscribe();clearSecret()})
</script>

<template>
<section class="collab-real" data-testid="real-collaboration">
  <header class="collab-header">
    <div>
      <RouterLink v-if="detailId" to="/teams">{{ copy.back }}</RouterLink>
      <h1>{{ showContacts?copy.contacts:detailId?(selected?.profile.name||copy.team):copy.teams }}</h1>
    </div>
    <nav class="collab-nav">
      <RouterLink to="/teams">{{ copy.teams }}</RouterLink>
      <RouterLink to="/contacts">{{ copy.contacts }}</RouterLink>
      <RouterLink to="/profile">{{ copy.account }}</RouterLink>
    </nav>
  </header>
  <div v-if="!identity" class="collab-panel" role="status">
    {{ copy.login }} <RouterLink to="/account/create">Create</RouterLink>
    <RouterLink to="/account/restore">Restore</RouterLink>
  </div>
  <template v-else>
    <p v-if="identity.offline" class="collab-hint" role="status">{{ copy.offline }}</p>
    <p v-if="pendingCount" class="collab-hint" role="status">{{ copy.pendingChanges }}: {{ pendingCount }}</p>
    <p v-if="loading" class="collab-hint" role="status">…</p>
    <p v-if="error" class="collab-error" role="alert">{{ error }}</p>
    <div class="collab-actions">
      <button type="button" :disabled="busy||identity.offline" @click="refresh">{{ copy.retry }}</button>
    </div>
    <template v-if="showContacts">
      <section class="collab-panel">
        <h2>{{ copy.ownId }}</h2>
        <div class="collab-actions"><code>{{ accountId }}</code>
          <button type="button" @click="copyId">{{ copied?copy.copied:copy.copy }}</button></div>
        <form class="collab-form" @submit.prevent="requestContact">
          <label>{{ copy.addContact }}
            <input v-model="target" autocomplete="off" autocapitalize="off" spellcheck="false"
              maxlength="36" required placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></label>
          <button type="submit" :disabled="busy">{{ copy.request }}</button>
        </form>
      </section>
      <section class="collab-panel"><h2>{{ copy.contacts }}</h2>
        <p v-if="!contacts.length">{{ copy.noContacts }}</p>
        <ul class="collab-list"><li v-for="contact in contacts" :key="contact.accountId">
          <div class="collab-person">
            <strong>{{ contact.accountId }}</strong>
            <small>{{ contact.state==='accepted'?copy.contactAccepted:
              contact.requesterId===accountId?copy.pending:copy.incoming }}</small>
          </div>
          <div class="collab-actions">
            <button v-if="contact.state==='pending'&&contact.requesterId!==accountId"
              type="button" :disabled="busy" @click="contactAction('contact_accept',contact.accountId)">{{ copy.accept }}</button>
            <button type="button" :disabled="busy" @click="contactAction('contact_remove',contact.accountId)">{{ copy.remove }}</button>
            <button type="button" :disabled="busy" @click="contactAction('block',contact.accountId)">{{ copy.block }}</button>
          </div>
        </li></ul>
      </section>
      <section v-if="blocks.length" class="collab-panel"><h2>{{ copy.blocked }}</h2>
        <ul class="collab-list"><li v-for="id in blocks" :key="id">
          <code>{{ id }}</code><button type="button" :disabled="busy" @click="contactAction('unblock',id)">{{ copy.unblock }}</button>
        </li></ul>
      </section>
    </template>
    <template v-else-if="!detailId">
      <div class="collab-actions"><button type="button" @click="startTeam" :disabled="busy">{{ copy.addTeam }}</button></div>
      <section v-if="invites.length" class="collab-panel"><h2>{{ copy.invites }}</h2>
        <article v-for="item in invites" :key="item.id" class="collab-invite">
          <strong>{{ item.teamId }}</strong><small>{{ copy.role }}: {{ copy[item.role] }}</small>
          <p class="collab-hint">{{ copy.codeEnterHelp }}</p>
          <label>{{ copy.enterCode }} <input v-model="recipientCode" type="password" autocomplete="off"></label>
          <div class="collab-actions">
            <button type="button" :disabled="busy||!recipientCode||identity.offline" @click="acceptInvite(item)">{{ copy.accept }}</button>
            <button type="button" :disabled="busy" @click="declineInvite(item)">{{ copy.decline }}</button>
          </div>
        </article>
      </section>
      <section v-if="creating" class="collab-panel">
        <h2>{{ copy.newTeam }}</h2>
        <form class="collab-form" @submit.prevent="saveTeam">
          <label>{{ copy.name }}<input v-model="draft.name" maxlength="80" required></label>
          <label>{{ copy.description }}<textarea v-model="draft.description" maxlength="1000" rows="4"></textarea></label>
          <label>{{ copy.avatar }}<input type="file" accept="image/*" @change="onAvatar"></label>
          <img v-if="draft.avatar" :src="draft.avatar" class="collab-avatar" alt="">
          <div class="collab-actions"><button type="submit" :disabled="busy">{{ copy.save }}</button>
            <button type="button" @click="creating=false">{{ copy.cancel }}</button></div>
        </form>
      </section>
      <section class="collab-panel">
        <p v-if="!teams.length">{{ copy.noTeams }}</p>
        <ul class="collab-list"><li v-for="team in teams" :key="team.id">
          <RouterLink class="collab-team-link" :to="'/teams/'+team.id">
            <img v-if="team.profile.avatar" :src="team.profile.avatar" class="collab-avatar" alt="">
            <span v-else class="collab-initial">{{ team.profile.name.slice(0,1).toUpperCase()||'?' }}</span>
            <span><strong>{{ team.sync==='locked'?copy.locked:team.profile.name }}</strong>
              <small>{{ copy[team.role] }} · {{ team.sync }}</small></span>
          </RouterLink>
        </li></ul>
      </section>
    </template>
    <template v-else-if="selected">
      <section class="collab-panel">
        <div class="collab-team-hero">
          <img v-if="selected.profile.avatar" :src="selected.profile.avatar" class="collab-avatar" alt="">
          <div><h2>{{ selected.sync==='locked'?copy.locked:selected.profile.name }}</h2>
            <p class="collab-hint">{{ selected.profile.description }}</p><small>{{ copy[selected.role] }}</small></div>
        </div>
        <p class="collab-hint">{{ copy.security }}</p>
        <p v-if="selected.sync!=='synced'" role="status" class="collab-hint">{{ selected.sync==='locked'?copy.locked:
          selected.sync==='conflict'?copy.conflict:copy.waiting }}</p>
        <div class="collab-actions">
          <button type="button" @click="copyTeamLink">{{ copied?copy.copied:copy.copyLink }}</button>
          <button v-if="mayManage(selected.role)&&selected.sync!=='locked'" type="button" @click="startEdit">{{ copy.save }} / {{ copy.name }}</button>
          <button type="button" :disabled="busy" @click="removeTeam">{{ selected.role==='owner'?copy.delete:copy.leave }}</button>
        </div>
        <form v-if="editing" class="collab-form" @submit.prevent="saveTeam">
          <label>{{ copy.name }}<input v-model="draft.name" maxlength="80" required></label>
          <label>{{ copy.description }}<textarea v-model="draft.description" maxlength="1000" rows="4"></textarea></label>
          <label>{{ copy.avatar }}<input type="file" accept="image/*" @change="onAvatar"></label>
          <img v-if="draft.avatar" :src="draft.avatar" class="collab-avatar" alt="">
          <div class="collab-actions"><button type="submit" :disabled="busy">{{ copy.save }}</button>
            <button type="button" @click="editing=false">{{ copy.cancel }}</button></div>
        </form>
      </section>
      <section class="collab-panel">
        <h2>{{ copy.members }} ({{ selected.members.length }})</h2>
        <ul class="collab-list"><li v-for="member in selected.members" :key="member.accountId">
          <div class="collab-person"><strong>{{ member.accountId===accountId?copy.owner+' / '+copy.account:member.accountId }}</strong>
            <small>{{ copy[member.role] }}</small></div>
          <div v-if="mayManageMember(selected.role,member.role)" class="collab-actions">
            <select v-model="roleEdit[member.accountId]" :aria-label="copy.changeRole">
              <option value="curator" :disabled="selected.role!=='owner'">{{ copy.curator }}</option>
              <option value="contributor">{{ copy.contributor }}</option>
              <option value="viewer">{{ copy.viewer }}</option>
            </select>
            <button type="button" :disabled="busy||!roleEdit[member.accountId]" @click="editMember(member.accountId,roleEdit[member.accountId]!)">{{ copy.save }}</button>
            <button type="button" :disabled="busy" @click="editMember(member.accountId,null)">{{ copy.revoke }}</button>
          </div>
        </li></ul>
        <section v-if="outgoing.some(i=>i.teamId===selected.id)" class="collab-outgoing">
          <h3>{{ copy.outgoing }}</h3>
          <div v-for="item in outgoing.filter(i=>i.teamId===selected.id)" :key="item.id" class="collab-actions">
            <code>{{ item.targetId }}</code><span>{{ copy[item.role] }}</span>
            <button type="button" :disabled="busy" @click="revokeInvite(item.id)">{{ copy.revokeInvite }}</button>
          </div>
        </section>
        <div v-if="mayManage(selected.role)" class="collab-actions">
          <button type="button" @click="invitePanel=!invitePanel">{{ copy.invite }}</button>
        </div>
        <form v-if="invitePanel" class="collab-form" @submit.prevent="invite">
          <label>{{ copy.contacts }} / {{ copy.account }}
            <select v-model="inviteTarget" required>
              <option value="" disabled>{{ copy.contacts }}</option>
              <option v-for="c in contacts.filter(c=>c.state==='accepted')" :key="c.accountId"
                :value="c.accountId">{{ c.accountId }}</option>
            </select>
          </label>
          <label>{{ copy.role }} <select v-model="inviteRole">
            <option value="curator" :disabled="!mayInvite(selected.role,'curator')">{{ copy.curator }}</option>
            <option value="contributor">{{ copy.contributor }}</option>
            <option value="viewer">{{ copy.viewer }}</option></select></label>
          <button type="submit" :disabled="busy||!inviteTarget||identity.offline">{{ copy.invite }}</button>
        </form>
        <div v-if="secretCode" class="collab-secret" role="status">
          <strong>{{ copy.invitationCode }}</strong><p>{{ copy.codeHelp }}</p>
          <code>{{ secretCode }}</code>
          <div class="collab-actions"><button type="button" @click="copyCode">{{ copied?copy.copied:copy.copy }}</button>
            <button type="button" @click="clearSecret">{{ copy.cancel }}</button></div>
        </div>
      </section>
      <section class="collab-panel"><h2>{{ copy.tasks }}</h2>
        <p class="collab-hint">{{ copy.tasksLater }}</p>
        <p class="collab-hint">{{ copy.noChat }}</p>
      </section>
    </template>
  </template>
</section>
</template>
<style scoped>
.collab-real{max-width:960px;margin:0 auto;padding:18px 16px 110px;color:var(--text)}
.collab-header{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap}
.collab-header h1{margin:5px 0 16px;font-size:24px}.collab-nav{display:flex;flex-wrap:wrap;gap:14px}
.collab-panel{margin:16px 0;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px}
.collab-panel h2{font-size:17px;margin:0 0 13px}
.collab-form{display:flex;flex-direction:column;gap:14px}.collab-form label,.collab-invite label{display:flex;flex-direction:column;gap:6px}
.collab-form input,.collab-form textarea,.collab-form select,.collab-invite input,.collab-actions select{
  background:var(--surface);color:var(--text);border:1px solid var(--border);
  border-radius:9px;min-height:44px;padding:9px;font:inherit;max-width:100%}
.collab-form textarea{min-height:85px}.collab-actions{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin:12px 0}
.collab-actions button,.collab-form button,.collab-invite button{min-height:44px}
.collab-list{list-style:none;padding:0;display:flex;flex-direction:column;gap:12px}
.collab-list li{display:flex;align-items:center;flex-wrap:wrap;justify-content:space-between;gap:12px;border-bottom:1px solid var(--border);padding:12px 0}
.collab-person{display:flex;flex-direction:column;gap:5px;min-width:0}.collab-person strong,.collab-list code,.collab-secret code{overflow-wrap:anywhere;word-break:break-word}
.collab-person small,.collab-hint,.collab-team-link small{font-size:12px;color:var(--secondary)}
.collab-team-link,.collab-team-hero{display:flex;align-items:center;gap:13px;color:inherit;text-decoration:none;min-width:0}
.collab-team-link span:not(.collab-initial){display:flex;flex-direction:column;gap:5px;min-width:0}
.collab-avatar{width:58px;height:58px;object-fit:cover;border-radius:14px}
.collab-initial{width:58px;height:58px;border-radius:14px;display:grid;place-items:center;background:var(--border);font-weight:700}
.collab-error{color:var(--danger,#b33);overflow-wrap:anywhere}.collab-invite{border-top:1px solid var(--border);padding:14px 0;display:flex;flex-direction:column;gap:8px}
.collab-secret{padding:14px;border:1px dashed var(--border);border-radius:12px}
.collab-team-hero h2{margin:0 0 6px}.collab-panel code{font-size:12px}
@media(max-width:520px){.collab-header{align-items:flex-start}.collab-panel{padding:14px}.collab-actions{width:100%}}
</style>
