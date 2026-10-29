import { describe,expect,it } from 'vitest'
import { replayEmergencyPhases } from '../src/app/emergency-phases'
import { verifyEmergencyCommand,type EmergencyCommand } from '../src/app/emergency-command'
import { emergencyWipeMatchesScope } from '../src/app/emergency-wipe'

// SYNTHETIC ONLY: no actual IndexedDB, Matrix, HTTP or user credentials.
const A='11111111-1111-4111-8111-111111111111'
const B='22222222-2222-4222-8222-222222222222'
const AD='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const BD='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
const KEY='33333333-3333-4333-8333-333333333333'
const OP='99999999-9999-4999-8999-999999999999'
const intent=JSON.stringify({accountId:A,action:'emergency-delete',keyId:KEY,
  operationId:OP,revision:1,version:1})
const signature='A'.repeat(86)
function command():EmergencyCommand {
  return {version:1,operationId:OP,accountId:A,deviceId:AD,intent,signature,
    phase:'prepared',delivery:'queued',createdAt:123456}
}
describe('R1-08B immutable intent, synthetic scopes',()=>{
  it('rejects changed account, operationId, signature and noncanonical command',()=>{
    const row=command()
    expect(verifyEmergencyCommand(row)).toBe(true)
    expect(verifyEmergencyCommand({...row,accountId:B})).toBe(false)
    expect(verifyEmergencyCommand({...row,operationId:BD})).toBe(false)
    expect(verifyEmergencyCommand({...row,intent:' '+row.intent})).toBe(false)
    expect(verifyEmergencyCommand({...row,signature:'not-a-signed-intent'})).toBe(false)
    expect(JSON.stringify(row)).not.toContain('12345678') // never persist a PIN
  })
  it('never matches synthetic account B scoped keys',()=>{
    const s={owner:A,device:AD}
    for(const [database,store,key,value] of [
      ['photobunker-identity-devices-v1','devices',BD,undefined],
      ['photobunker-app-pin-v2','records','app-pin:'+B+':'+BD,undefined],
      ['photobunker-emergency-v1','records',B+':'+BD,undefined],
      ['photobunker-message-outbox-v1','records','msg:'+B+':'+BD+':t',undefined],
      ['photobunker-encrypted-queue-v1','entries','job:'+B+':p',undefined],
      ['photobunker-encrypted-queue-v1','entries','capture-current',{accountId:B,deviceId:BD}],
      ['photobunker-team-cache-v1','scopes','team:'+B+':'+BD,undefined],
    ] as const)
      expect(emergencyWipeMatchesScope(database,store,{key,value},s)).toBe(false)
    expect(emergencyWipeMatchesScope('photobunker-emergency-v1','records',
      {key:A+':'+AD,value:undefined},s)).toBe(true)
    expect(emergencyWipeMatchesScope('photobunker-message-outbox-v1','records',
      {key:'msg:'+A+':'+AD+':tx',value:undefined},s)).toBe(true)
    expect(emergencyWipeMatchesScope('photobunker-message-storage-v1','keys',
      {key:A+':'+AD,value:undefined},s)).toBe(true)
  })
})
function fixture() {
  let row=command()
  const contents=new Map([[A+':'+AD,'synthetic-A'],[B+':'+BD,'synthetic-B']])
  const submissions: string[]=[]
  let crash='',online=false,serverState:'accepted'|'processing'|'completed'='accepted'
  let covered=false,wipeFailed=false
  async function step(){
    await replayEmergencyPhases(row,{
      lock:()=>{covered=true},
      signedOut:()=>{if(crash==='signed-out'){crash='';throw Error('crash after signed-out')}},
      invalidate:(a,d)=>{expect(a).toBe(A);expect(d).toBe(AD)},
      advance:async (operationId,from,to)=>{
        expect(operationId).toBe(OP);expect(row.phase).toBe(from)
        row={...row,phase:to}
        if(crash===to){crash='';throw Error('crash after '+to)}
        return row
      },
      purge:async (a,d)=>{
        expect(covered).toBe(true)
        contents.delete(a+':'+d)
        if(crash==='during-purge'){crash='';wipeFailed=true;throw Error('partial wipe')}
      },
      deliver:async current=>{
        expect(current.intent).toBe(intent)
        expect(current.signature).toBe(signature)
        expect(current.operationId).toBe(OP)
        submissions.push(current.intent+current.signature)
        if(crash==='lost-ack'){crash='';throw Error('synthetic HTTP ACK lost')}
        return serverState
      },
      recordDelivery:async(id,state)=>{
        expect(id).toBe(OP)
        row={...row,delivery:state}
      },
      online:()=>online,
    })
  }
  return {
    step,
    setCrash:(value:string)=>{crash=value},
    setOnline:(value:boolean)=>{online=value},
    setServer:(value:'accepted'|'processing'|'completed')=>{serverState=value},
    info:()=>({row,contents,submissions,covered,wipeFailed}),
  }
}
describe('R1-08B crash/reload/reconnect, SYNTHETIC account A/B ONLY',()=>{
  it.each(['signed-out','locked','purging','during-purge','purged'])(
    'same immutable intent and B survives crash at %s',
    async crash=>{
      const f=fixture()
      f.setCrash(crash)
      if(crash==='during-purge'){await f.step();expect(f.info().wipeFailed).toBe(true)}
      else await expect(f.step()).rejects.toThrow()
      expect(f.info().covered).toBe(true)
      expect(f.info().contents.get(B+':'+BD)).toBe('synthetic-B')
      const original=f.info().row.intent
      await f.step() // offline replay: no network, no new signature
      expect(f.info().row.phase).toBe('purged')
      f.setOnline(true)
      await f.step()
      expect(f.info().row.delivery).toBe('accepted')
      f.setServer('completed')
      await f.step()
      expect(f.info().row.delivery).toBe('completed')
      expect(f.info().row.operationId).toBe(OP)
      expect(f.info().row.intent).toBe(original)
      expect(f.info().contents.get(B+':'+BD)).toBe('synthetic-B')
      expect(f.info().contents.has(A+':'+AD)).toBe(false)
      expect(new Set(f.info().submissions).size).toBe(1)
    },
  )
  it('lost server ACK resends the exact same signed command, never creates a second operation',async()=>{
    const f=fixture();f.setOnline(true);f.setCrash('lost-ack')
    await expect(f.step()).rejects.toThrow()
    expect(f.info().row.delivery).toBe('queued')
    await f.step()
    expect(f.info().row.delivery).toBe('accepted')
    expect(new Set(f.info().submissions).size).toBe(1)
    expect(f.info().contents.get(B+':'+BD)).toBe('synthetic-B')
  })
})
