import { b64, unb64 } from '../identity/keys'
import { canonical, statementBytes } from '../crypto/protocol'

export type EmergencyIntent = {
  version: 1
  operationId: string
  accountId: string
  keyId: string
  revision: number
  action: 'emergency-delete'
}
export type SealedEmergencyKey = {
  version: 1
  salt: string
  iterations: number
  iv: string
  ciphertext: string
  publicKey: string
  keyId: string
}
const utf8=new TextEncoder()
const bytes=(value:string)=>unb64(value)
function isPin(value:string) { return /^(?:\d{6}|\d{8})$/.test(value) }
async function encryptionKey(pin:string,salt:string,iterations:number) {
  if(!isPin(pin) || !Number.isSafeInteger(iterations) || iterations<100000 || iterations>600000)
    throw new Error('emergency.pin')
  const base=await crypto.subtle.importKey('raw',utf8.encode(pin),'PBKDF2',false,['deriveKey'])
  return crypto.subtle.deriveKey({
    name:'PBKDF2',hash:'SHA-256',iterations,salt:bytes(salt)
  },base,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])
}
export async function generateEmergencyKey(pin:string,keyId:string):Promise<SealedEmergencyKey> {
  if(!isPin(pin))throw new Error('emergency.pin')
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify'])
  const publicKey=b64(await crypto.subtle.exportKey('spki',pair.publicKey))
  const pkcs8=new Uint8Array(await crypto.subtle.exportKey('pkcs8',pair.privateKey))
  const salt=b64(crypto.getRandomValues(new Uint8Array(16)).buffer)
  const iv=b64(crypto.getRandomValues(new Uint8Array(12)).buffer)
  const before=performance.now()
  await encryptionKey('000000',salt,100000)
  const elapsed=Math.max(1,performance.now()-before)
  const iterations=Math.max(100000,Math.min(600000,Math.round(3000/elapsed)*10000))
  try{
    const key=await encryptionKey(pin,salt,iterations)
    const ciphertext=b64(await crypto.subtle.encrypt({
      name:'AES-GCM',iv:bytes(iv),additionalData:utf8.encode('photobunker.emergency.v1:'+keyId+':'+publicKey)
    },key,pkcs8))
    return {version:1,salt,iv,iterations,ciphertext,publicKey,keyId}
  }finally{pkcs8.fill(0)}
}
/** Import PRIVATE signing material only after PIN-derived AES-GCM opens it.
 * The CryptoKey exposed to the consumer is non-extractable and ephemeral.
 */
export async function openEmergencyKey(pin:string,value:SealedEmergencyKey):Promise<CryptoKey> {
  if(value.version!==1 || !isPin(pin) || !/^[a-f0-9-]{36}$/i.test(value.keyId) ||
     value.iterations<100000 || value.iterations>600000 ||
     bytes(value.salt).length!==16 || bytes(value.iv).length!==12 ||
     bytes(value.publicKey).length!==91)
    throw new Error('emergency.storage')
  const derived=await encryptionKey(pin,value.salt,value.iterations)
  let plaintext:Uint8Array<ArrayBuffer>
  try{
    plaintext=new Uint8Array(await crypto.subtle.decrypt({
      name:'AES-GCM',iv:bytes(value.iv),
      additionalData:utf8.encode('photobunker.emergency.v1:'+value.keyId+':'+value.publicKey)
    },derived,bytes(value.ciphertext)))
  }catch{throw new Error('emergency.wrong')}
  try{
    return await crypto.subtle.importKey('pkcs8',plaintext,{
      name:'ECDSA',namedCurve:'P-256'
    },false,['sign'])
  }finally{plaintext.fill(0)}
}
export async function matchesEmergencyPin(pin:string,value:SealedEmergencyKey):Promise<boolean> {
  try { await openEmergencyKey(pin,value); return true }
  catch(error) {
    if(error instanceof Error && error.message==='emergency.wrong')return false
    throw error
  }
}
/** API/crypto primitive for the *later* R1-08B. No lock-screen trigger,
 * durable intent outbox, local wipe or automatic network delivery here.
 */
export async function signEmergencyIntent(pin:string,key:SealedEmergencyKey,intent:EmergencyIntent) {
  if(intent.version!==1 || intent.action!=='emergency-delete' ||
     intent.keyId!==key.keyId || !/^[a-f0-9-]{36}$/i.test(intent.operationId) ||
     !/^[a-f0-9-]{36}$/i.test(intent.accountId) ||
     !Number.isSafeInteger(intent.revision)||intent.revision<1)
    throw new Error('emergency.intent')
  const privateKey=await openEmergencyKey(pin,key)
  const signature=b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},privateKey,
    statementBytes('emergency-delete',intent) as Uint8Array<ArrayBuffer>))
  return {intent:canonical(intent),signature}
}
