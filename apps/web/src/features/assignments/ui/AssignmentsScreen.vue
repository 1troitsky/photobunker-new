<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {identity,onIdentityCleanup} from '../../identity'
import {language} from '../../ui-preview'
import {openAssignments,flushAssignments,onAssignmentChange,fetchServerAssignment,steps} from '../index'
import {listAssignmentPhotos} from '../../photo-review'
import type {AssignmentView,AssignmentStatus,AssignmentFields} from '../domain/model'

const route=useRoute(),router=useRouter(),ru=computed(()=>language.value==='ru')
const rows=ref<AssignmentView[]>([]),selected=ref<AssignmentView|null>(null)
const assignmentPhotos=ref<{photoId:string;capturedAt:number}[]>([])
const loading=ref(false),saving=ref(false),error=ref(''),filter=ref(''),statusFilter=ref('all')
type VisibilityFilter='active'|'archive'|'all'
type AssignmentSort='updated'|'created'|'latest_photo'
const visibilityFilter=ref<VisibilityFilter>('active'),sortBy=ref<AssignmentSort>('updated')
const photoDates=ref<Record<string,number>>({})
const form=ref<AssignmentFields>({title:'',instructions:'',mode:3,retentionDays:45,
  startsAt:null,finishesAt:null,targetCount:null,cameraInstructions:'',requiredGps:false,
  requireDescription:false,descriptionMinLength:0,requireTags:false,allowedTags:[],
  enableNameId:true,allowEditing:true,keepOriginal:false,allowDeletion:true,
  allowBrowsing:false,capturePreset:null})
