import {describe,it,expect} from 'vitest'
import {createPhotoGrantCode} from './key-envelope'
import {sealLocalGrantSecret,openLocalGrantSecret,openLocalGrantIdentity} from './secret'
import type {acquireStorageKeys} from '../../identity'
const id=()=>crypto.randomUUID()
describe('PB2 device/account-scoped encrypted Assignment grant secret',()=>{
  it('keeps 256-bit secret out of durable ciphertext and refuses another account/device/grant',async()=>{
    const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt'])
    const g={
      scope:{accountId:id(),deviceId:id(),generation:1},
      check:()=>{},
      create:async()=>({key,wrapped:{iv:'wrapped',ciphertext:'wrapped'}}),
      open:async()=>key,
    } as unknown as ReturnType<typeof acquireStorageKeys>
    const c={grantId:id(),assignmentId:id(),ownerAccountId:g.scope.accountId,
      recipientAccountId:id()}
    const secret=createPhotoGrantCode()
    const root='A'.repeat(120)
    const wire=await sealLocalGrantSecret(g,c,secret,root)
    expect(JSON.stringify(wire)).not.toContain(secret)
    expect(await openLocalGrantSecret(g,c,wire)).toBe(secret)
    expect(await openLocalGrantIdentity(g,c,wire)).toEqual({secret,ownerAccountSpki:root})
    const other={...g,scope:{...g.scope,accountId:id()}} as typeof g
    await expect(openLocalGrantSecret(other,c,wire)).rejects.toThrow()
    const device={...g,scope:{...g.scope,deviceId:id()}} as typeof g
    await expect(openLocalGrantSecret(device,c,wire)).rejects.toThrow()
    await expect(openLocalGrantSecret(g,{...c,assignmentId:id()},wire)).rejects.toThrow()
    await expect(openLocalGrantSecret(g,c,{...wire,ciphertext:wire.ciphertext.slice(0,-2)+'AA'}))
      .rejects.toThrow()
  })
})
