import { describe, expect, it } from 'vitest'
import { liveTime, retentionValid } from './time-policy'

describe('R2-04 trusted UTC, not wall clock',()=>{
  it('only monotonic validated elapsed can prove expiry (24h and 45d)',()=>{
    const server=1_800_000_000_000
    expect(liveTime(server,100,server,100+86_400_000,server+86_400_000)).toMatchObject({
      trusted:true,now:server+86_400_000,
    })
    expect(liveTime(server,100,server,100+45*86_400_000,server+45*86_400_000)).toMatchObject({
      trusted:true,now:server+45*86_400_000,
    })
    expect(retentionValid(server,server+86_400_000)).toBe(true)
    expect(retentionValid(server,server+45*86_400_000)).toBe(true)
    expect(retentionValid(server,server+86_400_000-1)).toBe(false)
    expect(retentionValid(server,server+45*86_400_000+1)).toBe(false)
  })
  it('never accepts large forward or backward jumps as proof of expiry',()=>{
    const t=1_800_000_000_000
    expect(liveTime(t,0,t,50_000,t+50_000+360_000)).toMatchObject({trusted:false,now:null,cause:'wall_jump'})
    expect(liveTime(t,0,t,50_000,t+50_000-360_000)).toMatchObject({trusted:false,now:null,cause:'wall_jump'})
    expect(liveTime(t,5_000,t,1_000,t+1_000)).toMatchObject({trusted:false,now:null,cause:'monotonic_lost'})
  })
  it('allows small diagnostic skew without advancing trusted server time from wall',()=>{
    const t=1_800_000_000_000
    const evaluated=liveTime(t,0,t,60_000,t+60_000+240_000)
    expect(evaluated.trusted).toBe(true)
    expect(evaluated.now).toBe(t+60_000)
  })
})
