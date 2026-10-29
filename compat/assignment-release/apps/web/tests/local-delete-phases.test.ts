import { describe, expect, it } from 'vitest'
import { replayLocalDeletion, type DeleteTarget } from '../src/app/local-delete-phases'
import type { LocalDeleteJournal } from '../src/app/local-delete-store'

// SYNTHETIC ONLY: no IndexedDB, real credentials, browser profile or server data.
const A='11111111-1111-4111-8111-111111111111'
const B='22222222-2222-4222-8222-222222222222'
const DEVICE_A='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const DEVICE_B='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
function fixture() {
  let journal:LocalDeleteJournal|undefined={
    operationId:'99999999-9999-4999-8999-999999999999',
    accountId:A,deviceId:DEVICE_A,phase:'committed',startedAt:1234,
  }
  const store=new Map<string,string>([
    [A+':'+DEVICE_A,'encrypted-photo-and-message-synthetic'],
    [B+':'+DEVICE_B,'account-B-synthetic-data'],
  ])
  const revoked:string[]=[]
  let locked=false, signout=false, success=false
  let failAt=''
  const run=async()=> {
    if(!journal)return
    await replayLocalDeletion(journal,{
      lock:()=>{locked=true},
      signedOut:({owner,device})=>{
        expect(owner).toBe(A);expect(device).toBe(DEVICE_A)
        signout=true
      },
      purge:async({owner,device}:DeleteTarget)=>{
        if(!signout)throw Error('signed-out marker missing')
        store.delete(owner+':'+device)
        if(failAt==='during-purge'){failAt='';throw Error('synthetic crash in purge')}
      },
      serverLogout:async({owner,device})=>{
        if(store.has(owner+':'+device))throw Error('local cleanup unfinished')
        revoked.push(owner+':'+device)
        if(failAt==='during-logout'){failAt='';throw Error('synthetic lost ACK')}
      },
      advance:async(from,to,operationId)=>{
        if(!journal || journal.phase!==from || journal.operationId!==operationId)
          throw Error('CAS mismatch')
        journal={...journal,phase:to}
        if(failAt===to){failAt='';throw Error('synthetic crash after commit '+to)}
      },
      finish:async operationId=>{
        if(!journal || journal.operationId!==operationId || journal.phase!=='server-logout')
          throw Error('finish without durable server-logout')
        journal=undefined
        success=true
      },
    })
  }
  return {run,store,revoked,
    crashAt:(phase:string)=>{failAt=phase},
    result:()=>({journal,locked,signout,success})}
}
describe('R1-07 crash-safe destructive journal, synthetic scopes only',()=>{
  it.each(['signed-out','during-purge','local-purged','during-logout','server-logout'])(
    'never damages account B and resumes the same operation after crash at %s',
    async crash=>{
      const f=fixture()
      f.crashAt(crash)
      await expect(f.run()).rejects.toThrow()
      expect(f.result().success).toBe(false)
      expect(f.store.get(B+':'+DEVICE_B)).toBe('account-B-synthetic-data')
      expect(f.result().journal?.operationId).toBe('99999999-9999-4999-8999-999999999999')
      await f.run()
      expect(f.result().journal).toBeUndefined()
      expect(f.result().locked).toBe(true)
      expect(f.result().signout).toBe(true)
      expect(f.result().success).toBe(true)
      expect(f.store.has(A+':'+DEVICE_A)).toBe(false)
      expect(f.store.get(B+':'+DEVICE_B)).toBe('account-B-synthetic-data')
      expect(f.revoked.every(x=>x===A+':'+DEVICE_A)).toBe(true)
    },
  )
  it('repeated resume is idempotent and leaves B intact',async()=>{
    const f=fixture();await f.run();await f.run();await f.run()
    expect(f.revoked).toEqual([A+':'+DEVICE_A])
    expect(f.store.get(B+':'+DEVICE_B)).toBe('account-B-synthetic-data')
  })
  it('does not report success if scoped purge fails before phase advancement',async()=>{
    const f=fixture();f.crashAt('during-purge')
    await expect(f.run()).rejects.toThrow()
    expect(f.result().journal?.phase).toBe('signed-out')
    expect(f.result().success).toBe(false)
    expect(f.store.has(B+':'+DEVICE_B)).toBe(true)
  })
})
