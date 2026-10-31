import {acquireStorageKeys,photoRequest} from '../../identity'
import {openLocalPhotoVault} from './vault'
import {db} from './database'
import type {NameLeaseRow} from './database'
function formatName(prefix:string,n:number):string{
  if(!/^[A-Z]{4}$/.test(prefix)||!Number.isInteger(n)||n<1||n>9999)throw Error('gallery.name_invalid')
  return prefix+String(n).padStart(4,'0')
}
type Range={id:string;prefix:string;first:number;last:number;next:number;assignmentId?:string|null}
const encoder=new TextEncoder(),decoder=new TextDecoder()
type LeaseBody={id:string;prefix:string;first:number;last:number;next:number;assignmentId?:string|null}
async function unpack(row:NameLeaseRow|undefined):Promise<Range|null>{
  if(!row||row.ciphertext.size===0)return null
  const keys=acquireStorageKeys()
  const secret=await keys.open(row.leaseId,'name-lease-v1',row.wrappedDEK)
  const iv=Uint8Array.from(atob(row.iv),x=>x.charCodeAt(0))
  const aad=encoder.encode(row.key)
  const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad},secret,await row.ciphertext.arrayBuffer())
  keys.check()
  const data=JSON.parse(decoder.decode(raw)) as LeaseBody
  if(!/^[A-Z]{4}$/.test(data.prefix)||!Number.isSafeInteger(data.next)||
    data.next<data.first||data.next>data.last+1)throw Error('gallery.lease_corrupt')
  if((data.assignmentId??null)!==(row.assignmentId??null))throw Error('gallery.lease_scope')
  return data
}
async function seal(row:LeaseBody,scope:{accountId:string;deviceId:string}):Promise<import('./database').NameLeaseRow>{
  const keys=acquireStorageKeys()
  const secret=await keys.create(row.id,'name-lease-v1')
  const iv=crypto.getRandomValues(new Uint8Array(12)),key=scope.accountId+'/'+scope.deviceId+'/'+row.id
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(key)},
    secret.key,encoder.encode(JSON.stringify(row)))
  keys.check()
  return{key,accountId:scope.accountId,deviceId:scope.deviceId,leaseId:row.id,
    assignmentId:row.assignmentId??null,
    iv:btoa(String.fromCharCode(...iv)),ciphertext:new Blob([ciphertext]),wrappedDEK:secret.wrapped}
}
function session(){const keys=acquireStorageKeys();return {scope:keys.scope,check:keys.check}}
async function lock<T>(scope:string,fn:()=>Promise<T>):Promise<T>{
  if(navigator.locks)return navigator.locks.request('pb-name-v1:'+scope,{mode:'exclusive'},fn)
  return fn() // IndexedDB CAS below prevents double issuance even without Web Locks.
}
export async function takeReservedName(assignmentId:string|null=null):Promise<{nameId:string;leaseId:string;number:number}|null>{
  const {scope,check}=session(),prefix=scope.accountId+'/'+scope.deviceId
  return lock(prefix,async()=>{
    for(let attempt=0;attempt<5;attempt++){
      const rows=await db.nameLeases.where('[accountId+deviceId]')
        .equals([scope.accountId,scope.deviceId]).toArray()
      for(const row of rows){
        check()
        const data=await unpack(row)
        if(!data||data.next>data.last||(data.assignmentId??null)!==assignmentId)continue
        const next=await seal({...data,next:data.next+1},scope)
        const taken=await db.transaction('rw',db.nameLeases,async()=>{
          const current=await db.nameLeases.get(row.key)
          if(!current||current.iv!==row.iv)return false
          await db.nameLeases.put(next);return true
        })
        if(!taken)break
        const code=formatName(data.prefix,data.next)
        return {nameId:code,leaseId:data.id,number:data.next}
      }
    }
    return null
  })
}
export async function reserveNameRange(assignmentId:string|null=null):Promise<void>{
  const {scope,check}=session(),prefix=scope.accountId+'/'+scope.deviceId
  await lock(prefix,async()=>{
    const rows=await db.nameLeases.where('[accountId+deviceId]')
      .equals([scope.accountId,scope.deviceId]).toArray()
    for(const row of rows){const data=await unpack(row);
      if(data&&(data.assignmentId??null)===assignmentId&&data.next<=data.last)return}
    const interrupted=rows.find(row=>row.ciphertext.size===0&&
      (row.assignmentId??null)===assignmentId)
    const requestId=interrupted?.leaseId??crypto.randomUUID()
    // Stable reservation UUID survives lost ACK and reload; never reserve a second range blindly.
    const key=prefix+'/'+requestId
    if(!interrupted)await db.nameLeases.add({key,accountId:scope.accountId,deviceId:scope.deviceId,leaseId:requestId,
      assignmentId,iv:'',ciphertext:new Blob([]),wrappedDEK:{iv:'',ciphertext:''}})
    const response=await photoRequest('/names/reserve','POST',JSON.stringify({requestId,count:32,assignmentId}))
    if(!response.ok)throw Error('gallery.name_reserve_'+response.status)
    const data=await response.json() as {id:string;prefix:string;first:number;last:number;assignmentId:string|null}
    check()
    if(data.assignmentId!==assignmentId)throw Error('gallery.lease_scope')
    const sealed=await seal({...data,next:data.first},scope)
    await db.nameLeases.delete(key)
    await db.nameLeases.put(sealed)
  })
}
export async function claimName(photoId:string,code:string|null,leaseId?:string,number?:number):Promise<string>{
  const response=await photoRequest('/names/claim','POST',JSON.stringify({
    photoId,leaseId:leaseId??null,number:number??null,
  }))
  if(!response.ok)throw Error('gallery.name_claim_'+response.status)
  const result=await response.json() as {photoId:string;nameId:string}
  if(result.photoId!==photoId||!/^[A-Z]{4}[0-9]{4}$/.test(result.nameId)||
    (code!==null&&result.nameId!==code))throw Error('gallery.name_conflict')
  await openLocalPhotoVault().setName(photoId,result.nameId,false)
  return result.nameId
}
