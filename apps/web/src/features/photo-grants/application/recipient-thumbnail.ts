import {identity,photoRequest,verifyPinnedOwnerDeviceProof} from '../../identity'
import {decryptRecipientThumbnail,type CloudAsset} from '../../local-storage'
import {fetchAssignmentGrants,getLocalGrantIdentity} from './grants'
import {openRecipientKey,type KeyContext,type RecipientKeyEnvelope} from '../infrastructure/key-envelope'

type ResponseEnvelope={photoId:string;assetId:string;bytes:number;sha256:string;
  manifest:CloudAsset['manifest'];contract:string;signature:string;signerSpki:string;
  ownerAccountSpki:string;ownerRootSignature:string;publisherDeviceId:string}

function guard(account:string,device:string):void{
  if(identity.value?.accountId!==account||identity.value?.deviceId!==device||
    identity.value.offline)throw Error('grant.identity_changed')
}
function error(reason:string):never{throw Error('grant.read_'+reason)}
function checkedStatement(input:ResponseEnvelope,grantId:string,photoId:string,assetId:string,
  ownerId:string,recipientId:string,generation:number,assignmentId:string):{
  envelope:RecipientKeyEnvelope;context:KeyContext
}{
  if(typeof input.contract!=='string')error('contract')
  const c=JSON.parse(input.contract) as Record<string,unknown>&{envelope?:RecipientKeyEnvelope}
  if(Object.keys(c).join('|')!=='v|operationId|grantId|generation|assignmentId|ownerAccountId|recipientAccountId|photoId|assetId|kind|assetRevision|expiresAt|cipherDigest|envelope'||
    c.v!==1||c.grantId!==grantId||c.generation!==generation||
    c.assignmentId!==assignmentId||c.ownerAccountId!==ownerId||
    c.recipientAccountId!==recipientId||c.photoId!==photoId||c.assetId!==assetId||
    c.kind!=='thumbnail'||c.assetRevision!==input.manifest.revision||
    c.expiresAt!==input.manifest.expiresAt||c.cipherDigest!==input.manifest.cipherDigest)
    error('scope')
  const m=input.manifest
  if(m.accountId!==ownerId||m.photoId!==photoId||m.assetId!==assetId||
    m.kind!=='thumbnail'||m.expiresAt<=Date.now()||
    !Number.isSafeInteger(input.bytes)||input.bytes<16||
    !/^[a-f0-9]{64}$/.test(input.sha256)||input.bytes!==m.cipherBytes)
    error('manifest')
  const ctx:KeyContext={grantId,generation,assignmentId,
    ownerAccountId:ownerId,recipientAccountId:recipientId,
    photoId,assetId,kind:'thumbnail',revision:m.revision,
    expiresAt:m.expiresAt,cipherDigest:m.cipherDigest}
  if(!c.envelope||JSON.stringify(c.envelope.context)!==JSON.stringify(ctx))
    error('envelope')
  return {envelope:c.envelope as RecipientKeyEnvelope,context:ctx}
}
/** No disk writes: returns only volatile decrypted WebP. Owner's manifest AAD
 * and ciphertext SHA-256 are checked; current live server ACL controls each read.
 */
export async function readRecipientThumbnail(grantId:string,photoId:string,assetId:string):Promise<Blob>{
  const who=identity.value
  if(!who||who.offline||!navigator.onLine)error('offline')
  const {accountId,deviceId}=who
  const grant=(await fetchAssignmentGrants()).find(x=>x.grantId===grantId)
  guard(accountId,deviceId)
  if(!grant||grant.recipientId!==accountId||grant.state!=='accepted')error('no_grant')
  const path='/shared/grants/'+grantId+'/photos/'+photoId+'/assets/'+assetId
  const result=await photoRequest(path)
  guard(accountId,deviceId)
  if(!result.ok)error('http_'+result.status)
  const info=await result.json() as ResponseEnvelope
  guard(accountId,deviceId)
  if(info.photoId!==photoId||info.assetId!==assetId)error('wrong_asset')
  const local=await getLocalGrantIdentity(grant)
  guard(accountId,deviceId)
  if(!local.ownerAccountSpki)error('untrusted_legacy_invitation')
  if(!await verifyPinnedOwnerDeviceProof(info.contract,info.signature,info.signerSpki,
    info.ownerAccountSpki,info.publisherDeviceId,info.ownerRootSignature,
    local.ownerAccountSpki))error('author_provenance')
  guard(accountId,deviceId)
  const {envelope,context}=checkedStatement(info,grantId,photoId,assetId,
    grant.ownerId,accountId,grant.generation,grant.assignmentId)
  const raw=await openRecipientKey(local.secret,envelope,context,Date.now())
  guard(accountId,deviceId)
  let key:CryptoKey
  try{key=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['decrypt'])}
  finally{raw.fill(0)}
  const response=await photoRequest(path+'/ciphertext')
  guard(accountId,deviceId)
  if(!response.ok)error('http_'+response.status)
  const ciphertext=await response.blob()
  guard(accountId,deviceId)
  if(ciphertext.size!==info.bytes)error('length')
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',await ciphertext.arrayBuffer()))
  const actual=[...hash].map(b=>b.toString(16).padStart(2,'0')).join('')
  guard(accountId,deviceId)
  if(actual!==info.sha256)error('digest')
  return decryptRecipientThumbnail(grant.ownerId,info.manifest,ciphertext,key,
    ()=>guard(accountId,deviceId))
}
