import {describe,expect,it,vi,beforeEach} from 'vitest'
const {active,app,action}=vi.hoisted(()=>({
  active:{value:null as {accountId:string;deviceId:string}|null},
  app:vi.fn(async()=>{}),action:vi.fn(async()=>{}),
}))
vi.mock('../../identity',()=>({identity:active,removeRevokedDeviceAppPin:app}))
vi.mock('./device-pin',()=>({removeRevokedDeviceActionPins:action}))
vi.mock('../../local-storage',()=>({
  inspectPhotoStoreCounts:async()=>({photoCipherAssets:8,photoJournals:2,photoOutbox:3}),
  scanLocalOwnership:async()=>({disposition:'hold_ciphertext',summary:{total:8,held:8}}),
}))
vi.mock('../../assignments',()=>({inspectAssignmentPending:async()=>4}))
vi.mock('../../collaboration',()=>({inspectCollaborationPending:async()=>5}))
vi.mock('../../photo-grants',()=>({inspectGrantStoreCounts:async()=>({
  grantPending:6,encryptedGrants:7,
})}))
import {cleanupRevokedDeviceVerifiers,retainedEncryptedData} from './device-cleanup'
const account='00000000-0000-4000-8000-000000000001'
const device='00000000-0000-4000-8000-000000000002'
beforeEach(()=>{active.value=null;app.mockClear();action.mockClear()})
describe('G5 credential-only cleanup boundary',()=>{
  it('fails closed on still-active same-device Identity',async()=>{
    active.value={accountId:account,deviceId:device}
    await expect(cleanupRevokedDeviceVerifiers(account,device))
      .rejects.toThrow('cleanup.active_device')
    expect(app).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()
  })
  it('performs only two scoped verifier operations after Identity suspension',async()=>{
    active.value={accountId:account,deviceId:'different-device'}
    await cleanupRevokedDeviceVerifiers(account,device)
    expect(app).toHaveBeenCalledWith(account,device)
    expect(action).toHaveBeenCalledWith(account,device)
  })
  it('retains account encrypted assets and every pending queue for independent review',async()=>{
    const report=await retainedEncryptedData(account,device)
    expect(report).toEqual({
      photoCipherAssets:8,photoJournals:2,photoPending:3,
      assignmentPending:4,teamPending:5,sharePending:6,
      encryptedGrantSecrets:7,
      ownership:{disposition:'hold_ciphertext',summary:{total:8,held:8}},
    })
  })
})
