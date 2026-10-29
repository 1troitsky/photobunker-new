import {describe,it,expect} from 'vitest'
import {command,validateServerGrant,type ServerGrant} from './grants'
const id=()=>crypto.randomUUID()
const row=():ServerGrant=>({
  grantId:id(),assignmentId:id(),ownerId:id(),recipientId:id(),
  role:'contributor',state:'pending',generation:1,inviteExpiresAt:Date.now()+20000,
  codeHash:'f'.repeat(64),sealedKey:{v:1,iv:'A'.repeat(16),ciphertext:'A'.repeat(64)},
})
describe('assignment grant commands never contain invite code or local transport secret',()=>{
  it('creates exact, signed-command-ready recipient acceptance with generation CAS',()=>{
    const invitation=validateServerGrant(row())
    const c=command('accept',invitation)
    expect(Object.keys(c)).toEqual(['v','opId','kind','grantId','assignmentId',
      'targetId','role','expectedGeneration','expiresAt','codeHash','sealedKey'])
    expect(c.expectedGeneration).toBe(1)
    expect(c.targetId).toBeNull()
    expect(c.sealedKey).toBeNull()
    expect(c.codeHash).toBeNull()
    expect(JSON.stringify(c)).not.toContain(invitation.codeHash!)
  })
  it('rejects counterfeit role/generation/scope before rendering an invite',()=>{
    const base=row()
    expect(()=>validateServerGrant({...base,role:'owner' as never})).toThrow()
    expect(()=>validateServerGrant({...base,generation:-1})).toThrow()
    expect(()=>validateServerGrant({...base,recipientId:'invalid'})).toThrow()
  })
})
