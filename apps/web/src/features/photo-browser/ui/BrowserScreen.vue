<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import {useRouter} from 'vue-router'
import {identity,onIdentityCleanup} from '../../identity'
import {GalleryThumbnail} from '../../gallery'
import {onPhotoSync} from '../../photo-sync'
import {language,AppIcon} from '../../ui-preview'
import {loadLocalBrowser} from '../application/browse'
import {exportOwnerBrowserZip} from '../application/export-owner'
import {browserFolders,visibleBrowserPhotos,type BrowserPhoto,type BrowserAssignment,
  type BrowserDisplay,type BrowserSort} from '../domain/model'

const router=useRouter()
const photos=ref<BrowserPhoto[]>([]),assignments=ref<BrowserAssignment[]>([])
const activeFolder=ref('all'),search=ref(''),display=ref<BrowserDisplay>('grid')
const sort=ref<BrowserSort>('newest'),loading=ref(false),error=ref('')
const now=ref(Date.now())
const exporting=ref(false),exportDone=ref(0),exportError=ref(''),exportNotice=ref('')
let exportController:AbortController|null=null
let generation=0,stopped=false,stopSync:()=>void=()=>{},clock:number|undefined

const ru=computed(()=>language.value==='ru')
const txt=computed(()=>ru.value?{
  title:'Фото-браузер',subtitle:'Приватные фотографии этого устройства',
  note:'Локальный просмотр и экспорт своих текущих версий. Общие коллекции и доступ участников пока не подключены.',
  all:'Все фото',personal:'Личные',missing:'Недоступное задание',
  assignments:'Задания',search:'Название или NAME-ID',newest:'Новые',oldest:'Старые',name:'По имени',
  grid:'Сетка',list:'Список',refresh:'Обновить',loading:'Открываем защищённые данные…',
  locked:'Откройте анонимный аккаунт, чтобы просматривать фотографии.',
  empty:'Фотографий нет',emptyHint:'Снимите фото или выберите другую папку.',
  failure:'Не удалось открыть защищённый фото-браузер.',open:'Открыть фотографию',
  create:'Создать аккаунт',restore:'Восстановить',file:'Фотография',
  local:'На устройстве',synced:'Синхронизировано',retry:'Ожидает повтор',syncing:'Синхронизация',
  exportZip:'Сохранить ZIP',exportWarning:'ZIP с текущими изображениями будет сохранён в загрузки устройства. Приватные метаданные и EXIF не включаются.',
  exportLimit:'ZIP — не более 10 локальных фото за раз (до 16 МБ).',
  exportWorking:'Подготавливаем защищённый экспорт…',exportSent:'Запрошено скачивание ZIP.',exportFailed:'Экспорт прерван или недоступен.',
}:{
  title:'Photo Browser',subtitle:'Private photos on this device',
  note:'Local browsing and export of current owner renditions. Shared collections and recipient access are not yet enabled.',
  all:'All photos',personal:'Personal',missing:'Unavailable assignment',
  assignments:'Assignments',search:'Title or NAME-ID',newest:'Newest',oldest:'Oldest',name:'Name',
  grid:'Grid',list:'List',refresh:'Refresh',loading:'Opening encrypted data…',
  locked:'Unlock your anonymous account to browse photos.',
  empty:'No photos',emptyHint:'Capture a photo or choose another folder.',
  failure:'Could not open the protected photo browser.',open:'Open photo',
  create:'Create account',restore:'Restore access',file:'Photograph',
  local:'On device',synced:'Synced',retry:'Retry pending',syncing:'Syncing',
  exportZip:'Save ZIP',exportWarning:'The current images will be downloaded to this device. Private metadata and EXIF are excluded.',
  exportLimit:'Up to 10 local photos per ZIP (16 MB maximum).',
  exportWorking:'Preparing private export…',exportSent:'ZIP download requested.',exportFailed:'Export cancelled or unavailable.',
})
const validPhotos=computed(()=>photos.value.filter(p=>p.expiresAt>now.value))
const folders=computed(()=>browserFolders(assignments.value,validPhotos.value))
const visible=computed(()=>visibleBrowserPhotos(validPhotos.value,activeFolder.value,
  search.value,sort.value,now.value))
