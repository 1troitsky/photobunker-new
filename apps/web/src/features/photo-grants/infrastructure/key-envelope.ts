/** Scoped recipient DEK envelope. This does not authorize photo reads. */
const utf8=new TextEncoder()
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
export type AssetKind='master'|'original'|'edit'|'thumbnail'|'metadata'
export type KeyContext=Readonly<{
  grantId:string;generation:number;assignmentId:string;ownerAccountId:string;
  recipientAccountId:string;photoId:string;assetId:string;kind:AssetKind;
  revision:number;expiresAt:number;cipherDigest:string
}>
export type RecipientKeyEnvelope=Readonly<{v:1;context:KeyContext;iv:string;ciphertext:string}>
const fields=['grantId','generation','assignmentId','ownerAccountId','recipientAccountId',
  'photoId','assetId','kind','revision','expiresAt','cipherDigest']
function fail(value:unknown):asserts value {
  if(!value)throw Error('photo_grant.invalid_envelope')
}
function b64(b:Uint8Array):string{
  let s='';for(const x of b)s+=String.fromCharCode(x)
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'')
}
function decode(s:string,len:number):Uint8Array<ArrayBuffer>{
  fail(typeof s==='string'&&/^[A-Za-z0-9_-]+$/.test(s)&&s.length<256)
  let raw:string
  try{raw=atob(s.replace(/-/g,'+').replace(/_/g,'/'))}
  catch{throw Error('photo_grant.invalid_envelope')}
  const out=Uint8Array.from(raw,x=>x.charCodeAt(0))
  fail(out.length===len&&b64(out)===s)
  return out
}
function aad(c:KeyContext):Uint8Array<ArrayBuffer>{
  fail(c&&typeof c==='object'&&!Array.isArray(c)&&Object.keys(c).join('|')===fields.join('|'))
  for(const id of [c.grantId,c.assignmentId,c.ownerAccountId,c.recipientAccountId,c.photoId,c.assetId])
    fail(typeof id==='string'&&UUID.test(id))
  fail(c.ownerAccountId!==c.recipientAccountId)
  fail(Number.isSafeInteger(c.generation)&&c.generation>=1&&c.generation<100000000)
  fail(Number.isSafeInteger(c.revision)&&c.revision>=1&&c.revision<100000000)
  fail(Number.isSafeInteger(c.expiresAt)&&c.expiresAt>0)
  fail(['master','original','edit','thumbnail','metadata'].includes(c.kind))
  fail(typeof c.cipherDigest==='string'&&/^[a-f0-9]{64}$/.test(c.cipherDigest))
  return utf8.encode('photobunker.photo-recipient.v1\n'+JSON.stringify(c))
}
async function transport(code:Uint8Array<ArrayBuffer>,id:string):Promise<CryptoKey>{
  const material=await crypto.subtle.importKey('raw',code,'HKDF',false,['deriveKey'])
  return crypto.subtle.deriveKey({
    name:'HKDF',hash:'SHA-256',salt:utf8.encode('photobunker/photo-grant/v1|'+id),
    info:utf8.encode('photobunker/photo-grant/dek/v1'),
  },material,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])
}
/** Display once through a private out-of-band channel, never in a URL or log. */
export function createPhotoGrantCode():string {
  return b64(crypto.getRandomValues(new Uint8Array(32)))
}
export async function photoGrantCodeHash(code:string):Promise<string>{
  const secret=decode(code,32)
  try{
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',secret))
    return [...digest].map(x=>x.toString(16).padStart(2,'0')).join('')
  }finally{secret.fill(0)}
}
export async function sealRecipientKey(code:string,context:KeyContext,rawDEK:Uint8Array):
  Promise<RecipientKeyEnvelope>{
  const associated=aad(context)
  fail(rawDEK instanceof Uint8Array&&rawDEK.length===32)
  const secret=decode(code,32)
  try{
    const key=await transport(secret,context.grantId)
    const iv=crypto.getRandomValues(new Uint8Array(12))
    const ciphertext=new Uint8Array(await crypto.subtle.encrypt({
      name:'AES-GCM',iv,additionalData:associated,tagLength:128,
    },key,new Uint8Array(rawDEK)))
    return {v:1,context,iv:b64(iv),ciphertext:b64(ciphertext)}
  }finally{secret.fill(0)}
}
/** Encrypt a fresh per-grant transport secret using ONLY the out-of-band invitation code.
 * The server receives this sealed blob and hash(code), never the secret or code.
 * Recipient must decrypt and persist the secret in its own encrypted scoped vault
 * before explicitly accepting the invitation.
 */
