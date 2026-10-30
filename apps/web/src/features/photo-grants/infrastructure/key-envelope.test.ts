import {describe,it,expect} from 'vitest'
import {encryptAsset,decryptRecipientThumbnail} from '../../local-storage'
import {createPhotoGrantCode,photoGrantCodeHash,sealRecipientKey,openRecipientKey,
 type KeyContext,sealGrantSecret,openGrantSecret,sealGrantSecretPinned,openGrantSecretPinned} from './key-envelope'
const id=()=>crypto.randomUUID()
const context=():KeyContext=>({grantId:id(),generation:1,assignmentId:id(),
  ownerAccountId:id(),recipientAccountId:id(),photoId:id(),assetId:id(),
  kind:'original',revision:1,expiresAt:Date.now()+100000,cipherDigest:'f'.repeat(64)})
describe('P0 scoped per-recipient photo DEK transport, not ACL',()=>{
  it('encrypts and decrypts a per-asset 32-byte key under an out-of-band secret',async()=>{
    const c=context(),code=createPhotoGrantCode(),key=crypto.getRandomValues(new Uint8Array(32))
    const wire=await sealRecipientKey(code,c,key)
    expect(JSON.stringify(wire)).not.toContain(code)
    expect([...await openRecipientKey(code,wire,c,Date.now())]).toEqual([...key])
    expect(await photoGrantCodeHash(code)).toMatch(/^[a-f0-9]{64}$/)
  })
  it('rejects substitutions for recipient, asset, grant, generation, revision, expiry and digest',async()=>{
    const c=context(),code=createPhotoGrantCode(),wire=await sealRecipientKey(
      code,c,crypto.getRandomValues(new Uint8Array(32)))
    for(const changed of [{...c,recipientAccountId:id()},{...c,assetId:id()},
      {...c,grantId:id()},{...c,assignmentId:id()},{...c,photoId:id()},
      {...c,generation:2},{...c,revision:2},{...c,kind:'metadata' as const},
      {...c,cipherDigest:'a'.repeat(64)},{...c,expiresAt:c.expiresAt-1}]){
      await expect(openRecipientKey(code,wire,changed,Date.now())).rejects.toThrow()
    }
  })
  it('rejects tampering, wrong code, noncanonical code and expiry boundary',async()=>{
    const c=context(),code=createPhotoGrantCode(),wire=await sealRecipientKey(
      code,c,crypto.getRandomValues(new Uint8Array(32)))
    await expect(openRecipientKey(code,wire,c,c.expiresAt)).rejects.toThrow()
    await expect(openRecipientKey(createPhotoGrantCode(),wire,c,Date.now())).rejects.toThrow()
    await expect(openRecipientKey(code,{...wire,ciphertext:wire.ciphertext.slice(0,-2)+'AA'},c,Date.now()))
      .rejects.toThrow()
    await expect(sealRecipientKey(code+'=',c,crypto.getRandomValues(new Uint8Array(32))))
      .rejects.toThrow()
  })
  it('rejects unknown context fields',async()=>{
    const c=context(),code=createPhotoGrantCode()
    await expect(sealRecipientKey(code,{...c,public:true} as KeyContext,
      crypto.getRandomValues(new Uint8Array(32)))).rejects.toThrow()
  })
})

describe('separate out-of-band invite and per-grant transport secret',()=>{
  it('seals a new grant secret to exact invitation context and reuses it only after unwrapping',async()=>{
    const c=context(),oob=createPhotoGrantCode(),grantSecret=createPhotoGrantCode()
    const invite={grantId:c.grantId,assignmentId:c.assignmentId,
      ownerAccountId:c.ownerAccountId,recipientAccountId:c.recipientAccountId}
    const sealed=await sealGrantSecret(oob,grantSecret,invite)
    expect(JSON.stringify(sealed)).not.toContain(oob)
    expect(JSON.stringify(sealed)).not.toContain(grantSecret)
    expect(await openGrantSecret(oob,sealed,invite)).toBe(grantSecret)
    await expect(openGrantSecret(createPhotoGrantCode(),sealed,invite)).rejects.toThrow()
    await expect(openGrantSecret(oob,sealed,{...invite,recipientAccountId:id()})).rejects.toThrow()
    const dek=crypto.getRandomValues(new Uint8Array(32))
    const photo=await sealRecipientKey(grantSecret,c,dek)
    expect([...await openRecipientKey(await openGrantSecret(oob,sealed,invite),photo,c,Date.now())])
      .toEqual([...dek])
  })
})

