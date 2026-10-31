import {describe,it,expect} from 'vitest'
import {encryptAsset} from './cipher'
import {decryptRecipientThumbnail} from './recipient-thumbnail'
import type {Scope} from '../domain/contracts'
const id=()=>crypto.randomUUID()
describe('recipient decrypts owner-bound encrypted thumbnail without AAD rewriting',()=>{
  it('opens owner ciphertext using recipient-recovered DEK without writing to device storage',async()=>{
    const owner=id(),photo=id(),asset=id()
    const scope:Scope={accountId:owner,deviceId:id(),generation:1}
    const raw=crypto.getRandomValues(new Uint8Array(32))
    const key=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt'])
    raw.fill(0)
    const path=[owner,photo,asset,id()].join('/')
    const encrypted=await encryptAsset(scope,photo,asset,'thumbnail',1,
      Date.now()+3600000,new Blob(['test thumbnail pixels']),key,
      {iv:'A'.repeat(16),ciphertext:'A'.repeat(64)},'idb-blob',path,()=>{})
    const {backend,storageKey,...source}=encrypted.manifest
    void backend;void storageKey
    const decoded=await decryptRecipientThumbnail(owner,source,encrypted.blob,key,()=>{})
    expect(await decoded.text()).toBe('test thumbnail pixels')
    expect(decoded.type).toBe('image/webp')
    await expect(decryptRecipientThumbnail(id(),source,encrypted.blob,key,()=>{})).rejects.toThrow()
    const tampered={...source,cipherDigest:'f'.repeat(64)}
    await expect(decryptRecipientThumbnail(owner,tampered,encrypted.blob,key,()=>{})).rejects.toThrow()
    const corrupted=await encrypted.blob.arrayBuffer()
    new Uint8Array(corrupted)[3]^=0xff
    await expect(decryptRecipientThumbnail(owner,source,new Blob([corrupted]),key,()=>{})).rejects.toThrow()
  })
})
