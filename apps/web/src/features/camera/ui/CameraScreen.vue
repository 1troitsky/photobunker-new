<script setup lang="ts">
import {computed,nextTick,onMounted,onUnmounted,ref,shallowRef,watch} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {identity,onIdentityCleanup} from '../../identity'
import {language} from '../../ui-preview'
import {startGrantedGps} from '../../gallery'
import {openAssignments,onAssignmentChange,policySnapshot,type AssignmentView} from '../../assignments'
import {BrowserCamera,captureError,openCaptureSession,DEFAULT_TTL_DAYS} from '../index'
import type {CaptureMode,Facing,CaptureProgress,CaptureSession} from '../index'

const ru=computed(()=>language.value==='ru')
const video=ref<HTMLVideoElement|null>(null),frozen=ref<HTMLCanvasElement|null>(null)
const started=ref(false),starting=ref(false),processing=ref(false),grid=ref(false)
const facing=ref<Facing>('environment'),mode=ref<CaptureMode>(3),ttl=ref(DEFAULT_TTL_DAYS)
const status=ref(''),error=ref(''),savedId=ref(''),savedCount=ref(0),clock=ref('unknown')
const router=useRouter(),route=useRoute()
const assignmentId=ref(''),availableAssignments=ref<AssignmentView[]>([]),assignmentError=ref('')
let releaseAssignments:()=>void=()=>{}
const chosenAssignment=computed(()=>availableAssignments.value.find(x=>x.id===assignmentId.value))
watch(chosenAssignment,(next)=>{
  if(next){mode.value=next.mode;ttl.value=next.retentionDays}
})
const assignmentCopy=computed(()=>ru.value?{
  choose:'Задание',personal:'Личная съёмка',refresh:'Обновить задания',
  locked:'Съёмка по заданию доступна после серверного подтверждения статуса «В работе».',
  capture:'Съёмка по заданию',frozen:'Режим, TTL и ревизия задания фиксируются при съёмке.',
  invalid:'Нет разрешения или актуальной подтверждённой политики. Выберите задание снова.',
}:{
  choose:'Assignment',personal:'Personal capture',refresh:'Refresh assignments',
  locked:'Assignment capture requires a server-acknowledged In progress status.',
  capture:'Assignment capture',frozen:'Mode, TTL and assignment revisions freeze at capture.',
  invalid:'Assignment permission or current confirmed policy is missing. Choose again.',
})
async function refreshAssignments(){
  if(!identity.value){availableAssignments.value=[];assignmentId.value='';return}
  try{
    availableAssignments.value=(await openAssignments().list()).filter(x=>x.status==='in_progress'&&x.sync==='synced')
    const query=typeof route.query.assignment==='string'?route.query.assignment:''
    if(!assignmentId.value && query)assignmentId.value=query
  }catch{availableAssignments.value=[]}
}