const serverRevision=ref<number|null>(null),serverVersion=ref<Awaited<ReturnType<typeof fetchServerAssignment>>|null>(null)
const details=computed(()=>typeof route.params.assignmentId==='string'?route.params.assignmentId:null)
const create=computed(()=>route.path==='/assignments/new')
const edit=computed(()=>Boolean(details.value)&&route.path.endsWith('/edit'))
const view=computed(()=>Boolean(details.value)&&!edit.value)
const allStates=['waiting','in_progress','submitted','needs_changes','completed'] as const
const labels=computed<Record<AssignmentStatus,string>>(()=>ru.value?{
  waiting:'Ожидает',in_progress:'В работе',submitted:'Отправлено',needs_changes:'Нужны исправления',completed:'Завершено',
}:{waiting:'Waiting',in_progress:'In progress',submitted:'Submitted',needs_changes:'Needs changes',completed:'Completed'})
const copy=computed(()=>ru.value?{
  title:'Задания',new:'Новое задание',search:'Поиск по названию',all:'Все статусы',
  empty:'Заданий пока нет',emptyFiltered:'Задания не найдены',emptyHelp:'Создайте первое приватное задание.',
  instructions:'Инструкции',required:'Название',mode:'Режим сохранения',retention:'Срок хранения (дни)',
  startsAt:'Дата начала',finishesAt:'Дата окончания',targetCount:'Нужно фотографий (1–9999)',
  progress:'Снимков на устройстве',archive:'В архив',restoreArchive:'Вернуть из архива',
  active:'Активные',archived:'Архив',allAssignments:'Все задания',sort:'Сортировка',
  sortUpdated:'Последнее изменение',sortCreated:'Дата создания',sortPhoto:'Последняя фотография',
  cameraInstructions:'Инструкция для камеры',requiredGps:'Обязательная геолокация',
  requireDescription:'Обязательное описание снимка',descriptionMinLength:'Минимум символов описания',
  requireTags:'Обязательные теги',allowedTags:'Разрешённые теги (через запятую)',
  enableNameId:'Присваивать NAME-ID',allowEditing:'Разрешить редактирование',
  keepOriginal:'Сохранять оригинал',allowDeletion:'Разрешить удаление',
  allowBrowsing:'Разрешить просмотр участникам (только после проверки прав)',
  capturePreset:'Название пресета камеры',advanced:'Дополнительные правила съёмки',
  mode1:'1 — Без сжатия (недоступен)',mode2:'2 — Сжатый оригинал сохраняется',
  mode3:'3 — Сжатый master заменяется',save:'Сохранить',cancel:'Отмена',
  edit:'Редактировать',duplicate:'Дублировать',remove:'Удалить',removeConfirm:'Удалить задание? Это необратимо.',
  status:'Статус',policy:'Политика съёмки',revision:'Ревизия',policyRevision:'Ревизия политики',
  noRetro:'Изменения политики действуют только для будущих снимков.',
  offline:'Локально — ожидает синхронизации',retry:'Повтор синхронизации',synced:'Синхронизировано',
  conflict:'Конфликт ревизий: локальные изменения сохранены зашифрованными.',
  refresh:'Обновить',sync:'Синхронизировать',loading:'Открываем приватные задания…',
  unlock:'Откройте анонимный аккаунт для работы с заданиями.',
  createAccount:'Создать аккаунт',restore:'Восстановить доступ',grants:'Участники',
  error:'Операцию не удалось выполнить. Изменения не подтверждены.',detail:'Детали задания',
  back:'К заданиям',recheck:'Загрузить версию сервера',keep:'Оставить мой локальный черновик',
  choose:'Сравните изменения перед повторной отправкой.',
  serverRev:'Текущая версия сервера',replace:'Принять версию сервера',retryDraft:'Повторить мои изменения',
  capture:'Снимать в задании',photos:'Фото задания',noPhotos:'Снимков на этом устройстве пока нет',review:'Проверка',nameInvalid:'Укажите название от 1 до 80 символов.',instructionsInvalid:'Инструкции — не более 4000 символов.',
}:{
  title:'Assignments',new:'New assignment',search:'Search titles',all:'All statuses',
  empty:'No assignments yet',emptyFiltered:'Nothing matches',emptyHelp:'Create your first private assignment.',
  instructions:'Instructions',required:'Title',mode:'Storage mode',retention:'Retention (days)',
  startsAt:'Start date',finishesAt:'End date',targetCount:'Required photos (1–9999)',
  progress:'Photos on this device',archive:'Archive',restoreArchive:'Restore from archive',
  active:'Active',archived:'Archive',allAssignments:'All assignments',sort:'Sort by',
  sortUpdated:'Last edited',sortCreated:'Created',sortPhoto:'Latest photo',
  cameraInstructions:'Camera instructions',requiredGps:'Require GPS',
  requireDescription:'Require photo description',descriptionMinLength:'Minimum description length',
  requireTags:'Require photo tags',allowedTags:'Allowed tags (comma-separated)',
  enableNameId:'Assign NAME-ID',allowEditing:'Allow editing',
  keepOriginal:'Preserve original',allowDeletion:'Allow deletion',
  allowBrowsing:'Allow participant browsing (only after permission review)',
  capturePreset:'Camera preset name',advanced:'Additional capture rules',
  mode1:'1 — Camera source (unavailable)',mode2:'2 — Compressed original preserved',
  mode3:'3 — Compressed master replaced',save:'Save',cancel:'Cancel',
  edit:'Edit',duplicate:'Duplicate',remove:'Delete',removeConfirm:'Delete assignment permanently?',
  status:'Status',policy:'Capture policy',revision:'Revision',policyRevision:'Policy revision',
  noRetro:'Policy changes affect future captures only.',
  offline:'Local — awaiting sync',retry:'Sync retry',synced:'Synced',
  conflict:'Revision conflict: your local draft remains encrypted.',
  refresh:'Refresh',sync:'Sync now',loading:'Opening private assignments…',
  unlock:'Unlock your anonymous account to manage assignments.',
  createAccount:'Create account',restore:'Restore access',grants:'Participants',
  error:'Could not perform operation. No server confirmation was claimed.',detail:'Assignment details',
  back:'Assignments',recheck:'Load server version',keep:'Keep my local draft',
  choose:'Compare both versions before retrying.',
  serverRev:'Current server revision',replace:'Accept server version',retryDraft:'Retry my changes',
  capture:'Capture in assignment',photos:'Assignment photos',noPhotos:'No local photos yet',review:'Review',nameInvalid:'Title must be 1–80 characters.',instructionsInvalid:'Instructions must not exceed 4000 characters.',
})
const filtered=computed(()=>rows.value.filter(a=>
  (visibilityFilter.value==='all'||(visibilityFilter.value==='archive')===Boolean(a.archived))&&
  (statusFilter.value==='all'||a.status===statusFilter.value)&&
  a.title.toLocaleLowerCase().includes(filter.value.toLocaleLowerCase()))
  .sort((a,b)=>{
    const first=sortBy.value==='created'?a.createdAt:
      sortBy.value==='latest_photo'?photoDates.value[a.id]:a.updatedAt
    const second=sortBy.value==='created'?b.createdAt:
      sortBy.value==='latest_photo'?photoDates.value[b.id]:b.updatedAt
    return String(second??'').localeCompare(String(first??''))||a.id.localeCompare(b.id)
  }))
