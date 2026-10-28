import {beforeEach,describe,expect,it,vi} from 'vitest'

const mocked=vi.hoisted(()=>{
  const state:{accountId:string;deviceId:string}|null={accountId:'a',deviceId:'d'}
  return{
    current: {value:state} as {value:{accountId:string;deviceId:string}|null},
    commit:vi.fn(),reconcile:vi.fn(),now:vi.fn(()=>1_800_000_000_000),
  }
})
vi.mock('../../identity',()=>({identity:mocked.current}))
vi.mock('../../local-storage',()=>({
  openLocalPhotoVault:()=>({
    commit:mocked.commit,reconcile:mocked.reconcile,
    time:{status:()=>({trusted:true}),now:mocked.now,restoreFromStorage:vi.fn(),refreshFromServer:vi.fn()},
  }),
}))
import {createCaptureSession} from './capture'
const compressor=vi.fn(async()=>({
  blob:new Blob(['safe-jpeg'],{type:'image/jpeg'}),
  sourceWidth:4600,sourceHeight:3200,outputWidth:4000,outputHeight:2782,
}))
const result={photoId:'saved-id',accountId:'a',expiresAt:1_800_000_000_000+86_400_000}
describe('R2-06 application capture and encrypted commit API',()=>{
  beforeEach(()=>{vi.clearAllMocks();mocked.current.value={accountId:'a',deviceId:'d'};mocked.commit.mockResolvedValue(result)})
  it('snapshots mode 2 original and mode 3 master without generating another asset',async()=>{
    const service=createCaptureSession(compressor)
    await service.prepare(new Blob(['frame']),'video-frame',2,1)
    expect(mocked.commit).toHaveBeenCalledOnce()
    const m2=mocked.commit.mock.calls[0]![0]
    expect(m2.kind).toBe('original')
    expect(m2.metadata).toMatchObject({policyVersion:1,mode:2,
      sourceWidth:4600,outputWidth:4000,captureMethod:'video-frame'})
    expect(m2.expiresAt-m2.capturedAt).toBe(86_400_000)
    const service3=createCaptureSession(compressor)
    await service3.prepare(new Blob(['frame']),'image-capture',3,45)
    expect(mocked.commit).toHaveBeenCalledTimes(2)
    expect(mocked.commit.mock.calls[1]![0]).toMatchObject({kind:'master',
      metadata:{policyVersion:1,mode:3}})
    expect(mocked.commit.mock.calls[1]![0].expiresAt-mocked.commit.mock.calls[1]![0].capturedAt).toBe(45*86_400_000)
  })
  it('retries exact same immutable IDs after failed encrypted commit; no duplicates',async()=>{
    mocked.commit.mockRejectedValueOnce(new Error('QuotaExceededError')).mockResolvedValueOnce(result)
    const service=createCaptureSession(compressor)
    await expect(service.prepare(new Blob(['frame']),'video-frame',3,45)).rejects.toThrow('QuotaExceededError')
    expect(service.hasPending).toBe(true)
    const original=mocked.commit.mock.calls[0]![0]
    await service.retry()
    expect(service.hasPending).toBe(false)
    const retry=mocked.commit.mock.calls[1]![0]
    expect(retry.operationId).toBe(original.operationId)
    expect(retry.photoId).toBe(original.photoId)
    expect(retry.assetId).toBe(original.assetId)
    expect(retry.metadataAssetId).toBe(original.metadataAssetId)
    expect(mocked.commit).toHaveBeenCalledTimes(2)
  })
  it('refuses mode 1 and rejects work completed after identity change',async()=>{
    const service=createCaptureSession(compressor)
    await expect(service.prepare(new Blob(['frame']),'video-frame',1,1)).rejects.toThrow('camera.mode_unavailable')
    expect(mocked.commit).not.toHaveBeenCalled()
    let resolve!:(v:Awaited<ReturnType<typeof compressor>>)=>void
    const delayed=createCaptureSession(()=>new Promise(ok=>{resolve=ok}))
    const task=delayed.prepare(new Blob(['frame']),'video-frame',3,45)
    mocked.current.value={accountId:'b',deviceId:'other'}
    resolve(await compressor())
    await expect(task).rejects.toThrow('camera.account_changed')
    expect(mocked.commit).not.toHaveBeenCalled()
  })
})
