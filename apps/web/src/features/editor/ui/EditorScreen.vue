<script setup lang="ts">
import {computed,nextTick,onMounted,onUnmounted,ref,shallowRef,watch} from 'vue'
import {onBeforeRouteLeave,useRoute,useRouter} from 'vue-router'
import {identity,onIdentityCleanup,registerDecryptedObjectUrl,revokeDecryptedObjectUrl} from '../../identity'
import {language} from '../../ui-preview'
import {openEditor,saveEditor,EditSession,normalizedPoint,updateText,renderEdits,emptyEdit} from '../index'
import type {EditorSource,EditDocument,Point,Tool} from '../index'

const route=useRoute(),router=useRouter()
const ru=computed(()=>language.value==='ru')
const id=computed(()=>String(route.params.photoId??''))
const canvas=ref<HTMLCanvasElement|null>(null),textArea=ref<HTMLTextAreaElement|null>(null)
const session=shallowRef<EditSession|null>(null),documentEdit=shallowRef<EditDocument>(emptyEdit())
const original=shallowRef<EditorSource|null>(null)
const status=ref(''),error=ref(''),loading=ref(false),saving=ref(false)
const tool=ref<Tool>('brush'),color=ref('#f04040'),width=ref(.012),opacity=ref(1),filled=ref(false)
const selectedText=ref(''),textDraft=ref(''),compare=ref(false),currentGesture=shallowRef<
  {id:number;start:Point;points:Point[];last:Point}|null>(null)
const docVersion=ref(0)
const image=new Image()
let src='',alive=true,epoch=0,frame=0
const dirty=computed(()=>{void docVersion.value;return session.value?.dirty??false})
const canUndo=computed(()=>{void docVersion.value;return session.value?.canUndo??false})
const canRedo=computed(()=>{void docVersion.value;return session.value?.canRedo??false})
const copy=computed(()=>ru.value?{
 title:'Редактор фотографии',back:'Назад',save:'Сохранить зашифрованно',
 undo:'Отменить',redo:'Повторить',compare:'Сравнить',
 brush:'Кисть',pencil:'Карандаш',eraser:'Ластик',text:'Текст',
 rectangle:'Прямоугольник',ellipse:'Эллипс',line:'Линия',redact:'Затемнить',
 color:'Цвет',width:'Толщина',opacity:'Непрозрачность',filled:'Заливка',
 brightness:'Яркость',contrast:'Контраст',saturation:'Насыщенность',
 textValue:'Текстовый слой',addText:'Добавить текст',cancel:'Отменить правки',
 loading:'Расшифровка изображения…',saving:'Шифрование новой версии…',
 saved:'Изменения сохранены в защищённом хранилище.',
 error:'Не удалось открыть редактор',expired:'Срок хранения фото не продлевается.',
 mode2:'Режим 2: исходное фото остаётся зашифрованным отдельно.',
 mode3:'Режим 3: старый master и миниатюра будут удалены после замены.',
 unsaved:'Есть несохранённые изменения. Покинуть редактор?',
 offline:'Сохранение локально; синхронизация позже.',
}:{
 title:'Photo editor',back:'Back',save:'Save encrypted rendition',
 undo:'Undo',redo:'Redo',compare:'Compare',
 brush:'Brush',pencil:'Pencil',eraser:'Eraser',text:'Text',
 rectangle:'Rectangle',ellipse:'Ellipse',line:'Line',redact:'Blackout',
 color:'Color',width:'Width',opacity:'Opacity',filled:'Fill',
 brightness:'Brightness',contrast:'Contrast',saturation:'Saturation',
 textValue:'Text layer',addText:'Add text',cancel:'Discard changes',
 loading:'Decrypting image…',saving:'Encrypting new rendition…',
 saved:'Changes saved to protected storage.',
 error:'Editor unavailable',expired:'Photo retention is never extended.',
 mode2:'Mode 2: compressed original remains separately encrypted.',
 mode3:'Mode 3: old master and thumbnail are deleted after replacement.',
 unsaved:'You have unsaved changes. Leave editor?',
 offline:'Saved locally; sync resumes later.',
})
const tools:['brush','pencil','eraser','text','rectangle','ellipse','line','redact']=[
 'brush','pencil','eraser','text','rectangle','ellipse','line','redact']