const syncLabel=(value:AssignmentView)=>value.sync==='conflict'?copy.value.conflict:
  value.sync==='synced'?copy.value.synced:value.sync==='retry'?copy.value.retry:copy.value.offline
let epoch=0,ended=false,unlisten:()=>void=()=>{}
const cleanup=onIdentityCleanup(()=>{epoch++;rows.value=[];selected.value=null;serverVersion.value=null;
  photoDates.value={};error.value=''})
function hasIdentity(){return Boolean(identity.value)}
async function reload(){
  const token=++epoch,who=identity.value
  if(!who){rows.value=[];selected.value=null;assignmentPhotos.value=[];return}
  loading.value=true
  try{
    const vault=openAssignments()
    const current=await vault.list()
    if(ended||token!==epoch||identity.value?.accountId!==who.accountId||
       identity.value?.deviceId!==who.deviceId)return
    rows.value=current
    if(sortBy.value==='latest_photo')void loadPhotoDates(current,token,who.accountId)
    selected.value=details.value?current.find(x=>x.id===details.value)??null:null
    const photos=details.value?await listAssignmentPhotos(details.value):[]
    if(ended||token!==epoch||identity.value?.accountId!==who.accountId)return
    assignmentPhotos.value=photos.map(x=>({
      photoId:x.photoId,capturedAt:x.capture?.capturedAt??0,
    })).sort((a,b)=>b.capturedAt-a.capturedAt)
    if(edit.value&&selected.value)form.value={
      title:selected.value.title,instructions:selected.value.instructions,
      mode:selected.value.mode,retentionDays:selected.value.retentionDays,
      startsAt:selected.value.startsAt,finishesAt:selected.value.finishesAt,
      targetCount:selected.value.targetCount,archived:selected.value.archived,
      cameraInstructions:selected.value.cameraInstructions,requiredGps:selected.value.requiredGps,
      requireDescription:selected.value.requireDescription,descriptionMinLength:selected.value.descriptionMinLength,
      requireTags:selected.value.requireTags,allowedTags:selected.value.allowedTags,
      enableNameId:selected.value.enableNameId,allowEditing:selected.value.allowEditing,
      keepOriginal:selected.value.keepOriginal,allowDeletion:selected.value.allowDeletion,
      allowBrowsing:selected.value.allowBrowsing,capturePreset:selected.value.capturePreset}
  }catch(e){if(token===epoch)error.value=e instanceof Error?e.message:copy.value.error}
  finally{if(token===epoch)loading.value=false}
}
async function submit(){
  if(!identity.value||saving.value)return
  saving.value=true;error.value=''
  try{
    const input={...form.value,title:form.value.title.trim(),
      startsAt:form.value.startsAt||null,finishesAt:form.value.finishesAt||null,
      targetCount:String(form.value.targetCount??'')===''?null:Number(form.value.targetCount)}
    if(!input.title||input.title.length>80){error.value=copy.value.nameInvalid;return}
    if(input.instructions.length>4000){error.value=copy.value.instructionsInvalid;return}
    const service=openAssignments()
    const updated=edit.value&&details.value?await service.edit(details.value,input):await service.create(input)
    await router.push('/assignments/'+updated.id)
    await reload()
  }catch(e){error.value=e instanceof Error?e.message:copy.value.error}
  finally{saving.value=false}
}
async function toggleArchive(){
  if(!selected.value||saving.value)return
  saving.value=true;error.value=''
  try{await openAssignments().setArchived(selected.value.id,!selected.value.archived);await reload()}
  catch(e){error.value=e instanceof Error?e.message:copy.value.error}
  finally{saving.value=false}
}
async function loadPhotoDates(current:AssignmentView[],token:number,account:string){
  const dates:Record<string,number>={}
  // Lazy, on-demand photo sorting. Do not query every assignment during normal navigation.
  for(const item of current){
    if(token!==epoch||identity.value?.accountId!==account||sortBy.value!=='latest_photo')return
    try{const photos=await listAssignmentPhotos(item.id)
      dates[item.id]=Math.max(0,...photos.map(p=>p.capture?.capturedAt??0))}
    catch{/* unavailable local photo metadata sorts last */}
  }
  if(token===epoch&&identity.value?.accountId===account)photoDates.value=dates
}
watch(sortBy,value=>{if(value==='latest_photo'&&identity.value)
  void loadPhotoDates(rows.value,epoch,identity.value.accountId)})
