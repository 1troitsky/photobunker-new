import { ref } from 'vue'
import { account,deviceId,invalidateLocalDeleteSession } from '../identity/store'
import { lockApp } from './lock'
import { hardLock } from '../crypto/store'
import { stopMessaging } from '../messages/store'
import { signFromLockedScreen } from './emergency'
import { readEmergencyCommand,commitEmergencyCommand,advanceEmergencyCommand,
  type EmergencyCommand } from './emergency-command'
import { purgeEmergencyDevice } from './emergency-wipe'
import { replayEmergencyPhases } from './emergency-phases'
import { beginEmergencyBarrier,resetEmergencyBarrierForNormalBootstrap } from './emergency-barrier'

/** The cover never discloses operation, local progress or server status. */
export const emergencyBlocked=ref(true)
export const emergencyChecked=ref(false)
const broadcast=typeof BroadcastChannel==='function'
  ? new BroadcastChannel('photobunker-emergency-stop-v1'):undefined
let replay:Promise<boolean>|undefined
let timer:ReturnType<typeof setTimeout>|undefined
let delay=5000
function stopPrivateAccess() {
  beginEmergencyBarrier()
  emergencyChecked.value=true
  emergencyBlocked.value=true
  lockApp()
  hardLock()
  stopMessaging()
}
function signedOut() {
  localStorage.setItem('pb-emergency-locked','true')
  localStorage.setItem('pb-local-delete-signed-out','true')
  localStorage.setItem('pb-signed-out','true')
  if(localStorage.getItem('pb-emergency-locked')!=='true' ||
    localStorage.getItem('pb-signed-out')!=='true')throw new Error('emergency.storage')
}
broadcast?.addEventListener('message',()=>{
  stopPrivateAccess()
  void resumeEmergency()
})
// BroadcastChannel is unavailable in some embedded WebViews: storage events
// also lock sibling tabs without disclosing the emergency operation.
if(typeof window!=='undefined')window.addEventListener('storage',e=>{
  if(e.key==='pb-emergency-locked'&&e.newValue==='true'){
    stopPrivateAccess()
    void resumeEmergency()
  }
})
function schedule() {
  if(timer!==undefined)clearTimeout(timer)
  timer=setTimeout(()=>{void resumeEmergency()},delay)
  delay=Math.min(60000,delay*2)
}
/** Cookie-independent R1-08A API; identityRequest and its account binding
 * must not be used after credentials are wiped.
 */
export async function sendEmergencyCommand(row:EmergencyCommand):Promise<'accepted'|'processing'|'completed'> {
  if(!navigator.onLine)throw new Error('emergency.offline')
  const controller=new AbortController()
  const timeout=setTimeout(()=>controller.abort(),15000)
  try{
    const response=await fetch('/api/v1/identity/emergency/intent',{
      method:'POST',credentials:'omit',cache:'no-store',redirect:'error',
      signal:controller.signal,
      headers:{'Content-Type':'application/json','Accept':'application/json','X-PhotoBunker':'identity-v1'},
      body:JSON.stringify({intent:row.intent,signature:row.signature}),
    })
    if(!response.ok)throw new Error('emergency.delivery')
    const data=await response.json() as {operationId?:string;state?:string}
    if(data.operationId!==row.operationId||
      !['accepted','processing','completed'].includes(data.state??''))
      throw new Error('emergency.delivery')
    return data.state as 'accepted'|'processing'|'completed'
  }finally{clearTimeout(timeout)}
}
async function phase(operationId:string,from:EmergencyCommand['phase'],to:EmergencyCommand['phase']) {
  return advanceEmergencyCommand(operationId,row=>{
    if(row.phase!==from)throw new Error('emergency.phase')
    return {...row,phase:to}
  })
}
/** Replays the immutable command without requiring Identity credentials.
 * Failure leaves the journal and neutral cover intact.
 */
