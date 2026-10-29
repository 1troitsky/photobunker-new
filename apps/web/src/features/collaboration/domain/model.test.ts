import {describe,expect,it} from 'vitest'
import {emptyContract,mayInvite,mayManage,mayManageMember,validateProfile} from './model'
describe('R2-09 role and private profile contracts',()=>{
  it('allows only owner or properly scoped curator to invite',()=>{
    expect(mayInvite('owner','curator')).toBe(true)
    expect(mayInvite('curator','curator')).toBe(false)
    expect(mayInvite('curator','viewer')).toBe(true)
    expect(mayInvite('contributor','viewer')).toBe(false)
    expect(mayManage('viewer')).toBe(false)
    expect(mayManageMember('curator','curator','viewer')).toBe(false)
    expect(mayManageMember('owner','curator','contributor')).toBe(true)
    expect(mayManageMember('owner','owner',undefined)).toBe(false)
  })
  it('bounds encrypted-only profile input and normalizes text',()=>{
    expect(validateProfile({name:' A ',description:' Detail ',avatar:null})).toEqual({
      name:'A',description:'Detail',avatar:null,
    })
    expect(()=>validateProfile({name:'',description:'',avatar:null})).toThrow()
    expect(()=>validateProfile({name:'a'.repeat(81),description:'',avatar:null})).toThrow()
    expect(()=>validateProfile({name:'A',description:'x'.repeat(1001),avatar:null})).toThrow()
    expect(()=>validateProfile({name:'A',description:'',avatar:'https://remote.example/p.png'})).toThrow()
  })
  it('produces a fixed operation envelope, no inherited photo grants',()=>{
    const command=emptyContract('team_create')
    expect(command).toEqual({v:1,opId:expect.any(String),kind:'team_create',teamId:null,
      targetId:null,role:null,expectedRevision:null,profile:null,inviteId:null,codeHash:null,sealedKey:null})
    expect(JSON.stringify(command)).not.toMatch(/photo|metadata|share/)
  })
})
