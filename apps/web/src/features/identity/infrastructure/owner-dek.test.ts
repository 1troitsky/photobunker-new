import {describe,it,expect} from 'vitest'
import {freshPackage,wrapAssetDEK,unwrapAssetDEK,withTransientOwnerDEK} from './crypto'

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