async function act(next:AssignmentStatus){
  if(!selected.value||saving.value)return
  saving.value=true;error.value=''
  try{await openAssignments().transition(selected.value.id,next);await reload()}
  catch(e){error.value=e instanceof Error?e.message:copy.value.error}
  finally{saving.value=false}
}
async function duplicate(){
  if(!selected.value||saving.value)return
  saving.value=true
  try{const added=await openAssignments().duplicate(selected.value.id)
    await router.push('/assignments/'+added.id);await reload()}
  catch(e){error.value=e instanceof Error?e.message:copy.value.error}
  finally{saving.value=false}
}
async function remove(){
  if(!selected.value||!window.confirm(copy.value.removeConfirm))return
  saving.value=true
  try{await openAssignments().remove(selected.value.id)
    await router.push('/assignments');await reload()}
  catch(e){error.value=e instanceof Error?e.message:copy.value.error}
  finally{saving.value=false}
}
async function inspectConflict(){
  if(!selected.value)return
  try{serverVersion.value=await fetchServerAssignment(selected.value.id)
    serverRevision.value=serverVersion.value.revision}
  catch(e){error.value=e instanceof Error?e.message:copy.value.error}
}
async function acceptServer(){
  if(!selected.value||!serverVersion.value)return
  try{await openAssignments().resetToServer(selected.value.id,serverVersion.value)
    serverVersion.value=null;await reload()}
  catch(e){error.value=e instanceof Error?e.message:copy.value.error}
}
async function retryChanges(){
  if(!selected.value||!serverVersion.value)return
  try{await openAssignments().retryDraft(selected.value.id,serverVersion.value)
    serverVersion.value=null;await reload();void flushAssignments()}
  catch(e){error.value=e instanceof Error?e.message:copy.value.error}
}
function resetForm(){form.value={title:'',instructions:'',mode:3,retentionDays:45,
  startsAt:null,finishesAt:null,targetCount:null,cameraInstructions:'',requiredGps:false,
  requireDescription:false,descriptionMinLength:0,requireTags:false,allowedTags:[],
  enableNameId:true,allowEditing:true,keepOriginal:false,allowDeletion:true,
  allowBrowsing:false,capturePreset:null}}