export type GrantInvitationContext=Readonly<{
  grantId:string;assignmentId:string;ownerAccountId:string;recipientAccountId:string
}>
export type SealedGrantSecret=Readonly<{v:1;iv:string;ciphertext:string}>
function inviteAad(c:GrantInvitationContext):Uint8Array<ArrayBuffer>{
  fail(c&&typeof c==='object'&&!Array.isArray(c))
  fail(Object.keys(c).join('|')==='grantId|assignmentId|ownerAccountId|recipientAccountId')
  for(const id of [c.grantId,c.assignmentId,c.ownerAccountId,c.recipientAccountId])
    fail(UUID.test(id))
  fail(c.ownerAccountId!==c.recipientAccountId)
  return utf8.encode('photobunker.photo-grant-invitation.v1\n'+JSON.stringify(c))
}
async function inviteKey(code:Uint8Array<ArrayBuffer>,id:string):Promise<CryptoKey>{
  const key=await crypto.subtle.importKey('raw',code,'HKDF',false,['deriveKey'])
  return crypto.subtle.deriveKey({
    name:'HKDF',hash:'SHA-256',salt:utf8.encode('photobunker/grant-invite/salt/v1|'+id),
    info:utf8.encode('photobunker/grant-invite/secret/v1'),
  },key,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])
}
export async function sealGrantSecret(code:string,secret:string,c:GrantInvitationContext):
  Promise<SealedGrantSecret>{
  const associated=inviteAad(c),raw=decode(secret,32),invitation=decode(code,32)
  try{
    const key=await inviteKey(invitation,c.grantId)
    const iv=crypto.getRandomValues(new Uint8Array(12))
    const ct=new Uint8Array(await crypto.subtle.encrypt({
      name:'AES-GCM',iv,additionalData:associated,tagLength:128,
    },key,raw))
    return {v:1,iv:b64(iv),ciphertext:b64(ct)}
  }finally{raw.fill(0);invitation.fill(0)}
}
export async function openGrantSecret(code:string,sealed:SealedGrantSecret,
  c:GrantInvitationContext):Promise<string>{
  const associated=inviteAad(c)
  fail(sealed&&typeof sealed==='object'&&!Array.isArray(sealed))
  fail(Object.keys(sealed).join('|')==='v|iv|ciphertext'&&sealed.v===1)
  const iv=decode(sealed.iv,12),ct=decode(sealed.ciphertext,48),invitation=decode(code,32)
  try{
    const key=await inviteKey(invitation,c.grantId)
    const raw=new Uint8Array(await crypto.subtle.decrypt({
      name:'AES-GCM',iv,additionalData:associated,tagLength:128,
    },key,ct))
    fail(raw.length===32)
    const secret=b64(raw)
    raw.fill(0)
    return secret
  }finally{invitation.fill(0)}
}

/** Caller must independently verify current signed grant and TTL before invoking. */
export async function openRecipientKey(code:string,wire:RecipientKeyEnvelope,
  expected:KeyContext,now:number):Promise<Uint8Array<ArrayBuffer>>{
  const associated=aad(expected)
  fail(Number.isSafeInteger(now)&&now<expected.expiresAt)
  fail(wire&&typeof wire==='object'&&!Array.isArray(wire))
  fail(Object.keys(wire).join('|')==='v|context|iv|ciphertext'&&wire.v===1)
  fail(JSON.stringify(wire.context)===JSON.stringify(expected))
  const iv=decode(wire.iv,12),cipher=decode(wire.ciphertext,48),secret=decode(code,32)
  try{
    const key=await transport(secret,expected.grantId)
    const raw=await crypto.subtle.decrypt({
      name:'AES-GCM',iv,additionalData:associated,tagLength:128,
    },key,cipher)
    fail(raw.byteLength===32)
    return new Uint8Array(raw)
  }finally{secret.fill(0)}
}