const folderTitle=computed(()=>{
  const f=folders.value.find(x=>x.id===activeFolder.value)
  return !f||f.kind==='all'?txt.value.all:f.kind==='personal'?txt.value.personal:
    f.kind==='missing'?txt.value.missing:f.title??txt.value.missing
})
function label(id:string,kind:string,title:string|null){
  return kind==='all'?txt.value.all:kind==='personal'?txt.value.personal:
    kind==='missing'?txt.value.missing:title||id
}
function date(ms:number){
  return new Intl.DateTimeFormat(ru.value?'ru-RU':'en-US',{dateStyle:'medium',timeStyle:'short'}).format(ms)
}
function stateLabel(state:BrowserPhoto['sync']){
  return state==='synced'?txt.value.synced:state==='syncing'?txt.value.syncing:
    state==='retry'?txt.value.retry:txt.value.local
}
function clear(){
  exportController?.abort();exportController=null
  exporting.value=false;exportError.value='';exportNotice.value='';exportDone.value=0
  generation++
  photos.value=[];assignments.value=[];loading.value=false;error.value=''
  activeFolder.value='all'
}
const release=onIdentityCleanup(clear)
async function refresh(){
  const token=++generation,active=identity.value
  if(!active){clear();return}
  loading.value=true;error.value=''
  try{
    const result=await loadLocalBrowser()
    if(stopped||generation!==token||identity.value?.accountId!==active.accountId||
       identity.value?.deviceId!==active.deviceId)return
    photos.value=result.photos;assignments.value=result.assignments;now.value=Date.now()
    if(!browserFolders(result.assignments,result.photos).some(f=>f.id===activeFolder.value))
      activeFolder.value='all'
  }catch{
    if(!stopped&&generation===token){photos.value=[];assignments.value=[];error.value=txt.value.failure}
  }finally{if(!stopped&&generation===token)loading.value=false}
}
async function openPhoto(id:string){
  // A route locator is never an authorization grant: LocalPhotoViewer
  // reopens scoped, encrypted vault material and enforces TTL independently.
  if(!identity.value)return
  await router.push('/photos/'+encodeURIComponent(id))
}

async function downloadZip(){
  if(exporting.value||visible.value.length<1||visible.value.length>10||!identity.value)return
  exportController?.abort()
  const controller=new AbortController(),active=identity.value
  exportController=controller
  exporting.value=true;exportError.value='';exportNotice.value='';exportDone.value=0
  try{
    // Explicit owner-only export, from the current encrypted PB2 vault.
    await exportOwnerBrowserZip([...visible.value],controller.signal,(done)=>{
      if(exportController===controller)exportDone.value=done
    })
    if(exportController===controller&&identity.value?.accountId===active.accountId&&
      identity.value?.deviceId===active.deviceId)
      exportNotice.value=txt.value.exportSent
  }catch(e){
    if(exportController===controller)
      exportError.value=e instanceof Error?e.message:txt.value.exportFailed
  }finally{
    if(exportController===controller){exportController=null;exporting.value=false}
  }
}

function wake(){if(!document.hidden)void refresh()}
onMounted(()=>{
  stopped=false
  stopSync=onPhotoSync(()=>{void refresh()})
  window.addEventListener('focus',wake)
  window.addEventListener('online',wake)
  clock=window.setInterval(()=>{now.value=Date.now()},15000)
  void refresh()
})
onUnmounted(()=>{
  stopped=true;clear();release();stopSync()
  window.removeEventListener('focus',wake);window.removeEventListener('online',wake)
  if(clock!==undefined)window.clearInterval(clock)
})
watch(()=>[identity.value?.accountId,identity.value?.deviceId],()=>{
  clear()
  if(identity.value)void refresh()
},{flush:'sync'})
</script>

<template>
  <section class="pb-browser" data-testid="native-photo-browser">
    <header class="pb-browser-header">
      <div><h2>{{ txt.title }}</h2><p>{{ txt.subtitle }}</p></div>
      <button type="button" class="subtle-button" :disabled="loading||!identity"
        @click="refresh">{{ txt.refresh }}</button>
    </header>
    <p class="pb-browser-note" role="note">{{ txt.note }}</p>
    <div v-if="!identity" class="pb-browser-empty">
      <p>{{ txt.locked }}</p>
      <RouterLink class="subtle-button" to="/account/create">{{ txt.create }}</RouterLink>
      <RouterLink class="subtle-button" to="/account/restore">{{ txt.restore }}</RouterLink>
    </div>
    <div v-else class="pb-browser-layout">
      <aside class="pb-browser-folders" :aria-label="txt.assignments">
        <button v-for="folder in folders" :key="folder.id" type="button"
          :aria-pressed="activeFolder===folder.id" :class="{selected:activeFolder===folder.id}"
          @click="activeFolder=folder.id">
          <AppIcon name="folder"/>
          <span>{{ label(folder.id,folder.kind,folder.title) }}</span><small>{{ folder.count }}</small>
        </button>
      </aside>
      <div class="pb-browser-content">
        <div class="pb-browser-tools">
          <strong>{{ folderTitle }}</strong>
          <label>
            <span class="sr-only">{{ txt.search }}</span>
            <input v-model="search" type="search" :placeholder="txt.search" :aria-label="txt.search">
          </label>
          <select v-model="sort" :aria-label="txt.newest">
            <option value="newest">{{ txt.newest }}</option>
            <option value="oldest">{{ txt.oldest }}</option>
            <option value="name">{{ txt.name }}</option>
          </select>
          <div class="pill-group">
            <button type="button" :class="{selected:display==='grid'}" :aria-pressed="display==='grid'"
              @click="display='grid'">{{ txt.grid }}</button>
            <button type="button" :class="{selected:display==='list'}" :aria-pressed="display==='list'"
              @click="display='list'">{{ txt.list }}</button>
          </div>
        </div>
        <div class="pb-browser-export">
          <button type="button" :disabled="exporting||loading||visible.length<1||visible.length>10"
            @click="downloadZip">{{ exporting?txt.exportWorking:txt.exportZip }}</button>
          <small>{{ txt.exportWarning }} {{ txt.exportLimit }}</small>
          <span v-if="exporting" role="status">{{ exportDone }} / {{ visible.length }}</span>
          <p v-if="exportError" role="alert">{{ exportError }}</p>
          <p v-if="exportNotice" role="status">{{ exportNotice }}</p>
        </div>
        <p v-if="error" role="alert">{{ error }}</p>
        <p v-else-if="loading" role="status">{{ txt.loading }}</p>
        <div v-else-if="visible.length===0" class="pb-browser-empty">
          <h3>{{ txt.empty }}</h3><p>{{ txt.emptyHint }}</p>
        </div>
        <div v-else :class="['pb-browser-photos',display]" role="list">
          <button v-for="photo in visible" :key="photo.id" role="listitem" type="button"
            :aria-label="txt.open+' '+(photo.nameId??photo.title??txt.file)"
            class="pb-browser-photo" @click="openPhoto(photo.id)">
            <span class="pb-browser-image"><GalleryThumbnail :photo-id="photo.id"
              :label="photo.title||photo.nameId||txt.file"/></span>
            <span class="pb-browser-caption">
              <strong>{{ photo.title||photo.nameId||txt.file }}</strong>
              <small>{{ photo.nameId||date(photo.capturedAt) }}</small>
              <small>{{ stateLabel(photo.sync) }}</small>
            </span>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.pb-browser{padding:24px;min-height:65svh}
