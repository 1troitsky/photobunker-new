import {acquireStorageKeys} from '../../identity'
import {validateFields,type AssignmentAction,type AssignmentFields,type AssignmentStatus} from '../domain/model'
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
  },key,utf8.encode(JSON.stringify((({mode:_mode,retentionDays:_days,...privateFields})=>privateFields)(validateFields(fields))))))
  grant.check()
  return{version:1,accountId:grant.scope.accountId,assignmentId,operationId,revision,
    iv:encode(iv),wrappedDEK:wrapped,ciphertext:encode(ciphertext)}
}
export async function unseal(grant:Grant,e:AssignmentEnvelope):Promise<Omit<AssignmentFields,'mode'|'retentionDays'>>{
  if(e.version!==1||e.accountId!==grant.scope.accountId||
    !Number.isSafeInteger(e.revision)||e.revision<1)throw Error('assignment.envelope_scope')
  const key=await grant.open(e.operationId,'assignment-v1',e.wrappedDEK)
  const clear=await crypto.subtle.decrypt({
    name:'AES-GCM',iv:decode(e.iv),
    additionalData:aad(e.accountId,e.assignmentId,e.operationId,e.revision),
  },key,decode(e.ciphertext))
  grant.check()
  const data=JSON.parse(decoder.decode(clear)) as Partial<AssignmentFields>
  if(!data||typeof data!=='object'||Array.isArray(data)||
    typeof data.title!=='string'||typeof data.instructions!=='string')
    throw Error('assignment.payload_invalid')
  // Private payload stays authenticated; legacy ciphertext receives safe defaults.
  const {mode:_mode,retentionDays:_days,...fields}=validateFields({
    ...data,title:data.title,instructions:data.instructions,
    mode:2,retentionDays:1,
  })
  return fields
}
