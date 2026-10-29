import {acquireStorageKeys} from '../../identity'
import type {GrantInvitationContext} from './key-envelope'
type StorageGrant=ReturnType<typeof acquireStorageKeys>
export type SealedLocalSecret=Readonly<{
  v:1;iv:string;ciphertext:string;wrap:{iv:string;ciphertext:string}
}>
const utf8=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true})
function b64(bytes:Uint8Array){
  let v='';for(const b of bytes)v+=String.fromCharCode(b)
  return btoa(v).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
}
function bytes(value:string):Uint8Array<ArrayBuffer>{
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value)||value.length>512)
    throw Error('grant.secret_invalid')
  const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/'))
  const data=Uint8Array.from(raw,c=>c.charCodeAt(0))
  if(b64(data)!==value)throw Error('grant.secret_invalid')
  return data
}
function aad(account:string,device:string,c:GrantInvitationContext):Uint8Array<ArrayBuffer>{
  return utf8.encode('photobunker/local-grant-secret/v1|'+JSON.stringify({
    accountId:account,deviceId:device,grantId:c.grantId,assignmentId:c.assignmentId,
    ownerAccountId:c.ownerAccountId,recipientAccountId:c.recipientAccountId,
  }))
}
/** Ciphertext and AKEK-wrapped DEK only: never store grantSecret or invitation code in IndexedDB. */
export async function sealLocalGrantSecret(g:StorageGrant,c:GrantInvitationContext,secret:string):
  Promise<SealedLocalSecret>{
  const checked=bytes(secret)
  if(checked.byteLength!==32){checked.fill(0);throw Error('grant.secret_invalid')}
  checked.fill(0)
  g.check()
  const {key,wrapped}=await g.create(c.grantId,'grant-secret-v1')
  const iv=crypto.getRandomValues(new Uint8Array(12))
  const plaintext=utf8.encode(secret)
  try{
    const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,
      additionalData:aad(g.scope.accountId,g.scope.deviceId,c)},key,plaintext)
    g.check()
    return {v:1,iv:b64(iv),ciphertext:b64(new Uint8Array(encrypted)),wrap:wrapped}
  }finally{plaintext.fill(0)}
}
export async function openLocalGrantSecret(g:StorageGrant,c:GrantInvitationContext,
  e:SealedLocalSecret):Promise<string>{
  g.check()
  if(e.v!==1)throw Error('grant.secret_invalid')
  const key=await g.open(c.grantId,'grant-secret-v1',e.wrap)
  const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(e.iv),
    additionalData:aad(g.scope.accountId,g.scope.deviceId,c)},key,bytes(e.ciphertext))
  g.check()
  const plaintext=new Uint8Array(raw)
  try{
    const output=decoder.decode(plaintext)
    if(bytes(output).length!==32)throw Error('grant.secret_invalid')
    return output
  }finally{plaintext.fill(0)}
}
