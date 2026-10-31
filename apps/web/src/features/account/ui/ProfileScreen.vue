<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import {useRouter} from 'vue-router'
import {identity,IdentityPanel,accountDeviceRecords,revokeDevice,logout,
  onIdentityCleanup,type AccountDeviceRecord} from '../../identity'
import {StorageDiagnostics} from '../../local-storage'
import {gpsStatus,subscribeGps,setGpsEnabled,requestGps} from '../../gallery'
import {language,setLanguage,setTheme,theme} from '../../ui-preview'
import {homeSection,setHomeSection,type HomeSection} from '../../ui-preview/application/home-preference'
const ru=computed(()=>language.value==='ru'),router=useRouter()
const devices=ref<AccountDeviceRecord[]>([]),loading=ref(false),busy=ref(false)
const error=ref(''),notice=ref(''),copied=ref(false)
const gps=ref(gpsStatus()),gpsAllowed=ref(gpsStatus()!=='disabled')
const selectedHome=ref<HomeSection>(homeSection())
function updateHome(value:string){
  const section=value as HomeSection
  if(setHomeSection(section))selectedHome.value=section
  else error.value=ru.value?'Не удалось сохранить выбор на этом устройстве':'Could not save preference on this device'
}
let releaseGps:()=>void=()=>{}
function toggleGps(){
  gpsAllowed.value=!gpsAllowed.value
  setGpsEnabled(gpsAllowed.value)
}

