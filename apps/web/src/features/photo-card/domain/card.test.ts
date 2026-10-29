import {describe,expect,it} from 'vitest'
import {personalPolicy,assignmentPolicy,snapshot} from '../../camera'
import type {PhotoHeader} from '../../local-storage'
import {privateCard} from './card'

const base:PhotoHeader={
  accountId:'owner',photoId:'photo',assetId:'asset',metadataAssetId:'metadata',
  expiresAt:1000+86400000,revision:1,operationId:'op',state:'local',
  nameId:'ABCD0001',
}
describe('PB2 local private Photo Card projection',()=>{
  it('projects title and metadata but does not invent sharing permissions',()=>{
    const meta={...snapshot(personalPolicy(3,1),1000,
      {width:1200,height:800},{width:1200,height:800},'image-capture'),title:'Test'}
    expect(privateCard(base,meta,'local')).toMatchObject({
      title:'Test',nameId:'ABCD0001',mode:3,assignmentId:null,gps:null,
    })
  })
  it('rejects expiry mismatches and cannot reinterpret assignment photos as personal',()=>{
    const meta=snapshot(personalPolicy(3,1),1000,{width:1,height:1},
      {width:1,height:1},'image-capture')
    expect(()=>privateCard({...base,expiresAt:7},meta,'local'))
      .toThrow('photo_card.metadata_conflict')
    const capture={assignmentId:'00000000-0000-4000-8000-000000000001',
      assignmentRevision:1,policyRevision:1,mode:3 as const,
      retentionDays:1,capturedAt:1000}
    expect(()=>privateCard({...base,capture},meta,'local'))
      .toThrow('photo_card.policy_conflict')
  })
  it('projects the exact frozen capture assignment',()=>{
    const policy=assignmentPolicy({assignmentId:'00000000-0000-4000-8000-000000000001',
      assignmentRevision:2,policyRevision:1,mode:2,retentionDays:1})
    const meta=snapshot(policy,1000,{width:100,height:100},
      {width:100,height:100},'video-frame')
    const capture={assignmentId:policy.assignmentId,assignmentRevision:2,
      policyRevision:1,mode:2 as const,retentionDays:1,capturedAt:1000}
    expect(privateCard({...base,capture},meta,'synced').assignmentId).toBe(policy.assignmentId)
    expect(()=>privateCard({...base,capture:{...capture,policyRevision:5}},meta,'synced'))
      .toThrow('photo_card.policy_conflict')
  })
})
