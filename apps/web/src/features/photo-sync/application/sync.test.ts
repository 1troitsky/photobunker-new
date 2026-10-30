import {beforeEach,describe,expect,it,vi} from 'vitest'
const fx=vi.hoisted(()=>{
  const receipt={photoId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    operationId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',expiresAt:1850000000000,
    assets:[{assetId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',kind:'master',bytes:4,
      sha256:'a'.repeat(64)}],receiptHash:'f'.repeat(64)}
  return {
    account:{value:{accountId:'x',deviceId:'y',offline:false}},
    receipt,call:vi.fn(),signed:vi.fn(async()=> 'p1363-signature'),
    pending:vi.fn(),delivery:vi.fn(),ack:vi.fn(),retry:vi.fn(),manualRetry:vi.fn(),
    revoke:vi.fn(),reconcile:vi.fn(async()=>{}),
    initialUploadAcknowledged:vi.fn(),editDelivery:vi.fn(),ackEdit:vi.fn(),conflictEdit:vi.fn(),syncState:vi.fn(),
    refresh:vi.fn(async()=>{}),cacheThumbnail:vi.fn(async()=>{}),
  }
})
vi.mock('../../identity',()=>({
  identity:fx.account,photoRequest:fx.call,signPhotoSyncContract:fx.signed,
  signMetadataContract:fx.signed,
  onIdentityCleanup:()=>()=>{},
}))
vi.mock('../../gallery',()=>({reserveNameRange:vi.fn(async()=>{}),claimName:vi.fn(async()=>{})}))
vi.mock('../../local-storage',()=>({
  openLocalPhotoVault:()=>({
    pending:fx.pending,delivery:fx.delivery,acknowledge:fx.ack,failDelivery:fx.retry,retry:fx.manualRetry,
    revokeFromServer:fx.revoke,
    initialUploadAcknowledged:fx.initialUploadAcknowledged,editDelivery:fx.editDelivery,
    acknowledgeEdit:fx.ackEdit,markEditConflict:fx.conflictEdit,syncState:fx.syncState,
    reconcile:fx.reconcile,cacheThumbnail:fx.cacheThumbnail,
    readHeader:vi.fn(async()=>null),
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
    fx.manualRetry.mockResolvedValue(undefined)
    fx.initialUploadAcknowledged.mockResolvedValue(true)
    fx.ackEdit.mockResolvedValue(undefined)
    fx.conflictEdit.mockResolvedValue(undefined)
    fx.syncState.mockResolvedValue('synced')
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
  it('manual sync clears backoff and retries the same operation immediately',async()=>{
    fx.pending.mockResolvedValueOnce([{photoId:fx.receipt.photoId,
      operationId:fx.receipt.operationId,nextAttemptAt:1850000000000}])
    fx.call.mockResolvedValueOnce(json({state:'active',receipt:fx.receipt}))
    await flushPhotoSync(true)
    expect(fx.manualRetry).toHaveBeenCalledWith(fx.receipt.operationId)
    expect(fx.ack).toHaveBeenCalledWith(fx.receipt.operationId,fx.receipt)
  })

  it('does not send an offline edit before the original capture is acknowledged',async()=>{
    fx.pending.mockResolvedValueOnce([{photoId:fx.receipt.photoId,
      operationId:fx.receipt.operationId,intent:'edit',nextAttemptAt:0}])
    fx.initialUploadAcknowledged.mockResolvedValueOnce(false)
    await flushPhotoSync()
    expect(fx.call).not.toHaveBeenCalled()
    expect(fx.editDelivery).not.toHaveBeenCalled()
    expect(fx.ackEdit).not.toHaveBeenCalled()
    expect(fx.retry).not.toHaveBeenCalled()
  })
  it('reconciles an already committed edit after lost finalize ACK without re-uploading ciphertext',async()=>{
    const assetId=fx.receipt.assets[0].assetId
    fx.pending.mockResolvedValueOnce([{photoId:fx.receipt.photoId,
      operationId:fx.receipt.operationId,intent:'edit',nextAttemptAt:0}])
    fx.editDelivery.mockResolvedValueOnce({
      photoId:fx.receipt.photoId,operationId:fx.receipt.operationId,
      expectedRevision:0,mode:3,asset:{assetId,kind:'master',revision:1,
        bytes:4,sha256:'a'.repeat(64),manifest:{version:1},
        ciphertext:new Blob([Uint8Array.of(1,2,3,4)])},
    })
    fx.call.mockResolvedValueOnce(json({state:'active',assetId,revision:1}))
    await flushPhotoSync()
    expect(fx.call).toHaveBeenCalledTimes(1)
    expect(fx.call.mock.calls[0]?.[0]).toBe('/'+fx.receipt.photoId+'/edits/reserve')
    expect(fx.ackEdit).toHaveBeenCalledWith(fx.receipt.operationId,assetId,1)
    expect(fx.retry).not.toHaveBeenCalled()
  })
  it('does not acknowledge an edit when server reports a conflicting revision',async()=>{
    const assetId=fx.receipt.assets[0].assetId
    fx.pending.mockResolvedValueOnce([{photoId:fx.receipt.photoId,
      operationId:fx.receipt.operationId,intent:'edit',nextAttemptAt:0}])
    fx.editDelivery.mockResolvedValueOnce({
      photoId:fx.receipt.photoId,operationId:fx.receipt.operationId,
      expectedRevision:0,mode:2,asset:{assetId,kind:'edit',revision:1,
        bytes:4,sha256:'a'.repeat(64),manifest:{version:1},
        ciphertext:new Blob([Uint8Array.of(1,2,3,4)])},
    })
    fx.call.mockResolvedValueOnce(json({error:'conflict'},409))
    await flushPhotoSync()
    expect(fx.conflictEdit).toHaveBeenCalledWith(fx.receipt.operationId)
    expect(fx.ackEdit).not.toHaveBeenCalled()
    expect(fx.call).toHaveBeenCalledTimes(1)
  })

  it('410 from authenticated receipt cannot reupload or acknowledge an expired photo',async()=>{
    fx.call.mockResolvedValueOnce(json({error:'gone'},410))
    await flushPhotoSync()
    expect(fx.ack).not.toHaveBeenCalled()
    expect(fx.signed).not.toHaveBeenCalled()
    expect(fx.revoke).toHaveBeenCalledWith(fx.receipt.photoId)
  })
})
