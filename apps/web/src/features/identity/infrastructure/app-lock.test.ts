import 'fake-indexeddb/auto'
import {afterAll,beforeEach,describe,expect,it} from 'vitest'
import {appLockState,assertAppUnlocked,configureAppPin,lockApp,
  onAppLockInvalidate,prepareAppLock,resetAppLock,unlockAppPin} from './app-lock'

const account='00000000-0000-4000-8000-000000001100'
const device='00000000-0000-4000-8000-000000001101'
let counter=0
beforeEach(()=>{resetAppLock();onAppLockInvalidate(()=>{});counter++})
afterAll(()=>resetAppLock())
describe('PB2 App Lock PIN identity barrier',()=>{
  it('keeps the device locked after reload until the PIN is verified',async()=>{
    const dev=device+'-'+counter
    await prepareAppLock(account,dev)
    expect(appLockState.value.locked).toBe(false)
    await configureAppPin('12345678')
    lockApp()
    expect(()=>assertAppUnlocked()).toThrow('pin.locked')
    resetAppLock()
    await prepareAppLock(account,dev)
    expect(appLockState.value.configured).toBe(true)
    expect(appLockState.value.locked).toBe(true)
    await unlockAppPin('12345678')
    expect(()=>assertAppUnlocked()).not.toThrow()
  })
  it('wrong attempts remain locked; successful PIN never wipes identity keys',async()=>{
    const dev=device+'-'+counter
    await prepareAppLock(account,dev)
    await configureAppPin('87654321')
    let revoked=0
    onAppLockInvalidate(()=>{revoked++})
    lockApp()
    expect(revoked).toBe(1)
    await expect(unlockAppPin('11111111')).rejects.toThrow('pin.invalid')
    expect(appLockState.value.locked).toBe(true)
    await unlockAppPin('87654321')
    expect(appLockState.value.locked).toBe(false)
  })
  it('three failed PIN attempts enforce a cooldown even for a later correct PIN',async()=>{
    const dev=device+'-'+counter
    await prepareAppLock(account,dev)
    await configureAppPin('44556677')
    lockApp()
    for(let i=0;i<3;i++){
      await expect(unlockAppPin('00000000')).rejects.toThrow('pin.invalid')
    }
    await expect(unlockAppPin('44556677')).rejects.toThrow('pin.cooldown')
    expect(appLockState.value.locked).toBe(true)
  })
  it('other account or device cannot inherit an unlocked gate',async()=>{
    await prepareAppLock(account,device+'-'+counter)
    await configureAppPin('11223344')
    await prepareAppLock(account,'new-device-'+counter)
    expect(appLockState.value.configured).toBe(false)
    await prepareAppLock('other-account-'+counter,device+'-'+counter)
    expect(appLockState.value.configured).toBe(false)
  })
})
