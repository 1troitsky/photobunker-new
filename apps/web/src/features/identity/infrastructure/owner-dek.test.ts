import {describe,it,expect} from 'vitest'
import {freshPackage,wrapAssetDEK,unwrapAssetDEK,withTransientOwnerDEK,newSigning,exportSpki,sign,importSigner} from './crypto'
import {verifyPinnedOwnerDeviceProof} from './identity'

describe('owner per-asset DEK transfer capability',()=>{
  it('uses existing AKEK-wrapped DEK and zeroes ephemeral plaintext after wrapping',async()=>{
    const {pkg}=await freshPackage(crypto.randomUUID()),id=crypto.randomUUID()
    const expiry=String(Date.now()+3600000)
    const wrapped=await wrapAssetDEK(pkg,id,expiry)
    const exposed:{value?:Uint8Array<ArrayBuffer>}={}
    const cipher=await withTransientOwnerDEK(pkg,id,expiry,wrapped,async raw=>{
      exposed.value=raw
      expect(raw.length).toBe(32)
      const key=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt'])
      const iv=crypto.getRandomValues(new Uint8Array(12))
      return {iv,cipher:await crypto.subtle.encrypt({name:'AES-GCM',iv},key,
        new TextEncoder().encode('exact asset'))}
    })
    expect(exposed.value).toBeDefined()
    expect([...exposed.value!].every(b=>b===0)).toBe(true)
    const original=await unwrapAssetDEK(pkg,id,expiry,wrapped)
    const text=await crypto.subtle.decrypt({name:'AES-GCM',iv:cipher.iv},original,cipher.cipher)
    expect(new TextDecoder().decode(text)).toBe('exact asset')
    await expect(withTransientOwnerDEK(pkg,crypto.randomUUID(),expiry,wrapped,async()=>true))
      .rejects.toThrow()
    await expect(withTransientOwnerDEK(pkg,id,String(Number(expiry)+1),wrapped,async()=>true))
      .rejects.toThrow()
  })
  it('erases transient key on rejected encrypt callback',async()=>{
    const {pkg}=await freshPackage(crypto.randomUUID()),id=crypto.randomUUID()
    const expiry=String(Date.now()+1800000)
    const wrapped=await wrapAssetDEK(pkg,id,expiry)
    const captured:{value?:Uint8Array<ArrayBuffer>}={}
    await expect(withTransientOwnerDEK(pkg,id,expiry,wrapped,async raw=>{
      captured.value=raw;throw Error('interrupted')
    })).rejects.toThrow('interrupted')
    expect(captured.value).toBeDefined()
    expect([...captured.value!].every(b=>b===0)).toBe(true)
  })
})

describe('owner device endorsement against OOB-pinned root identity',()=>{
  it('rejects server-substituted owner roots, device signers and altered statements',async()=>{
    const {pkg}=await freshPackage(crypto.randomUUID())
    const devicePair=await newSigning(true),deviceSpki=await exportSpki(devicePair.publicKey)
    const statement='photobunker.photo-recipient.v1\n'+crypto.randomUUID().repeat(12)
    const deviceId=crypto.randomUUID()
    const deviceSignature=await sign(devicePair.privateKey,statement)
    const raw=statement.slice('photobunker.photo-recipient.v1\n'.length)
    const rootMessage='photobunker.photo-recipient-root.v1\n'+deviceId+
      '\n'+deviceSpki+'\n'+raw
    const rootSignature=await sign(await importSigner(pkg.accountPkcs8),rootMessage)
    expect(await verifyPinnedOwnerDeviceProof(raw,deviceSignature,deviceSpki,
      pkg.accountSpki,deviceId,rootSignature,pkg.accountSpki)).toBe(true)
    const foreign=await freshPackage(crypto.randomUUID())
    expect(await verifyPinnedOwnerDeviceProof(raw,deviceSignature,deviceSpki,
      pkg.accountSpki,deviceId,rootSignature,foreign.pkg.accountSpki)).toBe(false)
    expect(await verifyPinnedOwnerDeviceProof(raw,deviceSignature,deviceSpki,
      pkg.accountSpki,crypto.randomUUID(),rootSignature,pkg.accountSpki)).toBe(false)
    const otherDevice=await newSigning(true)
    expect(await verifyPinnedOwnerDeviceProof(raw,deviceSignature,
      await exportSpki(otherDevice.publicKey),pkg.accountSpki,deviceId,rootSignature,
      pkg.accountSpki)).toBe(false)
  })
})