async function progress() {
  const row=await readEmergencyCommand()
  if(!row)throw new Error('emergency.journal')
  const {wipeFailed}=await replayEmergencyPhases(row,{
    lock:stopPrivateAccess,
    signedOut,
    invalidate:invalidateLocalDeleteSession,
    advance:async(op,from,to)=>(await phase(op,from,to))!,
    purge:async(owner,device)=>purgeEmergencyDevice({owner,device}),
    deliver:sendEmergencyCommand,
    recordDelivery:async(operationId,outcome)=>{
      await advanceEmergencyCommand(operationId,current=>{
        const statuses=['queued','accepted','processing','completed']
        const latest=statuses.indexOf(current.delivery),next=statuses.indexOf(outcome)
        return {...current,delivery:next>latest?outcome:current.delivery}
      })
    },
    online:()=>navigator.onLine,
  })
  const final=await readEmergencyCommand()
  if(wipeFailed || final?.delivery!=='completed')schedule()
}
export function resumeEmergency():Promise<boolean> {
  if(replay)return replay
  replay=(async()=>{
    // Block the entire app until the signed journal has been inspected.
    try{
      const row=await readEmergencyCommand()
      if(!row){
        if(localStorage.getItem('pb-emergency-locked')==='true')
          throw new Error('emergency.missing_journal')
        resetEmergencyBarrierForNormalBootstrap()
        emergencyChecked.value=true
        emergencyBlocked.value=false
        return true
      }
      stopPrivateAccess()
      if(!navigator.locks?.request)throw new Error('emergency.no_locks')
      await navigator.locks.request('photobunker-emergency-replay-v1',async()=>{
        // Re-read after obtaining cross-tab exclusivity.
        if(await readEmergencyCommand())await progress()
      })
      return false
    }catch{
      // Never expose an unguarded private screen because IndexedDB or network
      // is unavailable. Online retry is possible without any user input.
      stopPrivateAccess()
      schedule()
      return false
    }finally{replay=undefined}
  })()
  return replay
}
/** Returns true ONLY after successful signature+durable commit. Ordinary
 * wrong app PIN must NEVER call this method (no destructive side effects).
 */
export async function tryEmergencyOnLockedScreen(pin:string):Promise<boolean> {
  if(!/^(?:\d{6}|\d{8})$/.test(pin) || !navigator.locks?.request)return false
  if(await readEmergencyCommand()){stopPrivateAccess();return true}
  const scope={owner:account.value?.id??'',device:deviceId.value}
  if(!scope.owner||!scope.device)return false
  try{
    return await navigator.locks.request('photobunker-emergency-commit-v1',async()=>{
      if(await readEmergencyCommand()){stopPrivateAccess();return true}
      return navigator.locks.request('photobunker-emergency:'+scope.owner+':'+scope.device,async()=>{
        if(await readEmergencyCommand()){stopPrivateAccess();return true}
        const operationId=crypto.randomUUID()
        const {signed,scope:checked}=await signFromLockedScreen(pin,operationId)
        if(scope.owner!==checked.owner||scope.device!==checked.device)
          throw new Error('emergency.scope')
        // Atomic first, destructive mutation SECOND. A blocked IndexedDB write
        // means no lock/wipe/remote deletion and an ordinary PIN failure UX.
        const command:EmergencyCommand={version:1,operationId,
          accountId:scope.owner,deviceId:scope.device,intent:signed.intent,
          signature:signed.signature,phase:'prepared',delivery:'queued',createdAt:Date.now()}
        await commitEmergencyCommand(command)
        stopPrivateAccess()
        broadcast?.postMessage('prepared')
        signedOut()
        void resumeEmergency()
        return true
      })
    })
  }catch{
    // Wrong PIN, cooldown or unavailable private signing key are deliberately
    // indistinguishable from the ordinary lock-screen error.
    if(await readEmergencyCommand().catch(()=>undefined)){
      stopPrivateAccess();void resumeEmergency();return true
    }
    return false
  }
}
if(typeof window!=='undefined') {
  window.addEventListener('online',()=>{if(emergencyBlocked.value)void resumeEmergency()})
  window.addEventListener('pageshow',()=>{if(emergencyBlocked.value)void resumeEmergency()})
}
