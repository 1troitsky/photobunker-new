import 'fake-indexeddb/auto'
import {beforeEach,describe,expect,it,vi} from 'vitest'
const mock=vi.hoisted(()=>({
  account:{value:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},
  keys:new Map<string,CryptoKey>(),
}))
vi.mock('../../identity',()=>({
  acquireStorageKeys:()=>({
    scope:{accountId:mock.account.value,deviceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',generation:1},
    check:()=>{},
    create:async(id:string)=>{
      const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt'])
      mock.keys.set(mock.account.value+'/'+id,key as CryptoKey)
      return{key,wrapped:{iv:'aWdub3Jl',ciphertext:'ZW5jcnlwdGVk'}}
    },
    open:async(id:string)=>{
      const key=mock.keys.get(mock.account.value+'/'+id)
      if(!key)throw Error('key_not_found')
      return key
    },
  }),
}))
import {assignmentDb} from '../infrastructure/database'
import {openAssignments} from './repository'
describe('R2-08 local encrypted aggregate / durable assignment outbox',()=>{
  beforeEach(async()=>{
    mock.account.value='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    mock.keys.clear()
    await Promise.all([assignmentDb.assignments.clear(),assignmentDb.operations.clear(),assignmentDb.tombstones.clear()])
  })
  it('encrypts text before indexedDB commit; offline edit/transition uses sequential stable operations',async()=>{
    const repository=openAssignments()
    const item=await repository.create({title:'Top secret assignment',instructions:'Private instructions',
      mode:3,retentionDays:45})
    expect(item.sync).toBe('local')
    const raw=await assignmentDb.assignments.get(mock.account.value+'/'+item.id)
    expect(JSON.stringify(raw)).not.toContain('Top secret assignment')
    expect(JSON.stringify(raw)).not.toContain('Private instructions')
    const changed=await repository.edit(item.id,{title:'Updated secret',instructions:'Sensitive note',
      mode:2,retentionDays:1})
    expect(changed.revision).toBe(2)
    expect(changed.policyRevision).toBe(2)
    const started=await repository.transition(item.id,'in_progress')
    expect(started.revision).toBe(3)
    expect(started.policyRevision).toBe(2)
    const saved=await openAssignments().get(item.id)
    expect(saved.title).toBe('Updated secret')
    expect(saved.status).toBe('in_progress')
    const operations=await repository.pending()
    expect(operations).toHaveLength(3)
    expect(operations.map(op=>op.contract.expectedRevision)).toEqual([0,1,2])
    expect(new Set(operations.map(op=>op.operationId)).size).toBe(3)
    expect(JSON.stringify(operations)).not.toContain('Updated secret')
    expect(JSON.stringify(operations)).not.toContain('Sensitive note')
  })
  it('enforces valid transitions; offline delete prevents resurrection and hides on reload',async()=>{
    const repository=openAssignments()
    const created=await repository.create({title:'Private',instructions:'',mode:3,retentionDays:45})
    await expect(repository.transition(created.id,'completed')).rejects.toThrow('assignment.invalid_transition')
    expect((await repository.pending())).toHaveLength(1)
    await repository.remove(created.id)
    expect(await repository.list()).toHaveLength(0)
    await expect(openAssignments().get(created.id)).rejects.toThrow('assignment.deleted')
    expect((await repository.pending()).map(x=>x.contract.action)).toEqual(['create','delete'])
  })
  it('keeps account A encrypted rows invisible under B scope',async()=>{
    const fromA=await openAssignments().create({title:'Only account A',instructions:'',
      mode:3,retentionDays:45})
    mock.account.value='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const fromB=openAssignments()
    expect(await fromB.list()).toEqual([])
    await expect(fromB.get(fromA.id)).rejects.toThrow('assignment.not_found')
    expect(await fromB.pending()).toEqual([])
  })
})
