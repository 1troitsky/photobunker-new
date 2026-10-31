import {describe,expect,it} from 'vitest'
import {classifyLocalRecord,summarizeOwnership,type LocalOwnershipRow} from './ownership'
const account='account-1',device='device-a'
const row=(kind:LocalOwnershipRow['kind'],extra:Partial<LocalOwnershipRow>={}):LocalOwnershipRow=>({
  kind,accountId:account,referenced:true,pending:false,...extra,
})
describe('G5 local ownership / destructive allowlist',()=>{
  it('holds all account-scoped encrypted photos, assets, blobs and outbox even when remotely ACKed',()=>{
    for(const kind of ['photo','asset','blob','outbox','tombstone','thumbnail-cache'] as const){
      const result=classifyLocalRecord(row(kind))
      expect(result.scope).toBe('account-shared')
      expect(result.eligibility).toBe('hold')
    }
  })
  it('journal deviceId proves producer identity, not safe file ownership',()=>{
    const result=classifyLocalRecord(row('journal',{deviceId:device}))
    expect(result.scope).toBe('device-scoped')
    expect(result.eligibility).toBe('hold')
  })
  it('never erases device name reservation that can be sole offline copy',()=>{
    expect(classifyLocalRecord(row('name-lease',{deviceId:device})).eligibility).toBe('hold')
  })
  it('only treats a nonpending device clock as derived, not as recovered ciphertext',()=>{
    expect(classifyLocalRecord(row('trusted-clock',{deviceId:device})).eligibility).toBe('post-revoke-derived')
    expect(classifyLocalRecord(row('trusted-clock',{deviceId:device,pending:true})).eligibility).toBe('hold')
    expect(classifyLocalRecord(row('trusted-clock')).eligibility).toBe('hold')
  })
  it('treats unknown owner and any pending record as held',()=>{
    expect(classifyLocalRecord(row('asset',{accountId:''})).eligibility).toBe('hold')
    expect(classifyLocalRecord(row('photo',{pending:true})).eligibility).toBe('hold')
  })
  it('summarizes without returning erasure authorization',()=>{
    const result=summarizeOwnership([
      row('asset'),row('journal',{deviceId:device,pending:true}),
      row('trusted-clock',{deviceId:device}),row('name-lease',{deviceId:device}),
    ])
    expect(result).toEqual({total:4,accountShared:1,deviceScoped:2,
      unattributed:1,held:3,postRevokeDerived:1,pending:1})
  })
})
