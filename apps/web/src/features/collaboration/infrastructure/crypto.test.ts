import {describe,expect,it} from 'vitest'
import {profileSeal,profileOpen,inviteSeal,inviteOpen} from './crypto'
describe('R2-09 team encryption and invitation grant boundary',()=>{
  it('encrypts private team profile bound to team ID and revision',async()=>{
    const secret=crypto.getRandomValues(new Uint8Array(32))
    const first=crypto.randomUUID(),profile={name:'Confidential',description:'Protected member list',avatar:null}
    const wrapped=await profileSeal(first,1,secret,profile)
    expect(JSON.stringify(wrapped)).not.toContain(profile.name)
    expect(await profileOpen(first,1,secret,wrapped)).toEqual(profile)
    await expect(profileOpen(first,2,secret,wrapped)).rejects.toThrow()
    await expect(profileOpen(crypto.randomUUID(),1,secret,wrapped)).rejects.toThrow()
  })
  it('requires the out-of-band code to unwrap an invitation, no bare key on server',async()=>{
    const secret=crypto.getRandomValues(new Uint8Array(32))
    const team=crypto.randomUUID(),invite=crypto.randomUUID(),recipient=crypto.randomUUID()
    const {code,codeHash,sealedKey}=await inviteSeal(secret,team,invite,recipient)
    expect(JSON.stringify({codeHash,sealedKey})).not.toContain(code)
    expect([...await inviteOpen(code,team,invite,recipient,codeHash,sealedKey)]).toEqual([...secret])
    await expect(inviteOpen(code,team,invite,crypto.randomUUID(),codeHash,sealedKey)).rejects.toThrow()
    await expect(inviteOpen('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',team,invite,recipient,codeHash,sealedKey)).rejects.toThrow()
  })
})
