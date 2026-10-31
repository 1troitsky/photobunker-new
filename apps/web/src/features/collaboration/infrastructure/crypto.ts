import {acquireStorageKeys} from '../../identity'
import type {Sealed,TeamProfile} from '../domain/model'
const utf8=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true})
type Grant=ReturnType<typeof acquireStorageKeys>
export type KeyVault={accountId:string;teamId:string;wrap:{iv:string;ciphertext:string};sealed:Sealed}
export type EncryptedSnapshot={wrap:{iv:string;ciphertext:string};sealed:Sealed}
export function b64(b:Uint8Array):string {
  let binary='';for(const v of b)binary+=String.fromCharCode(v)
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
}
export function bytes(s:string):Uint8Array<ArrayBuffer>{
  if(!/^[A-Za-z0-9_-]+$/.test(s))throw Error('team.invalid_base64')
  const v=atob(s.replace(/-/g,'+').replace(/_/g,'/'))
  const out=Uint8Array.from(v,x=>x.charCodeAt(0))
  if(b64(out)!==s)throw Error('team.invalid_base64')
  return out
}
const buffer=(b:Uint8Array)=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer
const aad=(scope:string)=>utf8.encode('photobunker.team.v1|'+scope)
async function key(raw:Uint8Array):Promise<CryptoKey> {
  if(raw.length!==32)throw Error('team.invalid_key')
  return crypto.subtle.importKey('raw',buffer(raw),'AES-GCM',false,['encrypt','decrypt'])
}
async function encrypt(raw:Uint8Array,scope:string,data:Uint8Array):Promise<Sealed>{
  const iv=crypto.getRandomValues(new Uint8Array(12))
  const ciphertext=await crypto.subtle.encrypt({
    name:'AES-GCM',iv,additionalData:aad(scope),
  },await key(raw),buffer(data))
  return{v:1,iv:b64(iv),ciphertext:b64(new Uint8Array(ciphertext))}
}
async function decrypt(raw:Uint8Array,scope:string,blob:Sealed):Promise<Uint8Array>{
  if(blob.v!==1)throw Error('team.invalid_envelope')
  const result=await crypto.subtle.decrypt({
    name:'AES-GCM',iv:bytes(blob.iv),additionalData:aad(scope),
  },await key(raw),buffer(bytes(blob.ciphertext)))
  return new Uint8Array(result)
}
export async function profileSeal(teamId:string,revision:number,secret:Uint8Array,p:TeamProfile):Promise<Sealed> {
  return encrypt(secret,'profile|'+teamId+'|'+revision,utf8.encode(JSON.stringify(p)))
}
export async function profileOpen(teamId:string,revision:number,secret:Uint8Array,s:Sealed):Promise<TeamProfile>{
  const data=JSON.parse(dec.decode(await decrypt(secret,'profile|'+teamId+'|'+revision,s)))
  if(typeof data?.name!=='string'||typeof data.description!=='string'||
    (data.avatar!==null&&typeof data.avatar!=='string'))throw Error('team.invalid_profile')
  return data as TeamProfile
}
export async function wrapTeamKey(grant:Grant,teamId:string,secret:Uint8Array):Promise<KeyVault>{
  const {key:ownerKey,wrapped}=await grant.create(teamId,'team-secret-v1')
  const iv=crypto.getRandomValues(new Uint8Array(12))
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv,
    additionalData:aad('key|'+grant.scope.accountId+'|'+teamId)},ownerKey,buffer(secret))
  grant.check()
  return{accountId:grant.scope.accountId,teamId,wrap:wrapped,
    sealed:{v:1,iv:b64(iv),ciphertext:b64(new Uint8Array(ct))}}
}
export async function unwrapTeamKey(grant:Grant,row:KeyVault):Promise<Uint8Array> {
  if(row.accountId!==grant.scope.accountId)throw Error('team.cross_account')
  const k=await grant.open(row.teamId,'team-secret-v1',row.wrap)
  const secret=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(row.sealed.iv),
    additionalData:aad('key|'+row.accountId+'|'+row.teamId)},k,buffer(bytes(row.sealed.ciphertext))))
  grant.check()
  if(secret.length!==32)throw Error('team.invalid_key')
  return secret
}
export async function encryptSnapshot(grant:Grant,payload:unknown):Promise<EncryptedSnapshot>{
  const {key:k,wrapped}=await grant.create('contacts','team-snapshot-v1')
  const iv=crypto.getRandomValues(new Uint8Array(12))
  const body=await crypto.subtle.encrypt({name:'AES-GCM',iv,
    additionalData:aad('snapshot|'+grant.scope.accountId)},k,utf8.encode(JSON.stringify(payload)))
  grant.check()
  return{wrap:wrapped,sealed:{v:1,iv:b64(iv),ciphertext:b64(new Uint8Array(body))}}
}
export async function decryptSnapshot<T>(grant:Grant,row:EncryptedSnapshot):Promise<T>{
  const k=await grant.open('contacts','team-snapshot-v1',row.wrap)
  const body=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(row.sealed.iv),
    additionalData:aad('snapshot|'+grant.scope.accountId)},k,buffer(bytes(row.sealed.ciphertext)))
  grant.check()
  return JSON.parse(dec.decode(body)) as T
}
export async function inviteSeal(secret:Uint8Array,teamId:string,inviteId:string,targetId:string){
  const code=crypto.getRandomValues(new Uint8Array(32))
  const codeText=b64(code)
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',utf8.encode(codeText)))
  const codeHash=[...digest].map(x=>x.toString(16).padStart(2,'0')).join('')
  const salt=utf8.encode('photobunker/team-invite/salt/v1|'+teamId+'|'+inviteId)
  const base=await crypto.subtle.importKey('raw',buffer(code),'HKDF',false,['deriveKey'])
  const wrapper=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt,
    info:utf8.encode('photobunker/team-invite/key/v1')},base,{name:'AES-GCM',length:256},false,['encrypt'])
  const iv=crypto.getRandomValues(new Uint8Array(12))
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,
    additionalData:aad('invite|'+teamId+'|'+inviteId+'|'+targetId)},wrapper,buffer(secret))
  code.fill(0)
  return{code:codeText,codeHash,sealedKey:{v:1,iv:b64(iv),ciphertext:b64(new Uint8Array(cipher))} as Sealed}
}
export async function inviteOpen(codeText:string,teamId:string,inviteId:string,targetId:string,
  codeHash:string,sealed:Sealed):Promise<Uint8Array>{
  const code=bytes(codeText)
  if(code.length!==32)throw Error('team.invalid_invite')
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',utf8.encode(codeText)))
  if([...digest].map(x=>x.toString(16).padStart(2,'0')).join('')!==codeHash)
    throw Error('team.invalid_invite')
  const base=await crypto.subtle.importKey('raw',buffer(code),'HKDF',false,['deriveKey'])
  const wrapper=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',
    salt:utf8.encode('photobunker/team-invite/salt/v1|'+teamId+'|'+inviteId),
    info:utf8.encode('photobunker/team-invite/key/v1')},base,{name:'AES-GCM',length:256},false,['decrypt'])
  const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(sealed.iv),
    additionalData:aad('invite|'+teamId+'|'+inviteId+'|'+targetId)},
    wrapper,buffer(bytes(sealed.ciphertext)))
  code.fill(0)
  if(raw.byteLength!==32)throw Error('team.invalid_invite')
  return new Uint8Array(raw)
}
/** Decode the selected local avatar to pixels, strip EXIF and store only a small WebP. */
export async function prepareTeamAvatar(file:Blob):Promise<string>{
  if(file.size>5_000_000)throw Error('team.avatar_too_large')
  const bitmap=await createImageBitmap(file)
  try{
    const ratio=Math.min(1,160/Math.max(bitmap.width,bitmap.height))
    const canvas=document.createElement('canvas')
    canvas.width=Math.max(1,Math.round(bitmap.width*ratio))
    canvas.height=Math.max(1,Math.round(bitmap.height*ratio))
    const ctx=canvas.getContext('2d')
    if(!ctx)throw Error('team.avatar_unavailable')
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height)
    const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/webp',0.72))
    if(!blob||blob.size>12000||blob.type!=='image/webp')throw Error('team.avatar_too_large')
    return new Promise<string>((resolve,reject)=>{
      const reader=new FileReader()
      reader.onerror=()=>reject(Error('team.avatar_unavailable'))
      reader.onload=()=>resolve(String(reader.result))
      reader.readAsDataURL(blob)
    })
  }finally{bitmap.close()}
}