describe('OOB owner account root pinning for new invitations',()=>{
  it('pin is encrypted with the code, scoped to the exact owner/recipient/assignment',async()=>{
    const c=context(),code=createPhotoGrantCode(),secret=createPhotoGrantCode()
    const invite={grantId:c.grantId,assignmentId:c.assignmentId,
      ownerAccountId:c.ownerAccountId,recipientAccountId:c.recipientAccountId}
    const root='A'.repeat(120)
    const sealed=await sealGrantSecretPinned(code,secret,invite,root)
    expect(sealed.v).toBe(2)
    expect(JSON.stringify(sealed)).not.toContain(root)
    expect(await openGrantSecretPinned(code,sealed,invite))
      .toEqual({secret,ownerAccountSpki:root})
    await expect(openGrantSecretPinned(createPhotoGrantCode(),sealed,invite)).rejects.toThrow()
    await expect(openGrantSecretPinned(code,sealed,{...invite,ownerAccountId:id()})).rejects.toThrow()
    const legacy=await sealGrantSecret(code,secret,invite)
    await expect(openGrantSecretPinned(code,legacy,invite)).rejects.toThrow()
  })
})

describe('two independent accounts: exact encrypted photo bytes through invitation and recipient DEK',()=>{
  it('decrypts the owner-scoped thumbnail only with the accepted recipient grant secret',async()=>{
    const owner=id(),recipient=id(),photoId=id(),assetId=id(),assignmentId=id(),grantId=id()
    const expiresAt=Date.now()+3600000
    const raw=crypto.getRandomValues(new Uint8Array(32))
    const ownerKey=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt'])
    const source=new Blob([new TextEncoder().encode('RIFF-original-thumbnail-WEBP')])
    const scope={accountId:owner,deviceId:id(),generation:1}
    const placeholderWrap={iv:'AAAAAAAAAAAAAAAA',ciphertext:'transported-out-of-band'}
    const encrypted=await encryptAsset(scope,photoId,assetId,'thumbnail',1,expiresAt,
      source,ownerKey,placeholderWrap,'idb-blob',
      [owner,photoId,assetId,assetId].join('/'),()=>{})
    const manifest=encrypted.manifest
    const context:KeyContext={grantId,generation:2,assignmentId,
      ownerAccountId:owner,recipientAccountId:recipient,photoId,assetId,
      kind:'thumbnail',revision:1,expiresAt,cipherDigest:manifest.cipherDigest}
    const invitation={grantId,assignmentId,ownerAccountId:owner,recipientAccountId:recipient}
    const oob=createPhotoGrantCode(),secret=createPhotoGrantCode()
    const pinned=await sealGrantSecretPinned(oob,secret,invitation,'A'.repeat(120))
    const sealedDEK=await sealRecipientKey(secret,context,raw)
    raw.fill(0)
    // This simulates another account/device: it possesses neither the original
    // asset key nor owner's account keys. Only its separately delivered invite.
    const accepted=await openGrantSecretPinned(oob,pinned,invitation)
    const transported=await openRecipientKey(accepted.secret,sealedDEK,context,Date.now())
    const recipientKey=await crypto.subtle.importKey('raw',transported,
      {name:'AES-GCM'},false,['decrypt'])
    transported.fill(0)
    const {backend:_backend,storageKey:_key,...cloudManifest}=manifest
    void _backend;void _key
    const output=await decryptRecipientThumbnail(owner,cloudManifest,encrypted.blob,
      recipientKey,()=>{})
    expect([...new Uint8Array(await output.arrayBuffer())])
      .toEqual([...new Uint8Array(await source.arrayBuffer())])
    await expect(openRecipientKey(accepted.secret,sealedDEK,
      {...context,recipientAccountId:id()},Date.now())).rejects.toThrow()
    await expect(decryptRecipientThumbnail(recipient,cloudManifest,
      encrypted.blob,recipientKey,()=>{})).rejects.toThrow()
  })
})
