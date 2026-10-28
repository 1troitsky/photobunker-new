import { acquireStorageKeys, fetchAuthenticatedServerTime } from '../../identity'
import type { Scope, TimeAuthority, TimeStatus } from '../domain/contracts'
import { db, clockKey } from './database'
import { liveTime, MAX_CLOCK_SKEW_MS, restoreClock } from '../domain/time-policy'

const enc=new TextEncoder()
const dec=new TextDecoder('utf-8',{fatal:true})
type ClockAnchor={version:1;serverUtc:number;lastObservedWallUtc:number;timeProofIssuedAt:number}
type Live={scope:Scope;nowBase:number;proofBase:number;monotonic:number;wall:number;
  source:'server'|'restored';locked:boolean}
let live:Live|null=null
const match=(a:Scope,b:Scope)=>a.accountId===b.accountId&&a.deviceId===b.deviceId&&a.generation===b.generation
function clockError(reason:TimeStatus['reason']):TimeStatus{return{trusted:false,now:null,reason}}
export function clearLiveTime(){live=null}
type StorageGrant=ReturnType<typeof acquireStorageKeys>
async function openSaved(scope:Scope,grant:StorageGrant):Promise<ClockAnchor|null>{
  const row=await db.clock.get(clockKey(scope))
  if(!row)return null
  grant.check()
  const key=await grant.open('clock:'+scope.accountId+':'+scope.deviceId,'clock-v1',row.wrappedDEK)
  const aad=enc.encode('photobunker/trusted-time/v1:'+scope.accountId+':'+scope.deviceId)
  try{
    const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:Uint8Array.from(atob(row.iv),c=>c.charCodeAt(0)),additionalData:aad},key,
      Uint8Array.from(atob(row.ciphertext),c=>c.charCodeAt(0)))
    grant.check()
    const obj=JSON.parse(dec.decode(clear)) as ClockAnchor
    if(Object.keys(obj).sort().join()!=='lastObservedWallUtc,serverUtc,timeProofIssuedAt,version' || obj.version!==1 ||
      ![obj.serverUtc,obj.lastObservedWallUtc,obj.timeProofIssuedAt].every(x=>Number.isSafeInteger(x)&&x>0) ||
      obj.serverUtc>obj.timeProofIssuedAt+MAX_CLOCK_SKEW_MS*2 ||
      obj.timeProofIssuedAt>obj.serverUtc+MAX_CLOCK_SKEW_MS*2)
      throw new Error('time.anchor_corrupt')
    return obj
  }catch{throw new Error('time.anchor_corrupt')}
}
async function save(scope:Scope,serverUtc:number,wall:number,grant:StorageGrant):Promise<void>{
  grant.check()
  const {key,wrapped}=await grant.create('clock:'+scope.accountId+':'+scope.deviceId,'clock-v1')
  const iv=crypto.getRandomValues(new Uint8Array(12))
  const aad=enc.encode('photobunker/trusted-time/v1:'+scope.accountId+':'+scope.deviceId)
  const text=enc.encode(JSON.stringify({version:1,serverUtc,lastObservedWallUtc:wall,timeProofIssuedAt:serverUtc}))
  const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,text))
  grant.check()
  // A record is ciphertext-only (wrapped AES DEK plus authenticated blob).
  await db.clock.put({key:clockKey(scope),accountId:scope.accountId,deviceId:scope.deviceId,
    iv:btoa(String.fromCharCode(...iv)),ciphertext:btoa(String.fromCharCode(...ciphertext)),wrappedDEK:wrapped})
  grant.check()
}
export class BrowserTimeAuthority implements TimeAuthority{
  private readonly grant:ReturnType<typeof acquireStorageKeys>
  constructor(grant=acquireStorageKeys()){this.grant=grant}
  private check():void{this.grant.check()}
  status():TimeStatus{
    this.check()
    if(!live || !match(live.scope,this.grant.scope))return clockError('reload')
    if(live.locked)return clockError('wall_jump')
    const checked=liveTime(live.nowBase,live.monotonic,live.wall,performance.now(),Date.now())
    if(!checked.trusted){
      live.locked=true;return clockError(checked.cause==='wall_jump'?'wall_jump':'monotonic_lost')
    }
    return{trusted:true,now:checked.now,reason:live.source==='server'?'fresh':'restored'}
  }
  now():number{
    const status=this.status()
    if(!status.trusted || status.now===null)throw new Error('time.untrusted_'+status.reason)
    return status.now
  }
  proveExpiry(expiresAt:number):boolean{
    if(!Number.isSafeInteger(expiresAt)||expiresAt<=0)throw new Error('time.invalid_expiry')
    const status=this.status()
    if(!status.trusted || !live)throw new Error('time.untrusted_'+status.reason)
    // On reload, a small wall delta may restore non-destructive display time,
    // but only the saved server floor plus new monotonic elapsed can delete.
    return Math.floor(live.proofBase+performance.now()-live.monotonic)>=expiresAt
  }
  async restoreFromStorage():Promise<TimeStatus>{
    this.check()
    if(live&&match(live.scope,this.grant.scope))return this.status()
    let saved:ClockAnchor|null
    try{saved=await openSaved(this.grant.scope,this.grant)}catch{
      this.check();return clockError('corrupt')
    }
    this.check()
    if(!saved)return clockError('missing')
    const wall=Date.now(),restored=restoreClock(saved.serverUtc,saved.lastObservedWallUtc,wall)
    if(!restored.trusted)return clockError('wall_jump')
    const monotonic=performance.now()
    live={scope:this.grant.scope,nowBase:restored.nowBase,proofBase:restored.proofBase,
      wall,monotonic,source:'restored',locked:false}
    return this.status()
  }
  async refreshFromServer():Promise<TimeStatus>{
    this.check()
    let prior:ClockAnchor|null=null
    try{prior=await openSaved(this.grant.scope,this.grant)}catch{
      // Corruption is fail-closed until a fresh *authenticated* server proof arrives.
      live=null
    }
    const fetched=await fetchAuthenticatedServerTime()
    this.check()
    if(prior && fetched<prior.serverUtc-MAX_CLOCK_SKEW_MS)return clockError('corrupt')
    // A new authenticated server proof establishes a new monotonic live window.
    const authoritativeFloor=Math.max(fetched,prior?.serverUtc??0)
    const wall=Date.now(),monotonic=performance.now()
    await save(this.grant.scope,authoritativeFloor,wall,this.grant)
    this.check()
    live={scope:this.grant.scope,nowBase:authoritativeFloor,proofBase:authoritativeFloor,
      wall,monotonic,source:'server',locked:false}
    return this.status()
  }
}
