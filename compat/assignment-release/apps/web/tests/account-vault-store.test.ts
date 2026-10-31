// @vitest-environment jsdom
import {webcrypto} from 'node:crypto'
import {beforeEach, expect, it, vi} from 'vitest'
import {ref} from 'vue'
const rows=vi.hoisted(()=>new Map<string,unknown>())
vi.mock('../src/crypto/database',()=>({get:vi.fn(async(key:string)=>rows.get(key)),put:vi.fn(async(key:string,value:unknown)=>rows.set(key,value)),remove:vi.fn(async(key:string)=>rows.delete(key))}))
vi.mock('../src/identity/store',()=>({account:ref<{id:string;rootKey:string}|undefined>(),deviceId:ref('synthetic-device')}))
vi.mock('../src/app/lock',()=>({appLocked:ref(false)}))
vi.mock('../src/identity/api',async original=>({...await original<typeof import('../src/identity/api')>(),identityRequest:vi.fn()}))
import {account,deviceId} from '../src/identity/store'
import {identityRequest,IdentityError} from '../src/identity/api'
import {createRoot} from '../src/identity/keys'
import {rememberAccountKey,accountKey,saveAccountSecrets,readAccountSecrets} from '../src/identity/vault'
import {sealRecovery,openRecovery,type RecoveryEnvelope} from '../src/identity/vault-crypto'
const owner='11111111-1111-4111-8111-111111111111'
let root:Awaited<ReturnType<typeof createRoot>>
beforeEach(async()=>{
 vi.stubGlobal('crypto',webcrypto);localStorage.clear();rows.clear();vi.clearAllMocks()
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name:string,callback:()=>Promise<void>)=>callback()}})
 root=await createRoot();account.value={id:owner,rootKey:root.publicKey} as never;deviceId.value='synthetic-device'
})
it('stores the one account key encrypted, bound to its account/device and unavailable after sign-out',async()=>{
 await rememberAccountKey(root.kit)
 const row=rows.get(`account-key:${owner}:synthetic-device`) as {key:CryptoKey;ciphertext:ArrayBuffer}
 expect(row.key.extractable).toBe(false);expect(new TextDecoder().decode(row.ciphertext)).not.toContain(root.kit)
 expect(await accountKey()).toBe(root.kit)
 deviceId.value='another-device';expect(await accountKey()).toBeUndefined()
 deviceId.value='synthetic-device';localStorage.setItem('pb-signed-out','true');expect(await accountKey()).toBeUndefined()
})
it('merges another device’s update after CAS conflict without replacing its newer photo key',async()=>{
 await rememberAccountKey(root.kit)
 let current=await sealRecovery(root.kit,owner,1,{version:1,photoKey:'PB4.old'}),conflicted=false
 vi.mocked(identityRequest).mockImplementation(async(_path,method,_body)=>{
  if(!method)return{envelope:current} as never
  if(!conflicted){conflicted=true;current=await sealRecovery(root.kit,owner,2,{version:1,photoKey:'PB4.new'});throw new IdentityError(409)}
  current=JSON.parse((_body as {envelope:string}).envelope);return{saved:true} as never
 })
 await saveAccountSecrets({messageKey:'synthetic-history-secret'})
 expect(current.statement.revision).toBe(3)
 expect(await openRecovery(root.kit,owner,current)).toEqual({version:1,photoKey:'PB4.new',messageKey:'synthetic-history-secret'})
 expect(JSON.stringify(vi.mocked(identityRequest).mock.calls)).not.toContain(root.kit)
})
it('refuses a server rollback instead of overwriting an established recovery package',async()=>{
 await rememberAccountKey(root.kit);rows.set(`account-recovery-revision:${owner}`,4)
 const envelope=await sealRecovery(root.kit,owner,3,{version:1,photoKey:'PB4.old'})
 vi.mocked(identityRequest).mockResolvedValue({envelope} as never)
 await expect(saveAccountSecrets({messageKey:'synthetic'})).rejects.toThrow('recovery.rollback')
 expect(vi.mocked(identityRequest).mock.calls.every(([,method])=>!method)).toBe(true)
})
it('keeps a failed upload encrypted locally and opens it with the same single key on another device',async()=>{
 await rememberAccountKey(root.kit)
 const envelope=await sealRecovery(root.kit,owner,1,{version:1,photoKey:'PB4.synthetic'})
 vi.mocked(identityRequest).mockImplementation(async(_path,method)=>{if(method)throw new TypeError('Offline');return{envelope} as never})
 await expect(saveAccountSecrets({messageKey:'synthetic-history-secret'})).rejects.toThrow('Offline')
 const pending=rows.get(`account-recovery-pending:${owner}`) as RecoveryEnvelope
 expect(JSON.stringify(pending)).not.toContain('synthetic-history-secret')
 deviceId.value='another-device';await rememberAccountKey(root.kit)
 expect((await readAccountSecrets())?.messageKey).toBe('synthetic-history-secret')
})