let controller:BrowserCamera|null=null,mounted=false
const session=shallowRef<CaptureSession|null>(null)
const copy=computed(()=>ru.value?{
  start:'Включить камеру',flip:'Сменить камеру',stop:'Остановить камеру',shutter:'Снять фото',photos:'Фото',
  auth:'Сначала создайте или восстановите анонимный аккаунт.',create:'Создать аккаунт',restore:'Восстановить',
  policy:'Правила личной съёмки',mode1:'1 · Без дополнительного сжатия (пока недоступно)',
  mode2:'2 · Сжатый оригинал сохраняется',mode3:'3 · Сжатый master заменяется при редактировании',
  ttl:'Срок хранения, дней',clock:'Проверить время сервера',saving:'Шифрование и локальное сохранение…',
  compressing:'Обработка JPEG…',saved:'Сохранено зашифрованно на этом устройстве (не в облаке).',
  retry:'Повторить сохранение',retake:'Снять ещё',open:'Открыть снимок',notReady:'Камера выключена',
  confirm:'Фотографии не отправляются в системную галерею. Облачная синхронизация выполняется позже.',
  pending:'Не удалось сохранить: исходный кадр находится только в оперативной памяти. Повторите запись.',
  offline:'Без доверенного времени снимок не будет считаться сохранённым.',back:'К фотографиям',
  error:'Не удалось выполнить действие:',ready:'Камера готова',busy:'Обработка…',invalid:'Нужен новый снимок',
  label:'Камера PhotoBunker',retentionLabel:'Срок хранения в днях',
}:{
  start:'Enable camera',flip:'Switch camera',stop:'Stop camera',shutter:'Take photo',photos:'Photos',
  auth:'Create or recover an anonymous account before capturing.',create:'Create account',restore:'Recover',
  policy:'Personal capture policy',mode1:'1 · Uncompressed camera bytes (unavailable)',
  mode2:'2 · Preserve compressed original',mode3:'3 · Replace compressed master on edit',
  ttl:'Retention, days',clock:'Revalidate server time',saving:'Encrypting and saving locally…',
  compressing:'Compressing JPEG…',saved:'Encrypted on this device (not uploaded to cloud).',
  retry:'Retry local save',retake:'Take another photo',open:'Open photo',notReady:'Camera is off',
  confirm:'Photos are never saved to the system gallery. Cloud sync runs later.',
  pending:'Save failed. This captured frame exists only in memory. Retry the save.',
  offline:'Without trusted time, the photo cannot be marked saved.',back:'To photos',
  error:'Action failed:',ready:'Camera is ready',busy:'Processing…',invalid:'Retake a new photo',
  label:'PhotoBunker camera',retentionLabel:'Retention days',
})
const errorText=computed(()=>{
  const key=error.value
  const dictionary:Record<string,[string,string]>={
    'camera.permission_denied':['Доступ к камере запрещён в браузере. Разрешите и повторите.','Camera permission was denied. Change browser permission and retry.'],
    'camera.no_device':['Камера не обнаружена.','No camera device was found.'],
    'camera.device_busy':['Камера занята другим приложением.','Camera is in use by another app.'],
    'camera.insecure_or_unsupported':['Нужен HTTPS и доступная камера.','HTTPS and a supported camera are required.'],
    'camera.cancelled':['Съёмка отменена.','Camera request cancelled.'],
    'camera.untrusted_time_retry_capture':['Нет доверенного времени. Проверьте его и сделайте новый снимок.','Trusted time unavailable. Revalidate, then retake the photo.'],
    'camera.frame_stale':['Снимок устарел — сделайте новый.','Capture is stale — retake it.'],
    'storage.unavailable':['Нет защищённого хранилища. Проверьте настройки браузера и место.','Secure storage unavailable. Check browser settings and quota.'],
    'storage.quota_exceeded':['Недостаточно свободного пространства. Снимок не сохранён.','Storage quota exceeded. Photo not saved.'],
    'camera.frame_unavailable':['Нет доступного видеокадра. Повторите съёмку.','No valid video frame. Retry.'],
    'camera.decode_failed':['Не удалось прочитать кадр камеры.','Could not decode camera image.'],
    'camera.jpeg_encode_failed':['Ошибка JPEG-кодирования. Снимок не сохранён.','JPEG compression failed. Photo not saved.'],
    'camera.account_changed':['Аккаунт или устройство изменено. Действие отменено.','Account or device changed. Operation cancelled.'],
    'camera.canvas_unavailable':['Обработка изображения не поддерживается браузером.','Image processing is unavailable in this browser.'],
  }
  return dictionary[key]?.[ru.value?0:1]??(key?copy.value.error+' '+key:'')
})
function clearFreeze(){
  if(frozen.value){frozen.value.width=0;frozen.value.height=0}
}
function stop(){
  controller?.stop();started.value=false;starting.value=false;clearFreeze()
}
function dispose(){
  stop();session.value?.cancel();session.value=null
  processing.value=false;status.value='';error.value='';savedId.value='';savedCount.value=0;clock.value='unknown'
}
const release=onIdentityCleanup(()=>{dispose();availableAssignments.value=[];assignmentId.value=''})
function hidden(){if(document.hidden)dispose()}
function leaving(){dispose()}
onMounted(()=>{
  mounted=true
  startGrantedGps()
  releaseAssignments=onAssignmentChange(()=>{void refreshAssignments()})
  void refreshAssignments()
  if(video.value)controller=new BrowserCamera(video.value)
  if(identity.value)session.value=openCaptureSession()
  void prepareTime()
  document.addEventListener('visibilitychange',hidden)
  window.addEventListener('pagehide',leaving)
})
onUnmounted(()=>{
  mounted=false;dispose();controller=null;release();releaseAssignments()
  document.removeEventListener('visibilitychange',hidden)
  window.removeEventListener('pagehide',leaving)
})
watch(identity,async(next,previous)=>{
  if(next?.accountId!==previous?.accountId||next?.deviceId!==previous?.deviceId){
    dispose();assignmentId.value='';availableAssignments.value=[]
    if(next){
      await nextTick()
      if(!mounted||!identity.value||!video.value)return
      controller=new BrowserCamera(video.value)
      try{session.value=openCaptureSession();void prepareTime();void refreshAssignments()}catch{/* show identity state */}
    }
  }
})
async function prepareTime(){
  if(!session.value&&identity.value)session.value=openCaptureSession()
  if(!session.value)return
  const source=session.value
  await source.prepareTime()
  if(!mounted||session.value!==source)return
  clock.value=source.time.status().trusted?'trusted':'locked'
}
async function revalidate(){
  error.value=''
  if(!session.value&&identity.value)session.value=openCaptureSession()
  if(!session.value)return
  try{
    await session.value.time.refreshFromServer()
    clock.value=session.value.time.status().trusted?'trusted':'locked'
  }catch(e){clock.value='locked';error.value=captureError(e)}
}
async function start(){
  if(!identity.value||!controller||starting.value||processing.value)return
  error.value='';status.value='';starting.value=true
  try{
    if(!session.value)session.value=openCaptureSession()
    await controller.start(facing.value);started.value=true;void prepareTime()
  }
  catch(e){error.value=captureError(e);started.value=false}
  finally{starting.value=false}
}
async function flip(){
  if(!controller||processing.value)return
  facing.value=facing.value==='environment'?'user':'environment'
  stop();await start()
}
function freeze(){
  if(!video.value||!frozen.value||video.value.videoWidth===0)return
  const canvas=frozen.value
  canvas.width=video.value.videoWidth;canvas.height=video.value.videoHeight
  canvas.getContext('2d')?.drawImage(video.value,0,0,canvas.width,canvas.height)
}
function progress(value:CaptureProgress){
  if(value==='compressing')status.value=copy.value.compressing
  if(value==='encrypting')status.value=copy.value.saving
}
async function shutter(){
  if(!controller||!session.value||!started.value||processing.value||session.value.hasPending)return
  processing.value=true;error.value='';assignmentError.value='';savedId.value='';status.value=copy.value.compressing
  // Immediate in-memory shutter freeze; never persisted into a browser cache or file.
  freeze()
  try{
    // Read the fresh *durable* assignment projection, never an optimistic UI row.
    let frozen:ReturnType<typeof policySnapshot>|undefined
    if(assignmentId.value){
      const assignment=await openAssignments().get(assignmentId.value)
      if(assignment.status!=='in_progress'||assignment.sync!=='synced'){
        assignmentError.value=assignmentCopy.value.invalid
        throw Error('camera.assignment_not_authorized')
      }
      frozen=policySnapshot(assignment)
    }
    const source=await controller.take()
    const selectedMode=frozen?.mode??mode.value,selectedTtl=frozen?.retentionDays??ttl.value
    const record=await session.value.prepare(source.blob,source.method,selectedMode,selectedTtl,
      progress,frozen)
    savedId.value=record.photoId;savedCount.value++;status.value=copy.value.saved
    clock.value='trusted'
  }catch(e){error.value=captureError(e);status.value=''}
  finally{processing.value=false;clearFreeze()}
}
async function retry(){
  if(!session.value?.hasPending||processing.value)return
  processing.value=true;error.value=''
  try{
    const record=await session.value.retry(progress)
    savedId.value=record.photoId;savedCount.value++;status.value=copy.value.saved
  }catch(e){error.value=captureError(e);status.value=''}
  finally{processing.value=false;clearFreeze()}
}
function resetPending(){session.value?.cancel();session.value=identity.value?openCaptureSession():null;savedId.value='';status.value='';error.value=''}
const viewSaved=()=>savedId.value?router.push('/photos/'+savedId.value):undefined
</script>