watch(()=>route.fullPath,()=>{error.value='';serverVersion.value=null;if(create.value)resetForm();void reload()})
watch(identity,()=>{void reload()})
onMounted(()=>{ended=false;unlisten=onAssignmentChange(()=>{void reload()});void reload()})
onUnmounted(()=>{ended=true;epoch++;cleanup();unlisten()})
</script>
<template>
  <section class="assignments-real" data-testid="real-assignments">
    <header class="assignment-head">
      <div>
        <RouterLink v-if="details||create" to="/assignments" class="assignment-back">{{ copy.back }}</RouterLink>
        <h1>{{ create?copy.new:edit?copy.edit:view?copy.detail:copy.title }}</h1>
      </div>
      <RouterLink v-if="identity&&!create" to="/assignment-grants" class="subtle-button">{{ copy.grants }}</RouterLink>
      <RouterLink v-if="!details&&!create&&identity" to="/assignments/new" class="primary-button">{{ copy.new }}</RouterLink>
    </header>

    <div v-if="!hasIdentity()" class="assignment-empty" role="status">
      <p>{{ copy.unlock }}</p>
      <RouterLink to="/account/create">{{ copy.createAccount }}</RouterLink>
      <RouterLink to="/account/restore">{{ copy.restore }}</RouterLink>
    </div>

    <template v-else>
      <p v-if="loading" role="status" class="assignment-hint">{{ copy.loading }}</p>
      <form v-if="create||edit" class="assignment-form" @submit.prevent="submit">
        <label>{{ copy.required }}
          <input v-model="form.title" type="text" required maxlength="80" autocomplete="off">
        </label>
        <label>{{ copy.instructions }}
          <textarea v-model="form.instructions" rows="6" maxlength="4000"></textarea>
        </label>
        <fieldset>
          <legend>{{ copy.mode }}</legend>
          <label><input type="radio" name="assignment-mode" :value="1" disabled> {{ copy.mode1 }}</label>
          <label><input v-model.number="form.mode" type="radio" name="assignment-mode" :value="2"> {{ copy.mode2 }}</label>
          <label><input v-model.number="form.mode" type="radio" name="assignment-mode" :value="3"> {{ copy.mode3 }}</label>
        </fieldset>
        <label>{{ copy.retention }}
          <input v-model.number="form.retentionDays" type="number" min="1" max="45" step="1" required>
        </label>
        <label>{{ copy.startsAt }}
          <input v-model="form.startsAt" type="date">
        </label>
        <label>{{ copy.finishesAt }}
          <input v-model="form.finishesAt" type="date" :min="form.startsAt||undefined">
        </label>
        <label>{{ copy.targetCount }}
          <input v-model.number="form.targetCount" type="number" min="1" max="9999" step="1">
        </label>
        <fieldset class="assignment-policy-fields">
          <legend>{{ copy.advanced }}</legend>
          <label>{{ copy.cameraInstructions }}
            <textarea v-model="form.cameraInstructions" rows="3" maxlength="2000"></textarea>
          </label>
          <label>{{ copy.capturePreset }}
            <input v-model="form.capturePreset" type="text" maxlength="80">
          </label>
          <label class="assignment-toggle"><input v-model="form.requiredGps" type="checkbox"> {{ copy.requiredGps }}</label>
          <label class="assignment-toggle"><input v-model="form.enableNameId" type="checkbox"> {{ copy.enableNameId }}</label>
          <label class="assignment-toggle"><input v-model="form.requireDescription" type="checkbox"> {{ copy.requireDescription }}</label>
          <label>{{ copy.descriptionMinLength }}
            <input v-model.number="form.descriptionMinLength" type="number" min="0" max="2000" step="1">
          </label>
          <label class="assignment-toggle"><input v-model="form.requireTags" type="checkbox"> {{ copy.requireTags }}</label>
          <label>{{ copy.allowedTags }}
            <input :value="(form.allowedTags??[]).join(', ')" type="text" maxlength="1250"
              @input="form.allowedTags=($event.target as HTMLInputElement).value.split(',').map(s=>s.trim()).filter(Boolean)">
          </label>
          <label class="assignment-toggle"><input v-model="form.allowEditing" type="checkbox"> {{ copy.allowEditing }}</label>
          <label class="assignment-toggle"><input v-model="form.keepOriginal" type="checkbox"> {{ copy.keepOriginal }}</label>
          <label class="assignment-toggle"><input v-model="form.allowDeletion" type="checkbox"> {{ copy.allowDeletion }}</label>
          <label class="assignment-toggle"><input v-model="form.allowBrowsing" type="checkbox"> {{ copy.allowBrowsing }}</label>
        </fieldset>
        <p class="assignment-hint">{{ copy.noRetro }}</p>
        <div class="assignment-actions">
          <button class="primary-button" type="submit" :disabled="saving">{{ copy.save }}</button>
          <RouterLink :to="details?'/assignments/'+details:'/assignments'" class="subtle-button">{{ copy.cancel }}</RouterLink>
        </div>
      </form>

      <template v-else-if="view&&selected">
        <div class="assignment-detail">
          <h2>{{ selected.title }}</h2>
          <p class="assignment-text">{{ selected.instructions }}</p>
          <div class="assignment-meta">
            <span>{{ copy.status }}: {{ labels[selected.status] }}</span>
            <span>{{ copy.revision }}: {{ selected.revision }}</span>
            <span>{{ copy.policyRevision }}: {{ selected.policyRevision }}</span>
            <span>{{ copy.mode }}: {{ selected.mode }}</span>
            <span>{{ copy.retention }}: {{ selected.retentionDays }}</span>
            <span v-if="selected.startsAt">{{ copy.startsAt }}: {{ selected.startsAt }}</span>
            <span v-if="selected.finishesAt">{{ copy.finishesAt }}: {{ selected.finishesAt }}</span>
          </div>
          <p class="assignment-hint">{{ copy.noRetro }}</p>
          <section class="assignment-local-photos">
            <h3>{{ copy.photos }}</h3>
            <p v-if="selected.targetCount" class="assignment-hint">
              {{ copy.progress }}: {{ assignmentPhotos.length }} / {{ selected.targetCount }}
            </p>
            <progress v-if="selected.targetCount" class="assignment-progress"
              :value="Math.min(assignmentPhotos.length,selected.targetCount)" :max="selected.targetCount"></progress>
            <p v-if="!assignmentPhotos.length" class="assignment-hint">{{ copy.noPhotos }}</p>
            <ul v-else class="assignment-list">
              <li v-for="photo in assignmentPhotos" :key="photo.photoId">
                <RouterLink :to="'/photos/'+photo.photoId+'/review'" class="assignment-item">
                  {{ photo.photoId }} · {{ copy.review }}
                </RouterLink>
              </li>
            </ul>
          </section>
          <p :class="{ 'assignment-conflict':selected.sync==='conflict' }" role="status">{{ syncLabel(selected) }}</p>
          <div class="assignment-actions">
            <button type="button" :disabled="saving" @click="toggleArchive">
              {{ selected.archived?copy.restoreArchive:copy.archive }}
            </button>
            <RouterLink v-if="selected.status==='in_progress'&&selected.sync==='synced'"
              :to="{path:'/camera',query:{assignment:selected.id}}" class="primary-button">{{ copy.capture }}</RouterLink>
            <RouterLink :to="'/assignments/'+selected.id+'/edit'" class="subtle-button">{{ copy.edit }}</RouterLink>
            <button type="button" @click="duplicate" :disabled="saving">{{ copy.duplicate }}</button>
            <button type="button" @click="remove" :disabled="saving">{{ copy.remove }}</button>
          </div>
          <div class="assignment-actions">
            <button v-for="next in steps[selected.status]" :key="next" type="button" :disabled="saving"
              class="primary-button" @click="act(next)">{{ labels[next] }}</button>
          </div>
          <div v-if="selected.sync==='conflict'" class="assignment-conflict-panel">
            <p>{{ copy.choose }}</p>
            <button type="button" @click="inspectConflict">{{ copy.recheck }}</button>
            <p v-if="serverRevision!==null">{{ copy.serverRev }}: {{ serverRevision }}</p>
            <div v-if="serverVersion" class="assignment-actions">
              <button type="button" @click="acceptServer">{{ copy.replace }}</button>
              <button type="button" @click="retryChanges">{{ copy.retryDraft }}</button>
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="!details&&!create">
        <div class="assignment-toolbar">
          <input v-model="filter" type="search" :aria-label="copy.search" :placeholder="copy.search">
          <select v-model="visibilityFilter" :aria-label="copy.archived">
            <option value="active">{{ copy.active }}</option>
            <option value="archive">{{ copy.archived }}</option>
            <option value="all">{{ copy.allAssignments }}</option>
          </select>
          <select v-model="sortBy" :aria-label="copy.sort">
            <option value="updated">{{ copy.sortUpdated }}</option>
            <option value="created">{{ copy.sortCreated }}</option>
            <option value="latest_photo">{{ copy.sortPhoto }}</option>
          </select>
          <select v-model="statusFilter" :aria-label="copy.status">
            <option value="all">{{ copy.all }}</option>
            <option v-for="state in allStates" :key="state" :value="state">{{ labels[state] }}</option>
          </select>
          <button type="button" :disabled="saving||Boolean(identity?.offline)" @click="flushAssignments()">{{ copy.sync }}</button>
        </div>
        <div v-if="!filtered.length&&!loading" class="assignment-empty">
          <h2>{{ rows.length?copy.emptyFiltered:copy.empty }}</h2><p>{{ copy.emptyHelp }}</p>
        </div>
        <ul v-else class="assignment-list">
          <li v-for="item in filtered" :key="item.id">
            <RouterLink :to="'/assignments/'+item.id" class="assignment-item">
              <strong>{{ item.title }}</strong>
              <span>{{ labels[item.status] }} · {{ syncLabel(item) }}</span>
              <small v-if="item.archived">{{ copy.archived }}</small>
              <small>{{ copy.retention }}: {{ item.retentionDays }} · {{ copy.mode }}: {{ item.mode }}</small>
            </RouterLink>
          </li>
        </ul>
      </template>
      <p v-if="error" class="assignment-error" role="alert">{{ error }}</p>
    </template>
  </section>
