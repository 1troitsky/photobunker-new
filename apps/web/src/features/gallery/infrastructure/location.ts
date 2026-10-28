import {identity,onIdentityCleanup} from '../../identity'
import type {LocationFix} from '../domain/metadata'
import {checkFix} from '../domain/metadata'
export type GpsStatus='idle'|'permission'|'ready'|'denied'|'unavailable'|'disabled'
let epoch=0,watcher:number|undefined,scope='',latest:LocationFix|undefined,enabled=true,status:GpsStatus='idle'
function stop(){epoch++;if(watcher!==undefined)navigator.geolocation?.clearWatch(watcher);watcher=undefined;scope='';latest=undefined;status=enabled?'idle':'disabled'}
onIdentityCleanup(stop)
if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()})
export function gpsStatus():GpsStatus{return status}
export function setGpsEnabled(allow:boolean):void{enabled=allow;if(!allow)stop()}
function start(account:string,device:string,gesture:boolean):void{
  if(!enabled||document.hidden||!identity.value)return
  const active=account+':'+device
  if(scope===active&&watcher!==undefined)return
  stop();scope=active;const token=epoch
  const granted=()=>{if(token!==epoch||!enabled||scope!==active)return
    if(!navigator.geolocation){status='unavailable';return}
    watcher=navigator.geolocation.watchPosition(pos=>{
      if(token!==epoch||identity.value?.accountId!==account||identity.value?.deviceId!==device||document.hidden)return
      const {latitude,longitude,accuracy}=pos.coords,measuredAt=pos.timestamp
      try{
        const fix=checkFix({source:'gps',latitude,longitude,accuracy,measuredAt,status:'ready'})
        if(measuredAt>Date.now()+5000||Date.now()-measuredAt>60000||accuracy>100) return
        if(!latest||fix.accuracy<=latest.accuracy||measuredAt-latest.measuredAt>30000)latest=fix
        status='ready'
      }catch{/* no private coords persisted until encrypted metadata */ }
    },err=>{if(token!==epoch)return;status=err.code===1?'denied':'unavailable';latest=undefined},
    {enableHighAccuracy:true,maximumAge:10000,timeout:12000})
  }
  if(gesture){granted();return}
  status='permission'
  void navigator.permissions?.query({name:'geolocation'}).then(p=>{
    if(token!==epoch)return
    if(p.state==='granted')granted()
    else status=p.state==='denied'?'denied':'permission'
  }).catch(()=>{if(token===epoch)status='permission'})
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
