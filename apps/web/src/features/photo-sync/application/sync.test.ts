import {beforeEach,describe,expect,it,vi} from 'vitest'
const fx=vi.hoisted(()=>{
  const receipt={photoId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    operationId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',expiresAt:1850000000000,
    assets:[{assetId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',kind:'master',bytes:4,
      sha256:'a'.repeat(64)}],receiptHash:'f'.repeat(64)}
  return {
    account:{value:{accountId:'x',deviceId:'y',offline:false}},
    receipt,call:vi.fn(),signed:vi.fn(async()=> 'p1363-signature'),
    pending:vi.fn(),delivery:vi.fn(),ack:vi.fn(),retry:vi.fn(),revoke:vi.fn(),reconcile:vi.fn(async()=>{}),
    refresh:vi.fn(async()=>{}),
  }
})
vi.mock('../../identity',()=>({
  identity:fx.account,photoRequest:fx.call,signPhotoSyncContract:fx.signed,
  onIdentityCleanup:()=>()=>{},
}))
vi.mock('../../local-storage',()=>({
  openLocalPhotoVault:()=>({
    pending:fx.pending,delivery:fx.delivery,acknowledge:fx.ack,failDelivery:fx.retry,
    revokeFromServer:fx.revoke,
    reconcile:fx.reconcile,
    time:{status:()=>({trusted:true}),now:()=>1800000000000,
      restoreFromStorage:fx.refresh,refreshFromServer:fx.refresh},
  }),
}))
import {flushPhotoSync,signedContract} from './sync'
const json=(payload:unknown,status=200)=>new Response(JSON.stringify(payload),{
  status,headers:{'Content-Type':'application/json'},
})
describe('R2-05 one R2-04 outbox, lost-ACK and retry protocol',()=>{
  beforeEach(()=>{
    vi.clearAllMocks()
    vi.stubGlobal('document',{hidden:false,visibilityState:'visible'})
    vi.stubGlobal('navigator',{onLine:true})
    fx.account.value={accountId:'x',deviceId:'y',offline:false}
    fx.pending.mockResolvedValue([{photoId:fx.receipt.photoId,
      operationId:fx.receipt.operationId,nextAttemptAt:0}])
    fx.delivery.mockResolvedValue({
      photoId:fx.receipt.photoId,operationId:fx.receipt.operationId,expiresAt:fx.receipt.expiresAt,
      assets:[{...fx.receipt.assets[0],kind:'master' as const,revision:1,manifest:{version:1},
        ciphertext:new Blob([Uint8Array.of(1,2,3,4)])}],
    })
    fx.ack.mockResolvedValue(undefined)
    fx.retry.mockResolvedValue(undefined)
  })
  it('canonical contract contains ciphertext hashes/manifests but no decoded image',()=>{
    const encoded=signedContract({
      photoId:fx.receipt.photoId,operationId:fx.receipt.operationId,
      expiresAt:fx.receipt.expiresAt,
      assets:[{...fx.receipt.assets[0],kind:'master' as const,revision:1,manifest:{version:1} as never,
        ciphertext:new Blob(['secret-pixels'])}],
    })
    expect(JSON.parse(encoded)).toMatchObject({
      version:1,photoId:fx.receipt.photoId,assets:[{kind:'master',sha256:'a'.repeat(64)}],
    })
    expect(encoded).not.toContain('secret-pixels')
    expect(encoded).not.toContain('ciphertext":')
  })
  it('lost finalize ACK reconciles GET receipt without re-upload',async()=>{
    fx.call.mockResolvedValueOnce(json({state:'active',receipt:fx.receipt}))
    await flushPhotoSync()
    expect(fx.call).toHaveBeenCalledTimes(1)
    expect(fx.ack).toHaveBeenCalledWith(fx.receipt.operationId,fx.receipt)
    expect(fx.signed).not.toHaveBeenCalled()
  })
  it('network 503 keeps the same outbox operation and schedules retry',async()=>{
    fx.call.mockResolvedValueOnce(json({error:'unavailable'},503))
    await flushPhotoSync()
    expect(fx.ack).not.toHaveBeenCalled()
    expect(fx.retry).toHaveBeenCalledWith(fx.receipt.operationId,'sync.http_503')
  })
  it('410 from authenticated receipt cannot reupload or acknowledge an expired photo',async()=>{
    fx.call.mockResolvedValueOnce(json({error:'gone'},410))
    await flushPhotoSync()
    expect(fx.ack).not.toHaveBeenCalled()
    expect(fx.signed).not.toHaveBeenCalled()
    expect(fx.revoke).toHaveBeenCalledWith(fx.receipt.photoId)
  })
})
