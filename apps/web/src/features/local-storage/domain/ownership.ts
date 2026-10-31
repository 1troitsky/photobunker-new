/**
 * G5 local ownership rules. Account-scoped ciphertext MUST NOT be interpreted
 * as belonging to one device just because a device produced the journal.
 *
 * This module only classifies/blocks. Never returns deletion authorization.
 */
export type LocalRecordKind=
  |'photo'|'asset'|'blob'|'outbox'|'journal'|'tombstone'
  |'name-lease'|'thumbnail-cache'|'trusted-clock'
export type OwnershipScope='account-shared'|'device-scoped'|'unattributed'
export type EraseEligibility='hold'|'post-revoke-derived'
export type OwnershipClassification=Readonly<{
  kind:LocalRecordKind;scope:OwnershipScope;eligibility:EraseEligibility;
  reason:string
}>
export type LocalOwnershipRow=Readonly<{
  kind:LocalRecordKind;accountId:string;deviceId?:string
  referenced:boolean;pending:boolean
}>
export type OwnershipSummary=Readonly<{
  total:number;accountShared:number;deviceScoped:number;unattributed:number;
  held:number;postRevokeDerived:number;pending:number
}>
/** Conservative allowlist: ONLY a device-bound trusted clock snapshot may
 * eventually be cleared after the exact matching server revoke receipt.
 * Neither account-wide ciphertext nor opaque journals are eligible.
 */
export function classifyLocalRecord(row:LocalOwnershipRow):OwnershipClassification{
  if(!row.accountId||row.pending)return {
    kind:row.kind,scope:'unattributed',eligibility:'hold',reason:'incomplete_or_pending',
  }
  if(row.kind==='trusted-clock'&&row.deviceId)return {
    kind:row.kind,scope:'device-scoped',eligibility:'post-revoke-derived',
    reason:'device_local_trusted_clock_only',
  }
  if(row.kind==='journal')return {
    kind:row.kind,scope:row.deviceId?'device-scoped':'unattributed',
    eligibility:'hold',reason:'crash_journal_may_reference_unique_ciphertext',
  }
  if(row.kind==='name-lease')return {
    kind:row.kind,scope:row.deviceId?'device-scoped':'unattributed',
    eligibility:'hold',reason:'offline_name_reservation_or_unique_pending_state',
  }
  if(row.kind==='photo'||row.kind==='asset'||row.kind==='blob'||
    row.kind==='outbox'||row.kind==='tombstone'||row.kind==='thumbnail-cache')
    return {kind:row.kind,scope:'account-shared',eligibility:'hold',
      reason:row.referenced?'account_shared_reference':'unproven_ciphertext_recoverability'}
  return {kind:row.kind,scope:'unattributed',eligibility:'hold',reason:'unknown_owner'}
}
export function summarizeOwnership(rows:readonly LocalOwnershipRow[]):OwnershipSummary{
  const classified=rows.map(classifyLocalRecord)
  return{
    total:classified.length,
    accountShared:classified.filter(c=>c.scope==='account-shared').length,
    deviceScoped:classified.filter(c=>c.scope==='device-scoped').length,
    unattributed:classified.filter(c=>c.scope==='unattributed').length,
    held:classified.filter(c=>c.eligibility==='hold').length,
    postRevokeDerived:classified.filter(c=>c.eligibility==='post-revoke-derived').length,
    pending:rows.filter(r=>r.pending).length,
  }
}
