import {beforeEach,describe,expect,it,vi} from 'vitest'
const {active,request,sign,decrypt,events}=vi.hoisted(()=>({
  active:{value:{accountId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    deviceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',offline:false}},
  request:vi.fn(),sign:vi.fn(),decrypt:vi.fn(),
  events:[] as string[],
}))
vi.mock('../../identity',()=>({
  identity:active,photoRequest:request,signRecoveredCloudAsset:sign,
}))
vi.mock('../../local-storage',()=>({
  openLocalPhotoVault:()=>({verifyRemoteRecoveryAsset:decrypt}),
}))
import {attestRemotePhotoRecovery} from './second-device-recovery'
const photo='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const origin='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const master='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const metadata='ffffffff-ffff-4fff-8fff-ffffffffffff'
const digest='a'.repeat(64)
const future=4102444800000
const assets=[master,metadata].map((id,i)=>({
  assetId:id,kind:i===0?'master':'metadata',revision:1,
  bytes:16,sha256:digest,
  manifest:{accountId:active.value.accountId,photoId:photo,
    assetId:id,kind:i===0?'master':'metadata',expiresAt:future,
    cipherBytes:16,plainBytes:16},
}))
const manifest={photoId:photo,expiresAt:future,originDeviceId:origin,
  metadataAssetId:metadata,assets}
const okJson=(data:unknown)=>new Response(JSON.stringify(data),{
  headers:{'Content-Type':'application/json'},
})
async function digestPayload(input:Record<string,string>){
  const canonical=JSON.stringify(Object.fromEntries(
    Object.entries(input).sort(([a],[b])=>a<b?-1:a>b?1:0)))
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(canonical)))].map(v=>v.toString(16).padStart(2,'0')).join('')
}
beforeEach(()=>{
  active.value={accountId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    deviceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',offline:false}
  events.length=0
  sign.mockReset();decrypt.mockReset();request.mockReset()
  decrypt.mockImplementation(async()=>{events.push('decrypt');return {plainBytes:16}})
  sign.mockImplementation(async()=>{events.push('sign');return 'fake-signed'})
  request.mockImplementation(async(path:string,method?:string,body?:string)=>{
    if(path.endsWith('/manifests'))return okJson(manifest)
    if(path.endsWith('/recovery-checks')&&method===undefined)return okJson({checks:[]})
    if(path.includes('/objects/'))return new Response(new Blob(['1234567890123456']))
    if(path.includes('/recovery-checks/')&&method==='PUT'){
      const input=JSON.parse(body!) as Record<string,string>
      const {signature,...fields}=input
      return okJson({...fields,payloadHash:await digestPayload(fields),
        state:'device-attested',verifiedAt:'2026-11-01T10:00:00.000Z'})
    }
    throw Error('unexpected request '+path)
  })
})
describe('G5 independent cloud recovery confirmation',()=>{
  it('fully decrypts every critical asset before signing any evidence',async()=>{
    const checks=await attestRemotePhotoRecovery(photo)
    expect(checks).toHaveLength(2)
    expect(events).toEqual(['decrypt','decrypt','sign','sign'])
    expect(request.mock.calls.filter(c=>c[1]==='PUT')).toHaveLength(2)
    expect(sign.mock.calls[0]![0].verifiedDeviceId).toBe(active.value.deviceId)
  })
  it('cannot attest from the device that created the photo',async()=>{
    request.mockImplementationOnce(async()=>okJson({...manifest,originDeviceId:active.value.deviceId}))
    await expect(attestRemotePhotoRecovery(photo))
      .rejects.toThrow('recovery.invalid_manifest')
    expect(decrypt).not.toHaveBeenCalled()
    expect(sign).not.toHaveBeenCalled()
  })
  it('does not publish even first asset if second ciphertext fails verification',async()=>{
    decrypt.mockImplementationOnce(async()=>({plainBytes:16}))
      .mockRejectedValueOnce(Error('storage.ciphertext_corrupt'))
    await expect(attestRemotePhotoRecovery(photo))
      .rejects.toThrow('storage.ciphertext_corrupt')
    expect(sign).not.toHaveBeenCalled()
    expect(request.mock.calls.some(c=>c[1]==='PUT')).toBe(false)
  })
  it('switching identity during decrypt aborts before signing',async()=>{
    decrypt.mockImplementationOnce(async()=>{
      active.value={...active.value,deviceId:origin}
      return{plainBytes:16}
    })
    await expect(attestRemotePhotoRecovery(photo))
      .rejects.toThrow('recovery.identity_switched')
    expect(sign).not.toHaveBeenCalled()
  })
  it('never trusts a previously stored receipt for different ciphertext',async()=>{
    const fake={operationId:'11111111-1111-4111-8111-111111111111',
      assetId:master,photoId:photo,originDeviceId:origin,
      verifiedDeviceId:active.value.deviceId,cipherSha256:'0'.repeat(64),
      decryption:'aead-verified',payloadHash:'1'.repeat(64),
      state:'device-attested',verifiedAt:'2026-11-01T10:00:00.000Z'}
    request.mockImplementation(async(path:string)=>{
      if(path.endsWith('/manifests'))return okJson(manifest)
      if(path.includes('/objects/'))return new Response(new Blob(['1234567890123456']))
      if(path.endsWith('/recovery-checks'))return okJson({checks:[fake]})
      throw Error('unexpected')
    })
    await expect(attestRemotePhotoRecovery(photo))
      .rejects.toThrow('recovery.stale_or_mismatched_receipt')
    expect(sign).not.toHaveBeenCalled()
  })
})