<template>
  <section
    class="live-camera"
    data-testid="production-camera"
    :aria-label="copy.label"
  >
    <div
      v-if="!identity"
      class="capture-gate"
      role="status"
    >
      <h2>{{ copy.auth }}</h2>
      <RouterLink
        to="/account/create"
        class="primary-button"
      >{{ copy.create }}</RouterLink>
      <RouterLink
        to="/account/restore"
        class="subtle-button"
      >{{ copy.restore }}</RouterLink>
    </div>
    <template v-else>
      <div class="capture-policy">
        <label class="capture-retention">{{ assignmentCopy.choose }}
          <select v-model="assignmentId" :disabled="processing||!!session?.hasPending">
            <option value="">{{ assignmentCopy.personal }}</option>
            <option v-for="item in availableAssignments" :key="item.id" :value="item.id">
              {{ item.title }}
            </option>
          </select>
        </label>
        <p v-if="assignmentId" class="camera-hint">{{ chosenAssignment?
          assignmentCopy.frozen:assignmentCopy.locked }}</p>
        <p v-if="assignmentError" class="camera-feedback error" role="alert">{{ assignmentError }}</p>
        <h2>{{ chosenAssignment?assignmentCopy.capture:copy.policy }}</h2>
        <fieldset :disabled="processing||!!chosenAssignment">
          <legend class="sr-only">
            {{ copy.policy }}
          </legend>
          <label class="capture-mode disabled"><input
            type="radio"
            :checked="false"
            disabled
            name="capture-mode"
          ><span>{{ copy.mode1 }}</span></label>
          <label class="capture-mode"><input
            v-model.number="mode"
            type="radio"
            name="capture-mode"
            :value="2"
          ><span>{{ copy.mode2 }}</span></label>
          <label class="capture-mode"><input
            v-model.number="mode"
            type="radio"
            name="capture-mode"
            :value="3"
          ><span>{{ copy.mode3 }}</span></label>
          <label class="capture-retention">{{ copy.ttl }}
            <select
              v-model.number="ttl"
              :aria-label="copy.retentionLabel"
            >
              <option
                v-for="day in 45"
                :key="day"
                :value="day"
              >{{ day }}</option>
            </select>
          </label>
        </fieldset>
      </div>
      <div class="camera-preview real-camera-preview">
        <div class="camera-preview-top">
          <span class="status-pill">{{ started?copy.ready:copy.notReady }} · {{ clock==='trusted'?'UTC ✓':copy.offline }}</span>
          <button
            type="button"
            class="icon-button on-dark"
            :aria-label="ru?'Сетка':'Grid'"
            :aria-pressed="grid"
            @click="grid=!grid"
          >
            <span aria-hidden="true">#</span>
          </button>
        </div>
        <div class="camera-viewfinder real-viewfinder">
          <video
            ref="video"
            playsinline
            autoplay
            muted
            class="live-video"
            :hidden="!started"
          />
          <canvas
            ref="frozen"
            class="frozen-frame"
            :hidden="!processing"
            aria-hidden="true"
          />
          <div
            v-if="grid"
            class="viewfinder-grid"
            aria-hidden="true"
          />
          <div
            v-if="!started"
            class="camera-offline"
          >
            <h2>{{ copy.notReady }}</h2>
            <button
              type="button"
              class="primary-button"
              :disabled="starting"
              @click="start"
            >
              {{ starting?copy.busy:copy.start }}
            </button>
          </div>
          <span class="viewfinder-corner top-left" /><span class="viewfinder-corner top-right" />
          <span class="viewfinder-corner bottom-left" /><span class="viewfinder-corner bottom-right" />
        </div>
        <div class="camera-actions">
          <RouterLink
            to="/photos"
            class="camera-side-action"
          ><span aria-hidden="true">▧</span><small>{{ copy.photos }}</small></RouterLink>
          <button
            type="button"
            class="shutter-button"
            :disabled="!started || processing || !!session?.hasPending"
            :aria-label="copy.shutter"
            @click="shutter"
          >
            <span />
          </button>
          <button
            type="button"
            class="camera-side-action capture-flip"
            :disabled="processing || starting"
            :aria-label="copy.flip"
            @click="flip"
          >
            <span aria-hidden="true">⇄</span><small>{{ copy.flip }}</small>
          </button>
        </div>
        <div class="camera-secondary-actions">
          <button
            v-if="started"
            type="button"
            class="subtle-button"
            :disabled="processing"
            @click="stop"
          >
            {{ copy.stop }}
          </button>
          <button
            type="button"
            class="subtle-button"
            :disabled="processing"
            @click="revalidate"
          >
            {{ copy.clock }}
          </button>
        </div>
        <p class="camera-hint">
          {{ copy.confirm }}
        </p>
      </div>
      <div
        v-if="status"
        role="status"
        class="camera-feedback"
      >
        {{ status }} <span v-if="savedCount">({{ savedCount }})</span>
      </div>
      <div
        v-if="error"
        role="alert"
        class="camera-feedback error"
      >
        {{ errorText }}
      </div>
      <div
        v-if="session?.hasPending"
        class="camera-retry"
      >
        <p>{{ copy.pending }}</p>
        <button
          type="button"
          :disabled="processing"
          class="primary-button"
          @click="retry"
        >
          {{ copy.retry }}
        </button>
        <button
          type="button"
          :disabled="processing"
          class="subtle-button"
          @click="resetPending"
        >
          {{ copy.invalid }}
        </button>
      </div>
      <div
        v-if="savedId"
        class="camera-saved-actions"
      >
        <button
          type="button"
          class="primary-button"
          @click="viewSaved"
        >
          {{ copy.open }}
        </button>
      </div>
    </template>
  </section>
