import {identity,onIdentityCleanup} from '../../identity'
import type {LocationFix} from '../domain/metadata'
import {checkFix} from '../domain/metadata'
export type GpsStatus='idle'|'permission'|'ready'|'denied'|'unavailable'|'disabled'
const preferenceKey='photobunker.location.enabled.v1'
const savedPreference=()=>{try{return localStorage.getItem(preferenceKey)!=='false'}catch{return true}}
let epoch=0,watcher:number|undefined,scope='',latest:LocationFix|undefined
let enabled=savedPreference(),status:GpsStatus=enabled?'idle':'disabled'
const listeners=new Set<(value:GpsStatus)=>void>()
function update(value:GpsStatus){status=value;for(const listener of listeners)listener(value)}
function stop(){epoch++;if(watcher!==undefined)navigator.geolocation?.clearWatch(watcher);watcher=undefined;scope='';latest=undefined;update(enabled?'idle':'disabled')}
onIdentityCleanup(stop)
if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()})
if(typeof window!=='undefined')window.addEventListener('storage',event=>{
  if(event.key!==preferenceKey&&event.key!==null)return
  const allow=savedPreference()
  if(allow===enabled)return
  enabled=allow
  stop()
})
export function gpsStatus():GpsStatus{return status}
export function subscribeGps(listener:(value:GpsStatus)=>void):()=>void{
  listeners.add(listener);listener(status);return()=>listeners.delete(listener)
}
export function setGpsEnabled(allow:boolean):void{
  enabled=allow
  try{localStorage.setItem(preferenceKey,String(allow))}catch{/* runtime opt-out still applies */}
  stop()
}
function start(account:string,device:string,gesture:boolean):void{
  if(!enabled||document.hidden||!identity.value)return
  const active=account+':'+device
  if(scope===active&&watcher!==undefined)return
  stop();scope=active;const token=epoch
  const granted=()=>{if(token!==epoch||!enabled||scope!==active)return
    if(!navigator.geolocation){update('unavailable');return}
    watcher=navigator.geolocation.watchPosition(pos=>{
      if(token!==epoch||identity.value?.accountId!==account||identity.value?.deviceId!==device||document.hidden)return
      const {latitude,longitude,accuracy}=pos.coords,measuredAt=pos.timestamp
      try{
        const fix=checkFix({source:'gps',latitude,longitude,accuracy,measuredAt,status:'ready'})
        if(measuredAt>Date.now()+5000||Date.now()-measuredAt>60000||accuracy>100) return
        if(!latest||fix.accuracy<=latest.accuracy||measuredAt-latest.measuredAt>30000)latest=fix
        update('ready')
      }catch{/* no private coords persisted until encrypted metadata */ }
    },err=>{if(token!==epoch)return;update(err.code===1?'denied':'unavailable');latest=undefined},
    {enableHighAccuracy:true,maximumAge:10000,timeout:12000})
  }
  if(gesture){granted();return}
  update('permission')
  void navigator.permissions?.query({name:'geolocation'}).then(p=>{
    if(token!==epoch)return
    if(p.state==='granted')granted()
    else update(p.state==='denied'?'denied':'permission')
  }).catch(()=>{if(token===epoch)update('permission')})
}
export function startGrantedGps():void{const id=identity.value;if(id)start(id.accountId,id.deviceId,false)}
/** Must be called directly by user gesture; only this may open OS prompt. */
export function requestGps():void{const id=identity.value;if(id)start(id.accountId,id.deviceId,true)}
export function captureGps(capturedAt:number):LocationFix|undefined{
  if(!enabled||!latest||!identity.value||status!=='ready')return undefined
  if(latest.measuredAt>capturedAt+5000||capturedAt-latest.measuredAt>30000)return undefined
  return {...latest}
}
export function stopGps():void{stop()}
