import {describe,it,expect} from 'vitest'
import {validateFields,nextStatus,steps,policySnapshot} from './model'
describe('R2-08: Assignment domain rules',()=>{
  it('rejects mode 1, out-of-range TTL and malformed private fields',()=>{
    expect(validateFields({title:'  Private work ',instructions:'',mode:3,retentionDays:45}).title)
      .toBe('Private work')
    expect(()=>validateFields({title:'',instructions:'',mode:3,retentionDays:45})).toThrow()
    expect(()=>validateFields({title:'x'.repeat(81),instructions:'',mode:3,retentionDays:45})).toThrow()
    expect(()=>validateFields({title:'Valid',instructions:'x'.repeat(4001),mode:3,retentionDays:45})).toThrow()
    for(const ttl of [0,46,1.5,-1]){
      expect(()=>validateFields({title:'Valid',instructions:'',mode:2,retentionDays:ttl})).toThrow()
    }
    expect(()=>validateFields({title:'Valid',instructions:'',mode:1 as 2,retentionDays:45})).toThrow()
  })
  it('validates encrypted planning dates and photo targets',()=>{
    const base={title:'Work',instructions:'',mode:3 as const,retentionDays:45}
    expect(validateFields({...base,startsAt:'2026-10-31',finishesAt:'2026-11-02',targetCount:5}))
      .toMatchObject({startsAt:'2026-10-31',finishesAt:'2026-11-02',targetCount:5})
    expect(validateFields(base)).toMatchObject({startsAt:null,finishesAt:null,targetCount:null})
    for(const targetCount of [0,-1,10000,2.5])
      expect(()=>validateFields({...base,targetCount})).toThrow('assignment.target_invalid')
    for(const dates of [
      {startsAt:'2026-02-30'},
      {startsAt:'2026-11-02',finishesAt:'2026-11-01'},
      {finishesAt:'tomorrow'},
    ])expect(()=>validateFields({...base,...dates})).toThrow('assignment.dates_invalid')
  })
  it('accepts exactly the five authorized transitions, completed terminal',()=>{
    const accepted=[['waiting','in_progress'],['in_progress','submitted'],
      ['submitted','needs_changes'],['submitted','completed'],['needs_changes','in_progress']] as const
    for(const [a,b] of accepted)expect(()=>nextStatus(a,b)).not.toThrow()
    for(const source of Object.keys(steps) as (keyof typeof steps)[]){
      for(const target of Object.keys(steps) as (keyof typeof steps)[]){
        if(!accepted.some(([a,b])=>a===source&&b===target)){
          expect(()=>nextStatus(source,target)).toThrow()
        }
      }
    }
  })
  it('exports frozen future-capture policy with independent policy revision',()=>{
    const snapshot=policySnapshot({id:'task-id',title:'x',instructions:'',
      status:'waiting',revision:5,policyRevision:2,mode:2,retentionDays:1,
      sync:'local',createdAt:null,updatedAt:null})
    expect(snapshot).toEqual({assignmentId:'task-id',assignmentRevision:5,
      policyRevision:2,mode:2,retentionDays:1})
  })
})