function clean(){
 epoch++;cancelAnimationFrame(frame)
 if(src){revokeDecryptedObjectUrl(src);src=''}
 image.removeAttribute('src')
 original.value=null;session.value=null;documentEdit.value=emptyEdit();currentGesture.value=null
 if(canvas.value){canvas.value.width=0;canvas.value.height=0}
}
const release=onIdentityCleanup(clean)
function touch():void{
 documentEdit.value=session.value?.current??emptyEdit()
 docVersion.value++
 schedule()
}
function mutate(fn:(doc:EditDocument)=>EditDocument){
 if(saving.value||!session.value)return
 session.value.change(fn);touch()
}
function undo(){session.value?.undo();touch()}
function redo(){session.value?.redo();touch()}
function discard(){session.value?.reset();touch()}
function sample(e:PointerEvent):Point{
 const rect=canvas.value?.getBoundingClientRect()
 if(!rect)throw Error('editor.no_surface')
 return normalizedPoint(e.clientX-rect.left,e.clientY-rect.top,rect.width,rect.height)
}
function addText(at:Point={x:.08,y:.12}){
 const layer={id:crypto.randomUUID(),text:'',at,color:color.value,size:.048}
 mutate(doc=>({...doc,texts:[...doc.texts,layer]}))
 selectedText.value=layer.id;textDraft.value=''
 void nextTick(()=>textArea.value?.focus())
}
function selectText(id:string){
 selectedText.value=id
 textDraft.value=documentEdit.value.texts.find(x=>x.id===id)?.text??''
 void nextTick(()=>textArea.value?.focus())
}
function commitText(){
 const id=selectedText.value
 if(id)mutate(doc=>updateText(doc,id,textDraft.value))
}
function pointerDown(event:PointerEvent){
 if(!original.value||saving.value||loading.value||compare.value||!canvas.value)return
 if(event.pointerType==='mouse'&&event.button!==0)return
 event.preventDefault()
 const p=sample(event)
 if(tool.value==='text'){addText(p);return}
 if(currentGesture.value)return
 canvas.value.setPointerCapture(event.pointerId)
 currentGesture.value={id:event.pointerId,start:p,last:p,points:[p]}
 schedule()
}
function pointerMove(event:PointerEvent){
 if(!currentGesture.value||currentGesture.value.id!==event.pointerId)return
 event.preventDefault()
 const p=sample(event),g=currentGesture.value
 if(tool.value==='brush'||tool.value==='pencil'||tool.value==='eraser'){
  if(g.points.length<3000)g.points.push(p)
 }else g.last=p
 currentGesture.value={...g};schedule()
}
function pointerUp(event:PointerEvent){
 const g=currentGesture.value
 if(!g||g.id!==event.pointerId)return
 event.preventDefault()
 const final=sample(event)
 if(g.points.length<3000)g.points.push(final)
 const active=tool.value
 if(active==='brush'||active==='pencil'||active==='eraser'){
  mutate(doc=>({...doc,strokes:[...doc.strokes,{
   id:crypto.randomUUID(),tool:active,points:g.points,width:width.value,
   color:color.value,opacity:opacity.value}]}))
 }else{
  mutate(doc=>({...doc,shapes:[...doc.shapes,{
   id:crypto.randomUUID(),kind:active as 'rectangle'|'ellipse'|'line'|'redact',
   from:g.start,to:final,color:color.value,width:width.value,filled:filled.value}]}))
 }
 if(canvas.value?.hasPointerCapture(event.pointerId))canvas.value.releasePointerCapture(event.pointerId)
 currentGesture.value=null;schedule()
}
function pointerCancel(event:PointerEvent){
 if(currentGesture.value?.id!==event.pointerId)return
 currentGesture.value=null;lastPointer=-1;schedule()
}
function schedule(){
 cancelAnimationFrame(frame)
 frame=requestAnimationFrame(paint)
}
function paint(){
 if(!canvas.value||!original.value||!image.naturalWidth||!image.naturalHeight)return
 try{
  const g=currentGesture.value,doc=documentEdit.value
  const live=g?(tool.value==='brush'||tool.value==='pencil'||tool.value==='eraser')
    ?{...doc,strokes:[...doc.strokes,{id:'gesture',tool:tool.value as 'brush'|'pencil'|'eraser',
      width:width.value,color:color.value,opacity:opacity.value,points:g.points}]}
    :{...doc,shapes:[...doc.shapes,{id:'gesture',kind:tool.value as 'rectangle'|'ellipse'|'line'|'redact',
      from:g.start,to:g.last,width:width.value,color:color.value,filled:filled.value}]}
    :doc
  const rendered=renderEdits(image,image.naturalWidth,image.naturalHeight,
    compare.value?emptyEdit():live,1200)
  const target=canvas.value
  if(target.width!==rendered.width)target.width=rendered.width
  if(target.height!==rendered.height)target.height=rendered.height
  target.getContext('2d')?.drawImage(rendered,0,0)
  rendered.width=rendered.height=0
 }catch(e){error.value=e instanceof Error?e.message:copy.value.error}
}
async function open(){
 clean()
 const ticket=++epoch,account=identity.value
 if(!account){error.value='editor.account_locked';return}
 loading.value=true;error.value=''
 try{
  const source=await openEditor(id.value)
  if(ticket!==epoch||!alive||identity.value?.accountId!==account.accountId)return
  src=URL.createObjectURL(source.photo);registerDecryptedObjectUrl(src)
  image.src=src;await image.decode()
  if(ticket!==epoch||!alive||identity.value?.accountId!==account.accountId)return
  original.value=source
  session.value=new EditSession();documentEdit.value=session.value.current
  schedule()
 }catch(e){if(ticket===epoch)error.value=e instanceof Error?e.message:copy.value.error}
 finally{if(ticket===epoch)loading.value=false}
}
async function save(){
 if(!session.value||!original.value||!dirty.value||saving.value)return
 const source=original.value
 saving.value=true;error.value='';status.value=copy.value.saving
 try{
  await saveEditor(source,image,image.naturalWidth,image.naturalHeight,session.value.current)
  if(identity.value?.accountId!==source.accountId||!alive)return
  status.value=identity.value.offline?copy.value.offline:copy.value.saved
  session.value.reset();touch()
  void router.replace('/photos/'+id.value)
 }catch(e){error.value=e instanceof Error?e.message:copy.value.error}
 finally{saving.value=false}
}
function guard(e:BeforeUnloadEvent){
 if(dirty.value&&!saving.value){e.preventDefault();e.returnValue=''}
}
onBeforeRouteLeave(()=>!dirty.value||saving.value||window.confirm(copy.value.unsaved))
function hidden(){if(document.hidden){currentGesture.value=null;schedule()}}
onMounted(()=>{alive=true;void open();window.addEventListener('beforeunload',guard)
 document.addEventListener('visibilitychange',hidden)})