const copy=computed(()=>ru.value?{
  title:'Мой аккаунт',anonymous:'Анонимный аккаунт PB2',locked:'Аккаунт закрыт',
  create:'Создать аккаунт',recover:'Восстановить доступ',devices:'Доверенные устройства',
  device:'Устройство',current:'Это устройство',revoked:'Доступ отозван',revoke:'Отозвать',
  confirm:'Отозвать доступ этого устройства? Действие нельзя отменить.',
  refresh:'Обновить список',loading:'Проверяем устройства…',offline:'Нет сети — проверьте позднее',
  logout:'Выйти с этого устройства',outConfirm:'Выйти из анонимного аккаунта?',
  identifier:'Идентификатор аккаунта',copy:'Копировать ID',copied:'Скопировано',
  account:'Аккаунт',appearance:'Внешний вид',theme:'Тема',light:'Светлая',dark:'Тёмная',
  lang:'Язык',photos:'Мои фото',camera:'Камера',assignments:'Задания',contacts:'Контакты',
  teams:'Команды',storage:'Защищённое хранилище',security:'Ключи и устройства',
  dataSafety:'PIN и безопасность данных',
  error:'Операция не выполнена',noDevices:'Нет доступных данных об устройствах',
  noLegacy:'Единая Identity PB2. Старый аккаунт и Matrix не используются.',
  location:'Геолокация',locationHint:'Только после разрешения браузера и только пока приложение открыто.',
  gpsEnable:'Включить GPS',gpsDisable:'Отключить GPS',gpsPrompt:'Запросить разрешение',
  gpsReady:'Координаты получены',gpsDenied:'Доступ запрещён',gpsUnavailable:'GPS недоступен',
  gpsWaiting:'Ожидание разрешения',
  startup:'Стартовый экран',startupCamera:'Камера',startupAssignments:'Задания',
  startupBrowser:'Фото-браузер',startupPhotos:'Мои фото',
}:{
  title:'My account',anonymous:'Anonymous PB2 account',locked:'Account locked',
  create:'Create account',recover:'Recover access',devices:'Trusted devices',
  device:'Device',current:'This device',revoked:'Revoked',revoke:'Revoke',
  confirm:'Revoke this device? This cannot be undone.',
  refresh:'Refresh list',loading:'Checking devices…',offline:'Offline — check again later',
  logout:'Sign out on this device',outConfirm:'Sign out of this anonymous account?',
  identifier:'Account identifier',copy:'Copy ID',copied:'Copied',
  account:'Account',appearance:'Appearance',theme:'Theme',light:'Light',dark:'Dark',
  lang:'Language',photos:'My photos',camera:'Camera',assignments:'Assignments',contacts:'Contacts',
  teams:'Teams',storage:'Encrypted storage',security:'Keys and devices',
  dataSafety:'PIN and data safety',
  error:'Action failed',noDevices:'No device information available',
  noLegacy:'Single PB2 identity. No legacy account or Matrix runtime.',
  location:'Location',locationHint:'Only with browser permission and while the app is open.',
  gpsEnable:'Enable GPS',gpsDisable:'Disable GPS',gpsPrompt:'Request permission',
  gpsReady:'GPS fix ready',gpsDenied:'Permission denied',gpsUnavailable:'GPS unavailable',
  gpsWaiting:'Waiting for permission',
  startup:'Start screen',startupCamera:'Camera',startupAssignments:'Assignments',
  startupBrowser:'Photo Browser',startupPhotos:'My photos',
})
let epoch=0,stopped=false
const cleanup=onIdentityCleanup(()=>{epoch++;devices.value=[];error.value='';notice.value=''})
async function refresh(){
  const who=identity.value,ticket=++epoch
  if(!who||who.offline){devices.value=[];error.value=who?copy.value.offline:'';return}
  loading.value=true;error.value=''
  try{
    const result=await accountDeviceRecords()
    if(stopped||ticket!==epoch||identity.value?.accountId!==who.accountId||
      identity.value?.deviceId!==who.deviceId)return
    devices.value=result
  }catch(e){
    if(!stopped&&ticket===epoch)error.value=e instanceof Error?e.message:copy.value.error
  }finally{if(ticket===epoch)loading.value=false}
}
async function copyId(){
  const id=identity.value?.accountId
  if(!id)return
  try{await navigator.clipboard.writeText(id);copied.value=true}
  catch{error.value=copy.value.error}
}
async function revoke(id:string){
  if(busy.value||!window.confirm(copy.value.confirm))return
  busy.value=true;error.value=''
  try{
    await revokeDevice(id)
    if(!identity.value){devices.value=[];await router.replace('/welcome');return}
    await refresh()
  }catch(e){error.value=e instanceof Error?e.message:copy.value.error}
  finally{busy.value=false}
}
async function leave(){
  if(busy.value||!window.confirm(copy.value.outConfirm))return
  busy.value=true
  try{await logout();await router.replace('/welcome')}
  catch(e){error.value=e instanceof Error?e.message:copy.value.error}
  finally{busy.value=false}
}
onMounted(()=>{
  stopped=false
  releaseGps=subscribeGps(value=>{gps.value=value;gpsAllowed.value=value!=='disabled'})
  void refresh()
})
onUnmounted(()=>{stopped=true;epoch++;cleanup();releaseGps()})
watch(identity,()=>{devices.value=[];void refresh()})
</script>
<template>
  <section class="pb-profile">
    <header class="pb-profile-heading"><h1>{{copy.title}}</h1>
      <p>{{identity?copy.anonymous:copy.locked}}</p></header>
    <p v-if="error" role="alert">{{error}}</p><p v-if="notice" role="status">{{notice}}</p>
    <template v-if="!identity">
      <nav class="pb-profile-links">
        <RouterLink to="/account/create">{{copy.create}}</RouterLink>
        <RouterLink to="/account/restore">{{copy.recover}}</RouterLink>
      </nav>
    </template>
    <template v-else>
      <section class="pb-section">
        <h2>{{copy.identifier}}</h2>
        <div class="pb-account-id"><code>{{identity.accountId}}</code>
          <button type="button" @click="copyId">{{copied?copy.copied:copy.copy}}</button></div>
        <p class="pb-muted">{{copy.noLegacy}}</p>
      </section>
      <nav class="pb-profile-links">
        <RouterLink to="/camera">{{copy.camera}}</RouterLink>
        <RouterLink to="/photos">{{copy.photos}}</RouterLink>
        <RouterLink to="/assignments">{{copy.assignments}}</RouterLink>
        <RouterLink to="/contacts">{{copy.contacts}}</RouterLink>
        <RouterLink to="/teams">{{copy.teams}}</RouterLink>
      </nav>
      <section class="pb-section">
        <h2>{{copy.devices}}</h2>
        <button type="button" :disabled="busy||loading||identity.offline" @click="refresh">
          {{copy.refresh}}</button>
        <p v-if="loading" role="status">{{copy.loading}}</p>
        <p v-if="!loading&&!devices.length" class="pb-muted">{{copy.noDevices}}</p>
        <div v-for="device in devices" :key="device.id" class="pb-device">
          <div><strong>{{copy.device}} {{device.id.slice(0,8)}}</strong>
            <small v-if="device.id===identity.deviceId">{{copy.current}}</small>
            <small v-if="device.revokedAt">{{copy.revoked}}</small>
            <code>{{device.id}}</code></div>
          <button v-if="!device.revokedAt" type="button" :disabled="busy||identity.offline"
            @click="revoke(device.id)">{{copy.revoke}}</button>
        </div>
      </section>
      <section class="pb-section">
        <h2>{{copy.security}}</h2><IdentityPanel />
        <RouterLink to="/profile/data-safety">{{copy.dataSafety}}</RouterLink>
        <button type="button" :disabled="busy" @click="leave">{{copy.logout}}</button>
      </section>
    </template>
    <!-- Probing browser storage is safe before account registration. -->
    <section class="pb-section"><h2>{{copy.storage}}</h2><StorageDiagnostics /></section>
    <section class="pb-section">
      <h2>{{copy.location}}</h2>
      <p class="pb-muted">{{copy.locationHint}}</p>
      <div class="pb-profile-controls">
        <button type="button" :aria-pressed="gpsAllowed" @click="toggleGps">
          {{gpsAllowed?copy.gpsDisable:copy.gpsEnable}}
        </button>
        <button v-if="gpsAllowed&&identity&&gps==='permission'" type="button"
          @click="requestGps">{{copy.gpsPrompt}}</button>
      </div>
      <p v-if="gps==='ready'" role="status">{{copy.gpsReady}}</p>
      <p v-if="gps==='denied'" role="status">{{copy.gpsDenied}}</p>
      <p v-if="gps==='unavailable'" role="status">{{copy.gpsUnavailable}}</p>
      <p v-if="gps==='permission'" role="status">{{copy.gpsWaiting}}</p>
    </section>
    <section class="pb-section"><h2>{{copy.appearance}}</h2>
      <div class="pb-profile-controls">
        <label>{{copy.theme}}
          <select :value="theme" @change="setTheme(($event.target as HTMLSelectElement).value as 'dark'|'light')">
            <option value="light">{{copy.light}}</option><option value="dark">{{copy.dark}}</option>
          </select></label>
        <label>{{copy.lang}}
          <select :value="language" @change="setLanguage(($event.target as HTMLSelectElement).value as 'ru'|'en')">
            <option value="ru">RU</option><option value="en">EN</option>
          </select></label>
        <label>{{copy.startup}}
          <select :value="selectedHome" @change="updateHome(($event.target as HTMLSelectElement).value)">
            <option value="/camera">{{copy.startupCamera}}</option>
            <option value="/assignments">{{copy.startupAssignments}}</option>
            <option value="/browser">{{copy.startupBrowser}}</option>
            <option value="/photos">{{copy.startupPhotos}}</option>
          </select></label>
      </div>
    </section>
  </section>
