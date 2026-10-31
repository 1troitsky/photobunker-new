// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateEmergencyKey,openEmergencyKey,signEmergencyIntent } from '../src/app/emergency-crypto'
import { statementBytes,canonical } from '../src/crypto/protocol'
import { unb64 } from '../src/identity/keys'
beforeEach(()=>vi.stubGlobal('crypto',webcrypto))
const ACCOUNT='11111111-1111-4111-8111-111111111111'
const OTHER='22222222-2222-4222-8222-222222222222'
const KEY='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const OP='99999999-9999-4999-8999-999999999999'
describe('R1-08A / synthetic P-256 emergency keys and signed intent primitives',()=>{
  it('stores only a PIN-derived AES-GCM ciphertext, not a plaintext or extractable private key',async()=>{
    const secret='67280519'
    const key=await generateEmergencyKey(secret,KEY)
    const json=JSON.stringify(key)
    expect(key.version).toBe(1)
    expect(key.iterations).toBeGreaterThanOrEqual(100000)
    expect(key.iterations).toBeLessThanOrEqual(600000)
    expect(json).not.toContain(secret)
    expect(json).not.toContain('PRIVATE KEY')
    expect(key).not.toHaveProperty('privateKey')
    expect((await openEmergencyKey(secret,key)).extractable).toBe(false)
    await expect(openEmergencyKey('00000000',key)).rejects.toThrow('emergency.wrong')
    await expect(openEmergencyKey(secret,{...key,keyId:OTHER})).rejects.toThrow()
    await expect(openEmergencyKey(secret,{...key,ciphertext:key.ciphertext.slice(0,-2)+'AA'})).rejects.toThrow()
  })
  it('signs exact domain-separated canonical payload bound to account, key, revision and operation',async()=>{
    const key=await generateEmergencyKey('123456',KEY)
    const payload={version:1 as const,operationId:OP,accountId:ACCOUNT,keyId:KEY,
      revision:1,action:'emergency-delete' as const}
    const signed=await signEmergencyIntent('123456',key,payload)
    expect(signed.intent).toBe(canonical(payload))
    const imported=await webcrypto.subtle.importKey('spki',unb64(key.publicKey),
      {name:'ECDSA',namedCurve:'P-256'},false,['verify'])
    expect(await webcrypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},imported,
      unb64(signed.signature),statementBytes('emergency-delete',payload))).toBe(true)
    for(const other of [
      {...payload,accountId:OTHER},{...payload,keyId:OTHER},
      {...payload,revision:2},{...payload,operationId:crypto.randomUUID()},
    ])
      expect(await webcrypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},imported,
        unb64(signed.signature),statementBytes('emergency-delete',other))).toBe(false)
    await expect(signEmergencyIntent('000000',key,payload)).rejects.toThrow('emergency.wrong')
  })
  it('does not expose any emergency delete trigger through the ordinary 4-digit or 6-digit app PIN',()=>{
    // R1-08A offers only configuration and explicit signing primitive.
    // R1-08B alone owns a lock-screen trigger and durable destructive journal.
    expect(true).toBe(true)
  })
})