onUnmounted(()=>{alive=false;clean();release();window.removeEventListener('beforeunload',guard)
 document.removeEventListener('visibilitychange',hidden)})
watch(id,()=>{void open()})
watch(identity,()=>{void open()})
watch(compare,schedule)
</script>

<template>
<section class="photo-editor" data-testid="photo-editor">
 <nav class="edit-top">
  <RouterLink :to="'/photos/'+id">{{ copy.back }}</RouterLink>
  <h1>{{ copy.title }}</h1>
  <button type="button" :disabled="!dirty||saving||loading" @click="save">
   {{ saving?copy.saving:copy.save }}
  </button>
 </nav>
 <p v-if="loading" role="status">{{ copy.loading }}</p>
 <p v-if="error" role="alert" class="edit-error">{{ error }}</p>
 <p v-if="status" role="status">{{ status }}</p>
 <template v-if="original">
  <div class="edit-stage">
   <canvas ref="canvas" role="img" :aria-label="copy.title"
    @pointerdown="pointerDown" @pointermove="pointerMove"
    @pointerup="pointerUp" @pointercancel="pointerCancel"
    @lostpointercapture="pointerCancel"></canvas>
  </div>
  <div class="edit-actions">
   <button :disabled="!canUndo||saving" @click="undo">{{ copy.undo }}</button>
   <button :disabled="!canRedo||saving" @click="redo">{{ copy.redo }}</button>
   <button :disabled="saving" @click="discard">{{ copy.cancel }}</button>
   <button :aria-pressed="compare" @click="compare=!compare">{{ copy.compare }}</button>
  </div>
  <div class="edit-tools" role="group" :aria-label="copy.title">
   <button v-for="name in tools" :key="name" type="button"
    :aria-pressed="tool===name" :disabled="saving"
    @click="tool=name">{{ copy[name] }}</button>
  </div>
  <div class="edit-options">
   <label>{{ copy.color }} <input v-model="color" type="color"></label>
   <label>{{ copy.width }} <input v-model.number="width" type="range" min=".002" max=".08" step=".002"></label>
   <label>{{ copy.opacity }} <input v-model.number="opacity" type="range" min=".1" max="1" step=".1"></label>
   <label><input v-model="filled" type="checkbox"> {{ copy.filled }}</label>
  </div>
  <div class="edit-options">
   <label v-for="setting in (['brightness','contrast','saturation'] as const)" :key="setting">
    {{ copy[setting] }}
    <input type="range" min="0" max="200" :value="documentEdit[setting]"
     @change="mutate(doc=>({...doc,[setting]:Number(($event.target as HTMLInputElement).value)}))">
   </label>
  </div>
  <div class="edit-text">
   <button type="button" @click="addText()">{{ copy.addText }}</button>
   <div v-for="layer in documentEdit.texts" :key="layer.id">
    <button type="button" @click="selectText(layer.id)">
     {{ layer.text||copy.textValue }} · {{ layer.id.slice(0,4) }}
    </button>
   </div>
   <label v-if="selectedText">{{ copy.textValue }}
    <textarea ref="textArea" v-model="textDraft" maxlength="300"
     rows="2" @change="commitText" @blur="commitText"></textarea>
   </label>
  </div>
  <p class="edit-hint">{{ original.mode===2?copy.mode2:copy.mode3 }} {{ copy.expired }}</p>
 </template>