</template>
<style scoped>
.live-camera{max-width:790px;margin-inline:auto;display:grid;gap:14px}
.capture-gate{padding:28px 15px;display:flex;gap:13px;align-items:center;flex-wrap:wrap}
.capture-gate h2{width:100%;font-size:18px}
.capture-policy{padding:13px 16px;border:1px solid var(--border);border-radius:14px;background:var(--surface)}
.capture-policy h2{font-size:14px;margin:0 0 7px}
.capture-policy fieldset{border:0;padding:0;margin:0;display:grid;gap:3px}
.capture-mode{display:flex;align-items:center;gap:8px;padding:7px 0;min-height:44px;font-size:13px}
.capture-mode input{width:18px;height:18px;accent-color:var(--accent)}
.capture-mode.disabled{opacity:.45}
.capture-retention{font-size:13px;display:flex;align-items:center;gap:13px;min-height:45px}
.capture-retention select{margin-left:auto;padding:8px;color:var(--text);background:var(--panel);border:1px solid var(--border);border-radius:8px;min-width:72px}
.real-viewfinder{position:relative;overflow:hidden;min-height:300px;background:#0c0c0e;display:grid;place-items:center}
.live-video,.frozen-frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.live-video[hidden],.frozen-frame[hidden]{display:none}
.real-viewfinder .viewfinder-grid{position:absolute;inset:0;z-index:2}
.real-camera-preview .camera-preview-top{gap:8px}
.real-camera-preview .status-pill{font-size:11px;overflow-wrap:anywhere}
.camera-secondary-actions{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}
.camera-secondary-actions button,.capture-flip{min-height:44px}
.capture-flip{border:0;background:transparent}
.capture-flip span{font-size:26px}
.camera-feedback{padding:11px;border:1px solid var(--border);border-radius:9px;font-size:13px}
.camera-feedback.error{color:#dc6a66}
.camera-retry,.camera-saved-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.camera-retry p{width:100%;font-size:13px}
@media(max-width:420px){.real-viewfinder{min-height:260px}.live-camera{gap:9px}.capture-policy{padding:10px}}
</style>
