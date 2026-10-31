import 'fake-indexeddb/auto'
import {beforeEach,describe,expect,it,vi} from 'vitest'
const {session,gate}=vi.hoisted(()=>({
  session:{value:null as {accountId:string;deviceId:string}|null},
  gate:{value:{ready:true,locked:false}},
}))
vi.mock('../../identity',()=>({identity:session,appLockState:gate}))
import {configureDevicePin,devicePinConfigured,verifyDevicePin,
  removeRevokedDeviceActionPins} from './device-pin'
let counter=0
beforeEach(()=>{counter++;session.value={accountId:'acct'+counter,deviceId:'device'+counter};gate.value={ready:true,locked:false}})
describe('separate PB2 destructive-action PIN verifiers (no delete authority)',()=>{
  it('persists independent credentials for distinct intents',async()=>{
    expect(await devicePinConfigured('local-delete')).toBe(false)
    await configureDevicePin('local-delete','12345678')
    expect(await devicePinConfigured('local-delete')).toBe(true)
    expect(await devicePinConfigured('emergency')).toBe(false)
    await configureDevicePin('emergency','87654321')
    await verifyDevicePin('local-delete','12345678')
    await verifyDevicePin('emergency','87654321')
    await expect(verifyDevicePin('emergency','12345678')).rejects.toThrow('pin.invalid')
  })
  it('cannot verify a PIN while Identity is locked or switched',async()=>{
    await configureDevicePin('local-delete','12345678')
    gate.value={ready:true,locked:true}
    await expect(verifyDevicePin('local-delete','12345678')).rejects.toThrow('pin.identity_locked')
    gate.value={ready:true,locked:false}
    session.value={accountId:'another',deviceId:'device'}
    expect(await devicePinConfigured('local-delete')).toBe(false)
  })
  it('post-ACK verifier cleanup does not remove another trusted device PIN',async()=>{
    const target=session.value!
    await configureDevicePin('local-delete','12345678')
    await configureDevicePin('emergency','87654321')
    await expect(removeRevokedDeviceActionPins(target.accountId,target.deviceId))
      .rejects.toThrow('pin.active_device_cleanup_forbidden')
    session.value={accountId:target.accountId,deviceId:target.deviceId+'-other'}
    await configureDevicePin('local-delete','11112222')
    await removeRevokedDeviceActionPins(target.accountId,target.deviceId)
    await removeRevokedDeviceActionPins(target.accountId,target.deviceId)
    expect(await devicePinConfigured('local-delete')).toBe(true)
    session.value=target
    expect(await devicePinConfigured('local-delete')).toBe(false)
    expect(await devicePinConfigured('emergency')).toBe(false)
  })
  it('requires eight digits and does not authorize any erase action',async()=>{
    await expect(configureDevicePin('emergency','1234')).rejects.toThrow('pin.length')
    await configureDevicePin('emergency','12345678')
    await expect(configureDevicePin('emergency','12345678')).rejects.toThrow()
  })
})
