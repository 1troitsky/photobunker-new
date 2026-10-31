import {identity,photoRequest,signRecoveredCloudAsset} from '../../identity'
import {openLocalPhotoVault,type CloudAsset} from '../../local-storage'

export type CloudRecoveryCheck=Readonly<{
  operationId:string;photoId:string;assetId:string;originDeviceId:string;
  verifiedDeviceId:string;cipherSha256:string;plainSha256:string;
  payloadHash:string;state:'device-attested';verifiedAt:string
}>
type ManifestReply=Readonly<{
  photoId:string;expiresAt:number;originDeviceId:string;
  metadataAssetId:string;assets:CloudAsset[]
}>
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const sha=/^[a-f0-9]{64}$/
function assertActive(account:string,device:string):void{
  if(identity.value?.accountId!==account||identity.value?.deviceId!==device)
    throw Error('recovery.identity_switched')
}
async function payloadDigest(payload:Record<string,string>):Promise<string>{
  const canonical=JSON.stringify(Object.fromEntries(
    Object.entries(payload).sort(([a],[b])=>a<b?-1:a>b?1:0)))
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(canonical)))].map(v=>v.toString(16).padStart(2,'0')).join('')
}
function parseManifest(input:unknown,photoId:string,accountId:string,
  deviceId:string):ManifestReply{
  if(!input||typeof input!=='object')throw Error('recovery.invalid_manifest')
  const manifest=input as ManifestReply
  if(manifest.photoId!==photoId||!UUID.test(manifest.originDeviceId)||
    manifest.originDeviceId===deviceId||
    !Number.isSafeInteger(manifest.expiresAt)||
    manifest.expiresAt<=Date.now()||
    !Array.isArray(manifest.assets)||manifest.assets.length<2||manifest.assets.length>32)
    throw Error('recovery.invalid_manifest')
  const critical=manifest.assets.filter(x=>x&&['master','original','edit','metadata'].includes(x.kind))
  if(!critical.some(x=>x.kind==='master'||x.kind==='original')||
    !critical.some(x=>x.kind==='metadata'&&x.assetId===manifest.metadataAssetId))
    throw Error('recovery.incomplete_cloud_photo')
  const seen=new Set<string>()
  for(const asset of critical){
    if(!UUID.test(asset.assetId)||seen.has(asset.assetId)||!sha.test(asset.sha256)||
      !Number.isSafeInteger(asset.bytes)||asset.bytes<1||
      asset.bytes>150*1024*1024||
      !asset.manifest||asset.manifest.accountId!==accountId||
      asset.manifest.photoId!==photoId||asset.manifest.assetId!==asset.assetId||
      asset.manifest.kind!==asset.kind||asset.manifest.expiresAt!==manifest.expiresAt)
      throw Error('recovery.invalid_asset')
    seen.add(asset.assetId)
  }
  return manifest
}
/** Real cloud re-download, authenticated E2EE decryption of each critical
 * asset, then a current DEVICE-SIGNED, immutable per-asset attestation.
 *
 * Not an erasure authorization: a browser can lie about its execution;
 * signatures only establish which enrolled device made the claim. No
 * decrypted bytes, raw keys or plaintext hashes are persisted in browser DB.
 */
export async function attestRemotePhotoRecovery(photoId:string):Promise<CloudRecoveryCheck[]>{
  const current=identity.value
  if(!current||current.offline||!UUID.test(photoId))
    throw Error('recovery.requires_online_identity')
  const account=current.accountId,device=current.deviceId
  const reply=await photoRequest('/'+photoId+'/manifests')
  if(!reply.ok)throw Error('recovery.manifests_http_'+reply.status)
  const manifest=parseManifest(await reply.json(),photoId,account,device)
  assertActive(account,device)
  // Bind the entire restored object set to the actual cloud response, with
  // no fallback to local ciphertext. Never use local gallery cache.
  const critical=manifest.assets.filter(x=>['master','original','edit','metadata'].includes(x.kind))
  const vault=openLocalPhotoVault()
  const verified:{asset:CloudAsset;plainSha256:string}[]=[]
  for(const asset of critical){
    assertActive(account,device)
    const result=await photoRequest('/'+photoId+'/objects/'+asset.assetId)
    if(!result.ok)throw Error('recovery.object_http_'+result.status)
    const bytes=await result.blob()
    const opened=await vault.verifyRemoteRecoveryAsset(photoId,asset,bytes)
    assertActive(account,device)
    if(opened.plainBytes!==asset.manifest.plainBytes||!sha.test(opened.plaintextSha256))
      throw Error('recovery.invalid_plaintext')
    verified.push({asset,plainSha256:opened.plaintextSha256})
  }
  // Only after ALL critical objects have decrypted can any claim be signed.
  // Never claim a whole photo recovered if one object was corrupted/missing.
  const checks:CloudRecoveryCheck[]=[]
  for(const {asset,plainSha256} of verified){
    assertActive(account,device)
    const fields={
      photoId,assetId:asset.assetId,cipherSha256:asset.sha256,plainSha256,
      originDeviceId:manifest.originDeviceId,verifiedDeviceId:device,
      operationId:crypto.randomUUID(),
    }
    const signature=await signRecoveredCloudAsset(fields)
    assertActive(account,device)
    const response=await photoRequest('/'+photoId+'/recovery-checks/'+asset.assetId,
      'PUT',JSON.stringify({...fields,signature}))
    if(!response.ok)throw Error('recovery.attestation_http_'+response.status)
    const answer=await response.json() as CloudRecoveryCheck
    const expected=await payloadDigest(fields)
    if(answer.operationId!==fields.operationId||
      answer.photoId!==photoId||answer.assetId!==asset.assetId||
      answer.originDeviceId!==manifest.originDeviceId||
      answer.verifiedDeviceId!==device||
      answer.cipherSha256!==asset.sha256||answer.plainSha256!==plainSha256||
      answer.payloadHash!==expected||answer.state!=='device-attested'||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(answer.verifiedAt))
      throw Error('recovery.invalid_server_receipt')
    checks.push(answer)
  }
  return checks
}
