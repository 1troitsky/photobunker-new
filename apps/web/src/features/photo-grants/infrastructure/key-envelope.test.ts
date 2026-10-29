import {describe,it,expect} from 'vitest'
import {createPhotoGrantCode,photoGrantCodeHash,sealRecipientKey,openRecipientKey,
 type KeyContext} from './key-envelope'
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
