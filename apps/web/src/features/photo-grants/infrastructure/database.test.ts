import 'fake-indexeddb/auto'
import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import {grantDb,scopedId,type ThumbnailShareRow} from './database'

const uuid=()=>crypto.randomUUID()
function share(
  owner:string,device:string,grant:string,photo:string,generation=2,
):ThumbnailShareRow{
  const operationId=uuid()
  return {
    id:scopedId(owner,device,operationId),
    accountId:owner,deviceId:device,grantId:grant,photoId:photo,assetId:uuid(),
    generation,operationId,expiresAt:Date.now()+86400000,
    contract:'{"encrypted":"ciphertext-only"}',signature:'opaque-signature',
    proof:{deviceId:device,deviceSpki:'public-key',rootSignature:'root-signature'},
    state:'pending',retryAt:0,attempts:0,lastError:null,
  }
}

describe('durable encrypted thumbnail delivery index',()=>{
  beforeEach(async()=>{grantDb.close();await grantDb.delete();await grantDb.open()})
  afterEach(async()=>{grantDb.close();await grantDb.delete()})
  it('enforces single immutable share per owner/device/grant/photo/generation',async()=>{
    const account=uuid(),device=uuid(),grant=uuid(),photo=uuid()
    const first=share(account,device,grant,photo)
    await grantDb.thumbnailShares.add(first)
    await expect(grantDb.thumbnailShares.add(share(account,device,grant,photo)))
      .rejects.toThrow()
    expect(await grantDb.thumbnailShares.count()).toBe(1)
    await grantDb.thumbnailShares.add(share(account,device,grant,photo,3))
    await grantDb.thumbnailShares.add(share(uuid(),device,grant,photo))
    expect(await grantDb.thumbnailShares.count()).toBe(3)
  })
  it('retains exact signed ciphertext after ACK or reload, never a new key envelope',async()=>{
    const account=uuid(),device=uuid(),row=share(account,device,uuid(),uuid())
    await grantDb.thumbnailShares.add(row)
    await grantDb.thumbnailShares.update(row.id,{
      state:'acknowledged',attempts:1,retryAt:0,lastError:null,
    })
    grantDb.close()
    await grantDb.open()
    const stored=await grantDb.thumbnailShares.get(row.id)
    expect(stored?.state).toBe('acknowledged')
    expect(stored?.operationId).toBe(row.operationId)
    expect(stored?.contract).toBe(row.contract)
    expect(stored?.signature).toBe(row.signature)
    expect(stored?.proof).toEqual(row.proof)
  })
})
