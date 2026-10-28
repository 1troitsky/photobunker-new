import {describe,expect,it} from 'vitest'
import {COMPRESSION_V1,geometry,personalPolicy,snapshot} from './policy'
describe('R2-06 personal capture policy v1',()=>{
  it('mode 1 is unavailable, mode 3 default and 24h–45d TTL is fixed',()=>{
    expect(()=>personalPolicy(1)).toThrow('camera.mode_unavailable')
    expect(personalPolicy()).toMatchObject({policyVersion:1,mode:3,ttlDays:45,assignmentId:null})
    expect(personalPolicy(2,1).mode).toBe(2)
    for(const days of [0,46,-1,1.5])expect(()=>personalPolicy(3,days)).toThrow()
    const created=snapshot(personalPolicy(2,1),1_800_000_000_000,{width:4600,height:3000},{width:4096,height:2671},'image-capture')
    expect(created.expiresAt-created.capturedAt).toBe(86_400_000)
    expect(created.policy).toMatchObject({mode:2,ttlDays:1,policyVersion:1})
    expect(created.compression).toBe(COMPRESSION_V1)
    const max=snapshot(personalPolicy(),1_800_000_000_000,{width:4000,height:3000},{width:4000,height:3000},'video-frame')
    expect(max.expiresAt-max.capturedAt).toBe(45*86_400_000)
    expect(max.mode).toBe(3)
  })
  it('limits both edge and 12.5MP while never upscaling and retaining aspect',()=>{
    for(const [w,h] of [[5000,2500],[10000,8000],[3000,2000],[4000,3200],[1,1]]){
      const out=geometry(w,h)
      expect(out.width).toBeLessThanOrEqual(w);expect(out.height).toBeLessThanOrEqual(h)
      expect(out.width*out.height).toBeLessThanOrEqual(12_500_000)
      expect(Math.max(out.width,out.height)).toBeLessThanOrEqual(4096)
      expect(Math.abs(out.width/out.height-w/h)).toBeLessThan(.02)
    }
    expect(()=>geometry(0,100)).toThrow()
    expect(()=>geometry(-1,5)).toThrow()
    expect(COMPRESSION_V1.quality).toBe(.90)
  })
})
