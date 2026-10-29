import 'fake-indexeddb/auto'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {grantDb,scopedId,type OperationRow,type SecretRow,type ThumbnailShareRow} from '../infrastructure/database'
import type {GrantCommand} from '../domain/grants'

const actor=vi.hoisted(()=>({value:{accountId:'',deviceId:'',offline:false}}))
vi.mock('../../identity',()=>({identity:actor,onIdentityCleanup:()=>()=>{}}))
const {grantOperationResult,thumbnailShareResult}=await import('./grants')
const id=()=>crypto.randomUUID()

describe('grant outbox never destroys the only encrypted key',()=>{
  beforeEach(async()=>{
    actor.value.accountId=id();actor.value.deviceId=id()
    grantDb.close();await grantDb.delete();await grantDb.open()
  })
  afterEach(async()=>{grantDb.close();await grantDb.delete()})
  it('preserves encrypted grant secret after permanent reject and after successful ACK',async()=>{
    const grantId=id(),assignmentId=id(),recipient=id(),opId=id()
    const secret:SecretRow={
      id:scopedId(actor.value.accountId,actor.value.deviceId,grantId),
      accountId:actor.value.accountId,deviceId:actor.value.deviceId,
      grantId,assignmentId,ownerAccountId:actor.value.accountId,
      recipientAccountId:recipient,
      envelope:{v:2,iv:'opaque',ciphertext:'sealed',wrap:{iv:'sealed',ciphertext:'sealed'}},
    }
    const contract:GrantCommand={
      v:1,opId,kind:'invite',grantId,assignmentId,targetId:recipient,
      role:'viewer',expectedGeneration:0,expiresAt:Date.now()+120000,
      codeHash:'f'.repeat(64),sealedKey:{v:2,iv:'x',ciphertext:'sealed'},
    }
    const op:OperationRow={
      id:scopedId(actor.value.accountId,actor.value.deviceId,opId),
      accountId:actor.value.accountId,deviceId:actor.value.deviceId,
      grantId,contract,state:'pending',attempts:0,retryAt:0,lastError:null,
    }
    await grantDb.secrets.add(secret)
    await grantDb.operations.add(op)
    await grantOperationResult(op,false,'grant.http_409')
    expect((await grantDb.operations.get(op.id))?.state).toBe('conflict')
    expect(await grantDb.secrets.get(secret.id)).toEqual(secret)
    await grantOperationResult(op,true)
    expect(await grantDb.operations.get(op.id)).toBeUndefined()
    expect(await grantDb.secrets.get(secret.id)).toEqual(secret)
  })
  it('confirmed thumbnail cannot regress to retry due to a late failure',async()=>{
    const opId=id()
    const original:ThumbnailShareRow={
      id:scopedId(actor.value.accountId,actor.value.deviceId,opId),
      accountId:actor.value.accountId,deviceId:actor.value.deviceId,
      grantId:id(),photoId:id(),assetId:id(),generation:2,operationId:opId,
      expiresAt:Date.now()+100000,contract:'encrypted',signature:'signed',
      proof:{deviceId:id(),deviceSpki:'public',rootSignature:'endorsed'},
      state:'pending',attempts:0,retryAt:0,lastError:null,
    }
    await grantDb.thumbnailShares.add(original)
    await thumbnailShareResult(original,'ack')
    await thumbnailShareResult(original,'retry','grant.network')
    await thumbnailShareResult(original,'conflict','grant.http_409')
    const saved=await grantDb.thumbnailShares.get(original.id)
    expect(saved?.state).toBe('acknowledged')
    expect(saved?.contract).toBe(original.contract)
    expect(saved?.operationId).toBe(opId)
  })
})
