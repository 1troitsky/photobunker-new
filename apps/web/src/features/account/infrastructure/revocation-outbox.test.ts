import 'fake-indexeddb/auto'
import {beforeEach,describe,expect,it,vi} from 'vitest'
const {session,submit,verify,forgot}=vi.hoisted(()=>({
  session:{value:{accountId:'00000000-0000-4000-8000-000000000001',
    deviceId:'00000000-0000-4000-8000-000000000002',offline:false}},
  submit:vi.fn(),
  verify:vi.fn(async()=>{}),
  forgot:vi.fn(),
}))
vi.mock('../../identity',()=>({
  identity:session,
  signOwnRevocationIntent:async(operationId:string,intent:string)=>({
    accountId:session.value.accountId,deviceId:session.value.deviceId,
    intent,operationId,signature:'fake-signed-credential',
  }),
  submitSignedRevocationIntent:submit,
  forgetRuntime:forgot,
}))
vi.mock('./device-pin',()=>({verifyDevicePin:verify}))
import {stageRevocationIntent,pendingDeviceRevocations,deliverPendingRevocations} from './revocation-outbox'
async function clearDB(){
  await new Promise<void>((resolve,reject)=>{
    const req=indexedDB.deleteDatabase('pb2-revocation-outbox-v1')
    req.onsuccess=()=>resolve()
    req.onerror=()=>reject(req.error)
    req.onblocked=()=>reject(Error('test.db_blocked'))
  })
}
async function hash(row:{accountId:string;deviceId:string;intent:string;operationId:string}){
  const encoded=JSON.stringify({
    accountId:row.accountId,deviceId:row.deviceId,
    intent:row.intent,operationId:row.operationId,
  })
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(encoded)))]
    .map(value=>value.toString(16).padStart(2,'0')).join('')
}
beforeEach(async()=>{
  submit.mockReset();forgot.mockReset();verify.mockClear()
  session.value={accountId:'00000000-0000-4000-8000-000000000001',
    deviceId:'00000000-0000-4000-8000-000000000002',offline:false}
  await clearDB()
})
describe('G5 immutable device revocation outbox',()=>{
  it('never stages without consent; staging makes no server call',async()=>{
    await expect(stageRevocationIntent('emergency','12345678',false))
      .rejects.toThrow('revoke.explicit_consent_required')
    expect(await pendingDeviceRevocations()).toHaveLength(0)
    const row=await stageRevocationIntent('emergency','12345678',true)
    expect(row.state).toBe('pending')
    expect(submit).not.toHaveBeenCalled()
    expect(await pendingDeviceRevocations()).toHaveLength(1)
    await expect(stageRevocationIntent('local-delete','12345678',true))
      .rejects.toThrow('revoke.already_pending')
  })
  it('does not invent ACK on timeout, then recovers exact signed receipt',async()=>{
    const row=await stageRevocationIntent('local-delete','12345678',true)
    submit.mockRejectedValueOnce(Error('network_timeout'))
    expect(await deliverPendingRevocations()).toEqual({acknowledged:0,pending:1})
    const receipt={accountId:row.accountId,deviceId:row.deviceId,operationId:row.operationId,
      intent:row.envelope.intent,payloadHash:await hash(row.envelope),state:'revoked',
      committedAt:'2026-10-31T15:00:00.000Z'}
    submit.mockResolvedValueOnce(receipt)
    expect(await deliverPendingRevocations()).toEqual({acknowledged:1,pending:0})
    expect(submit).toHaveBeenCalledTimes(2)
    expect(submit.mock.calls[0]![0]).toEqual(submit.mock.calls[1]![0])
    expect(forgot).toHaveBeenCalledOnce()
  })
  it('does not accept a mismatched receipt',async()=>{
    const row=await stageRevocationIntent('emergency','12345678',true)
    submit.mockResolvedValueOnce({accountId:row.accountId,deviceId:row.deviceId,
      operationId:row.operationId,intent:row.envelope.intent,
      payloadHash:'0'.repeat(64),state:'revoked',
      committedAt:'2026-10-31T15:00:00.000Z'})
    expect(await deliverPendingRevocations()).toEqual({acknowledged:0,pending:1})
    expect(forgot).not.toHaveBeenCalled()
  })
})
