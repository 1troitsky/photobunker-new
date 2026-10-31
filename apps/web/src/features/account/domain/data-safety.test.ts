import {describe,expect,it} from 'vitest'
import {assessLocalDeletion} from './data-safety'
const photos=[
  {photoId:'a',expiresAt:2000,state:'local' as const},
  {photoId:'b',expiresAt:2000,state:'synced' as const},
]
describe('G5 device-data safety gate',()=>{
  it('never treats synced rows as proof of recoverability',()=>{
    const result=assessLocalDeletion([photos[1]!],[],true,true)
    expect(result.permitted).toBe(false)
    expect(result.blockingReasons).toContain('remote_recovery_not_proven')
    expect(result.blockingReasons).toContain('device_erase_not_implemented')
  })
  it('reports the only unsynced copy and pending delivery',()=>{
    const result=assessLocalDeletion(photos,[{intent:'upload',state:'retry'}],true,true)
    expect(result.photoCount).toBe(2)
    expect(result.unconfirmedCount).toBe(1)
    expect(result.outboxCount).toBe(1)
    expect(result.blockingReasons).toContain('local_copies_unconfirmed')
    expect(result.blockingReasons).toContain('operations_pending')
  })
  it('refuses offline/untrusted-time conditions',()=>{
    const result=assessLocalDeletion([],[],false,false)
    expect(result.blockingReasons).toEqual(expect.arrayContaining(['offline','time_untrusted']))
    expect(result.permitted).toBe(false)
  })
  it('never authorizes erase even after a claimed independent restore',()=>{
    const result=assessLocalDeletion([],[],true,true,true)
    expect(result.permitted).toBe(false)
    expect(result.blockingReasons).toEqual(['device_erase_not_implemented'])
  })
})