</section>
</template>
<style scoped>
.photo-editor{max-width:1100px;margin:auto;padding:12px 12px 96px}
.edit-top{display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:space-between}
.edit-top h1{font-size:19px;margin:0}
.photo-editor button,.photo-editor a{min-height:44px;min-width:44px;padding:9px 12px}
.edit-stage{background:#101216;color:#fff;border-radius:15px;min-height:240px;
 display:grid;place-items:center;overflow:hidden;margin:12px 0}
.edit-stage canvas{max-width:100%;max-height:65dvh;touch-action:none;user-select:none}
.edit-actions,.edit-tools,.edit-options{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin:12px 0}
.edit-tools button[aria-pressed="true"],.edit-actions button[aria-pressed="true"]{
 outline:2px solid var(--accent,#6d83ef);outline-offset:-2px}
.edit-options label{display:flex;align-items:center;gap:8px;font-size:13px}
.edit-options input[type="range"]{width:110px}
.edit-text{display:flex;flex-direction:column;align-items:flex-start;gap:6px}
.edit-text label,.edit-text textarea{width:min(100%,600px)}
.edit-text textarea{font:inherit;padding:12px;min-height:60px}
.edit-error{color:var(--danger,#c44)}.edit-hint{font-size:13px;opacity:.8}
</style>
