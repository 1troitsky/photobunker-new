import {describe,expect,it} from 'vitest'
import {assignmentPolicy,snapshot} from './policy'
import {signedContract} from '../../photo-sync'
import type {SyncSnapshot} from '../../local-storage'
const s=()=>({assignmentId:'123e4567-e89b-42d3-a456-426614174000',
  assignmentRevision:3,policyRevision:2,mode:3 as const,retentionDays:7})
describe('R2-10 frozen assignment capture',()=>{
  it('records immutable mode/revision and expires from trusted capture timestamp',()=>{
    const policy=assignmentPolicy(s()),at=1_795_000_000_000
    const meta=snapshot(policy,at,{width:1200,height:800},{width:1200,height:800},'video-frame')
    expect(meta.policy).toEqual({policyVersion:1,source:'assignment',assignmentId:s().assignmentId,
      assignmentRevision:3,policyRevision:2,mode:3,ttlDays:7})
    expect(meta.expiresAt).toBe(at+7*86400000)
    expect(Object.isFrozen(meta.policy)).toBe(true)
    expect(()=>assignmentPolicy({...s(),mode:1 as unknown as 3})).toThrow()
    expect(()=>assignmentPolicy({...s(),retentionDays:46})).toThrow()
  })
  it('puts signed capture context only in v2, never rewrites personal contract',()=>{
    const base:SyncSnapshot={photoId:crypto.randomUUID(),operationId:crypto.randomUUID(),
      expiresAt:1795000000000,assets:[]}
    expect(JSON.parse(signedContract(base)).version).toBe(1)
    const capture={...s(),capturedAt:1795000000000}
    const version=JSON.parse(signedContract({...base,capture}))
    expect(version.version).toBe(2)
    expect(version.capture).toEqual(capture)
    expect(version.assets).toEqual([])
    expect(signedContract(base)).not.toContain('assignmentId')
  })
})