.pb-browser-header{display:flex;align-items:center;justify-content:space-between;gap:16px}
.pb-browser-header h2{margin:0 0 4px;font-size:24px}
.pb-browser-header p{margin:0;color:var(--secondary);font-size:13px}
.pb-browser-note{margin:16px 0 24px;padding:11px 13px;border:1px solid var(--border);
  border-radius:12px;background:var(--surface);color:var(--secondary);font-size:12px}
.pb-browser-layout{display:grid;grid-template-columns:minmax(170px,230px) minmax(0,1fr);gap:24px}
.pb-browser-folders{display:flex;flex-direction:column;gap:4px;min-width:0}
.pb-browser-folders button{display:flex;align-items:center;gap:9px;min-height:44px;
  background:transparent;color:var(--text);border:0;border-radius:10px;
  padding:10px;text-align:left;width:100%;font-size:13px}
.pb-browser-folders button.selected{background:var(--panel)}
.pb-browser-folders span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.pb-browser-folders small{color:var(--muted);font-variant-numeric:tabular-nums}
.pb-browser-folders svg{width:17px;height:17px;color:var(--muted)}
.pb-browser-content{min-width:0}
.pb-browser-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:18px}
.pb-browser-tools strong{flex:1;min-width:100px;font-size:14px}
.pb-browser-tools label{flex:1 1 170px}
.pb-browser-tools input,.pb-browser-tools select{min-height:44px;background:var(--surface);
  border:1px solid var(--border);border-radius:10px;color:var(--text);padding:0 12px;max-width:100%;width:100%}
.pb-browser-tools select{width:auto}
.pb-browser-photos.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:14px}
.pb-browser-photos.list{display:flex;flex-direction:column;gap:8px}
.pb-browser-photo{text-align:left;display:flex;flex-direction:column;min-width:0;overflow:hidden;
  padding:0;border:1px solid var(--border);border-radius:12px;background:var(--surface);color:var(--text)}
.pb-browser-photo:hover{border-color:var(--accent)}
.pb-browser-image{display:block;width:100%;aspect-ratio:4/3;overflow:hidden}
.pb-browser-caption{display:flex;flex-direction:column;gap:3px;padding:12px;min-width:0;width:100%}
.pb-browser-caption strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
.pb-browser-caption small{color:var(--muted);font-size:11px}
.pb-browser-photos.list .pb-browser-photo{flex-direction:row;align-items:center}
.pb-browser-photos.list .pb-browser-image{width:90px;min-width:90px;aspect-ratio:4/3}
.pb-browser-empty{text-align:center;padding:48px 16px;color:var(--secondary)}
.pb-browser-empty h3{color:var(--text)}
@media(max-width:680px){
  .pb-browser{padding:16px}
  .pb-browser-layout{grid-template-columns:minmax(0,1fr)}
  .pb-browser-folders{flex-direction:row;overflow-x:auto;padding-bottom:7px}
  .pb-browser-folders button{flex:0 0 auto;width:auto;max-width:210px;border:1px solid var(--border)}
  .pb-browser-folders span{flex:0 1 auto}
  .pb-browser-photos.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
}
</style>
 
<style scoped>
.pb-browser-export{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
.pb-browser-export button{min-height:44px;padding:9px 15px;border:1px solid var(--border);
  border-radius:10px;color:var(--text);background:var(--surface)}
.pb-browser-export small{flex:1 1 250px;font-size:12px;color:var(--secondary)}
.pb-browser-export p{width:100%;margin:0;font-size:12px}
</style>