</template>
<style scoped>
.assignments-real{max-width:950px;margin:auto;padding:18px 16px 120px;color:var(--text)}
.assignment-head{display:flex;justify-content:space-between;gap:18px;align-items:center;flex-wrap:wrap;margin-bottom:18px}
.assignment-head h1{font-size:24px;margin:5px 0}
.assignment-back{font-size:13px;color:var(--accent)}
.assignment-form,.assignment-detail{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px}
.assignment-form{display:flex;flex-direction:column;gap:18px}
.assignment-form label{display:flex;flex-direction:column;gap:7px;font-size:13px}
.assignment-form input:not([type=radio]),.assignment-form textarea,.assignment-toolbar input,.assignment-toolbar select{
  min-height:44px;box-sizing:border-box;width:100%;border:1px solid var(--border);
  background:var(--surface);color:var(--text);border-radius:9px;padding:10px;font:inherit}
.assignment-form textarea{resize:vertical}
.assignment-form fieldset{display:flex;flex-direction:column;gap:12px;border:1px solid var(--border);border-radius:9px;padding:14px}
.assignment-form fieldset label{display:block;line-height:1.5}
.assignment-form .assignment-policy-fields label{display:flex;flex-direction:column;gap:5px}
.assignment-form .assignment-policy-fields label.assignment-toggle{display:flex;flex-direction:row;align-items:center}
.assignment-toggle input{width:18px;height:18px;accent-color:var(--accent)}
.assignment-actions{display:flex;flex-wrap:wrap;gap:12px;margin:15px 0}
.assignment-actions button,.assignment-toolbar button{min-height:42px}
.assignment-hint,.assignment-meta,.assignment-item small{font-size:12px;color:var(--secondary)}
.assignment-meta{display:flex;gap:12px;flex-wrap:wrap}
.assignment-detail h2{font-size:21px;margin:0 0 12px;overflow-wrap:anywhere}
.assignment-text{white-space:pre-wrap;overflow-wrap:anywhere}
.assignment-progress{width:100%;height:9px;accent-color:var(--accent)}
.assignment-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:16px 0}
.assignment-toolbar input{flex:2;min-width:150px}
.assignment-toolbar select{flex:1;min-width:125px}
.assignment-list{display:flex;flex-direction:column;gap:10px;padding:0;list-style:none}
.assignment-item{display:flex;flex-direction:column;gap:7px;text-decoration:none;color:inherit;
  background:var(--surface);padding:16px;border:1px solid var(--border);border-radius:12px}
.assignment-item strong{font-size:15px;overflow-wrap:anywhere}
.assignment-item span{font-size:12px;color:var(--secondary)}
.assignment-empty{padding:35px 18px;border:1px solid var(--border);border-radius:14px;
  display:flex;gap:13px;flex-wrap:wrap;justify-content:center;text-align:center}
.assignment-empty p,.assignment-empty h2{width:100%;margin:0}
.assignment-error,.assignment-conflict{color:var(--danger,#c44141)}
.assignment-conflict-panel{border:1px solid var(--border);padding:14px;border-radius:12px}
@media(max-width:380px){.assignments-real{padding:12px 12px 110px}.assignment-form{padding:13px}}
</style>