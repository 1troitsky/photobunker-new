import {acquireStorageKeys} from '../../identity'
import type {AssignmentAction,AssignmentFields,AssignmentStatus} from '../domain/model'
const utf8=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true})
type Grant=ReturnType<typeof acquireStorageKeys>
export type AssignmentEnvelope={version:1;accountId:string;assignmentId:string;
  operationId:string;revision:number;iv:string;wrappedDEK:{iv:string;ciphertext:string};ciphertext:string}
export type AssignmentContract={version:1;assignmentId:string;operationId:string;
  expectedRevision:number;revision:number;action:AssignmentAction;status:AssignmentStatus;
  policyRevision:number;mode:2|3;retentionDays:number;envelope:AssignmentEnvelope|null}
function encode(b:Uint8Array):string{
  let raw='';for(let i=0;i<b.length;i++)raw+=String.fromCharCode(b[i]!)
  return btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
}
function decode(s:string):Uint8Array<ArrayBuffer>{
  if(!/^[A-Za-z0-9_-]+$/.test(s))throw Error('assignment.cipher_invalid')
  const raw=atob(s.replace(/-/g,'+').replace(/_/g,'/'))
  return new Uint8Array(Uint8Array.from(raw,c=>c.charCodeAt(0)))
}
function aad(account:string,assignment:string,operation:string,revision:number):Uint8Array<ArrayBuffer>{
  return new Uint8Array(utf8.encode('photobunker.assignment.v1|'+account+'|'+assignment+'|'+operation+'|'+revision))
}
export async function seal(grant:Grant,assignmentId:string,operationId:string,revision:number,
  fields:AssignmentFields):Promise<AssignmentEnvelope>{
  const {key,wrapped}=await grant.create(operationId,'assignment-v1')
  const iv=crypto.getRandomValues(new Uint8Array(12))
  const ciphertext=new Uint8Array(await crypto.subtle.encrypt({
    name:'AES-GCM',iv,additionalData:aad(grant.scope.accountId,assignmentId,operationId,revision),
  },key,utf8.encode(JSON.stringify({title:fields.title,instructions:fields.instructions,
    startsAt:fields.startsAt??null,finishesAt:fields.finishesAt??null,
    targetCount:fields.targetCount??null}))))
  grant.check()
  return{version:1,accountId:grant.scope.accountId,assignmentId,operationId,revision,
    iv:encode(iv),wrappedDEK:wrapped,ciphertext:encode(ciphertext)}
}
export async function unseal(grant:Grant,e:AssignmentEnvelope):Promise<Pick<AssignmentFields,'title'|'instructions'|'startsAt'|'finishesAt'|'targetCount'>>{
  if(e.version!==1||e.accountId!==grant.scope.accountId||
    !Number.isSafeInteger(e.revision)||e.revision<1)throw Error('assignment.envelope_scope')
  const key=await grant.open(e.operationId,'assignment-v1',e.wrappedDEK)
  const clear=await crypto.subtle.decrypt({
    name:'AES-GCM',iv:decode(e.iv),
    additionalData:aad(e.accountId,e.assignmentId,e.operationId,e.revision),
  },key,decode(e.ciphertext))
  grant.check()
  const data=JSON.parse(decoder.decode(clear)) as {title:string;instructions:string;
    startsAt?:unknown;finishesAt?:unknown;targetCount?:unknown}
  if(typeof data.title!=='string'||typeof data.instructions!=='string')throw Error('assignment.payload_invalid')
  // Accept old ciphertext without these fields; reject malformed new private data.
  for(const date of [data.startsAt,data.finishesAt])
    if(date!==undefined&&date!==null&&typeof date!=='string')throw Error('assignment.payload_invalid')
  if(data.targetCount!==undefined&&data.targetCount!==null&&
    (typeof data.targetCount!=='number'||!Number.isInteger(data.targetCount)))
    throw Error('assignment.payload_invalid')
  return{title:data.title,instructions:data.instructions,
    startsAt:data.startsAt as string|null|undefined??null,
    finishesAt:data.finishesAt as string|null|undefined??null,
    targetCount:data.targetCount as number|null|undefined??null}
}