</template>
<style scoped>
.pb-profile{max-width:830px;margin:0 auto;padding:18px 16px 130px;display:grid;grid-template-columns:minmax(0,1fr);gap:16px}
.pb-profile>*{min-width:0}
.pb-profile-heading h1{font-size:25px;margin:0 0 6px}
.pb-profile-heading p,.pb-muted{font-size:13px;color:var(--secondary);margin:4px 0}
.pb-section{padding:16px;background:var(--surface);border:1px solid var(--border);border-radius:14px;display:grid;gap:12px}
.pb-section h2{font-size:17px;margin:0}
.pb-profile-links{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.pb-profile-links a{padding:14px;text-decoration:none;border:1px solid var(--border);border-radius:11px;background:var(--surface)}
.pb-profile button,.pb-profile select{min-height:44px;padding:9px;border-radius:10px;border:1px solid var(--border);background:var(--panel);color:var(--text)}
.pb-account-id{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.pb-account-id code,.pb-device code{overflow-wrap:anywhere;font-size:11px;opacity:.8}
.pb-device{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px;border:1px solid var(--border);border-radius:10px}
.pb-device>div{display:grid;gap:4px;min-width:0}
.pb-device small{font-size:12px;color:var(--secondary)}
.pb-profile-controls{display:flex;gap:14px;flex-wrap:wrap}
.pb-profile-controls label{display:flex;align-items:center;gap:8px}
</style>
