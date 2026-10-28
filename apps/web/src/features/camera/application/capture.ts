import type {PhotoHeader,PhotoRepository,TimeAuthority} from '../../local-storage'
import {openLocalPhotoVault} from '../../local-storage'
import {identity} from '../../identity'
import type {CaptureMode,Method,PersonalPolicy} from '../domain/policy'
import {personalPolicy,snapshot} from '../domain/policy'

export type PendingCapture=Readonly<{
  operationId:string;photoId:string;assetId:string;metadataAssetId:string
  jpeg:Blob;policy:PersonalPolicy;method:Method;sourceWidth:number;sourceHeight:number
  outputWidth:number;outputHeight:number;capturedAt:number;expiresAt:number
}>
export type CaptureProgress='idle'|'compressing'|'encrypting'|'saved'|'failed'
type Compressed=Readonly<{blob:Blob;sourceWidth:number;sourceHeight:number;outputWidth:number;outputHeight:number}>
export type Compressor=(source:Blob,check:()=>void)=>Promise<Compressed>
const MAX_PENDING_MS=5*60*1000

/** No network upload/camera SDK; all persistence goes through R2-04 public module. */
export class CaptureSession{
  private readonly compressor:Compressor
  private readonly vault=openLocalPhotoVault()
  private readonly owner=identity.value?.accountId
  private readonly device=identity.value?.deviceId
  private pending:PendingCapture|null=null
  private generation=0
  constructor(compressor:Compressor){this.compressor=compressor}
  readonly time:TimeAuthority=this.vault.time
  get hasPending():boolean{return Boolean(this.pending)}
  get currentPendingId(){return this.pending?.photoId??null}
  cancel():void{this.generation++;this.pending=null}
  private check(ticket:number):void{
    if(ticket!==this.generation||identity.value?.accountId!==this.owner||identity.value?.deviceId!==this.device)
      throw new Error('camera.account_changed')
  }
  /** Does not await HTTP during first frame/camera preview. */
  async prepareTime():Promise<void>{
    try{
      if(!this.time.status().trusted)await this.time.restoreFromStorage()
      if(!this.time.status().trusted&&identity.value&&!identity.value.offline)await this.time.refreshFromServer()
    }catch{/* camera remains usable; capture cannot report saved without trusted UTC */}
  }
  async prepare(source:Blob,method:Method,mode:CaptureMode,ttlDays:number,onProgress?:(s:CaptureProgress)=>void):Promise<PhotoHeader>{
    if(this.pending)throw new Error('camera.pending_retry_first')
    const ticket=this.generation
    this.check(ticket)
    const policy=personalPolicy(mode,ttlDays)
    const ids={operationId:crypto.randomUUID(),photoId:crypto.randomUUID(),
      assetId:crypto.randomUUID(),metadataAssetId:crypto.randomUUID()}
    const started=performance.now()
    onProgress?.('compressing')
    const converted=await this.compressor(source,()=>this.check(ticket))
    this.check(ticket)
    // The capture is real. A clock obtained *later* is not allowed to backdate a long-unsynced frame.
    if(performance.now()-started>MAX_PENDING_MS)throw new Error('camera.frame_stale')
    let capturedAt:number
    try{capturedAt=this.time.now()}catch{throw new Error('camera.untrusted_time_retry_capture')}
    const metadata=snapshot(policy,capturedAt,
      {width:converted.sourceWidth,height:converted.sourceHeight},
      {width:converted.outputWidth,height:converted.outputHeight},method)
    this.pending={...ids,jpeg:converted.blob,policy,method,
      sourceWidth:converted.sourceWidth,sourceHeight:converted.sourceHeight,
      outputWidth:converted.outputWidth,outputHeight:converted.outputHeight,
      capturedAt:metadata.capturedAt,expiresAt:metadata.expiresAt}
    return this.retry(onProgress)
  }
  /** Exactly the same IDs, immutable JPEG/policy snapshot after failed commit. */
  async retry(onProgress?:(s:CaptureProgress)=>void):Promise<PhotoHeader>{
    const ticket=this.generation
    this.check(ticket)
    const pending=this.pending
    if(!pending)throw new Error('camera.no_pending_capture')
    onProgress?.('encrypting')
    const metadata=snapshot(pending.policy,pending.capturedAt,
      {width:pending.sourceWidth,height:pending.sourceHeight},
      {width:pending.outputWidth,height:pending.outputHeight},pending.method)
    const input={
      operationId:pending.operationId,photoId:pending.photoId,assetId:pending.assetId,
      metadataAssetId:pending.metadataAssetId,revision:1 as const,
      kind:pending.policy.mode===2?'original' as const:'master' as const,
      capturedAt:pending.capturedAt,expiresAt:pending.expiresAt,
      pixels:pending.jpeg,metadata,
    }
    const row=await this.vault.commit(input)
    this.check(ticket)
    this.pending=null
    onProgress?.('saved')
    return row
  }
  /** Reconcile cleanup in the background, never in shutter critical path. */
  async reconcile():Promise<void>{await this.vault.reconcile()}
}
export function createCaptureSession(compressor:Compressor):CaptureSession{return new CaptureSession(compressor)}
export function openLocalPhotos():{repo:PhotoRepository;time:TimeAuthority}{
  const vault=openLocalPhotoVault()
  return{repo:vault,time:vault.time}
}
