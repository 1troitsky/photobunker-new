import { acquireStorageKeys, onIdentityCleanup } from '../../identity'
import type { CreatePhoto, EncryptedBlobStore, PhotoRepository, PhotoSyncOutbox, PhotoHeader, CipherManifest, Capabilities, StorageBackend, TimeAuthority, SyncSnapshot, SyncReceipt, SyncState } from '../domain/contracts'
import { db, photoKey, assetKey, writeCiphertext, readCiphertext, deleteCiphertext } from './database'
import type { PhotoRow, ManifestRow, JournalRow, StoredOutbox } from './database'
import { encryptAsset, decryptAsset, identifier, invalid, manifestValid, sha } from './cipher'
import { probeStorageCapabilities } from './capabilities'
import { BrowserTimeAuthority, clearLiveTime } from './time'
import { MAX_CLOCK_SKEW_MS, retentionValid } from '../domain/time-policy'

const metadataEncoder=new TextEncoder()
const metadataDecoder=new TextDecoder('utf-8',{fatal:true})
const ORPHAN_GRACE=60*60*1000
const clearAll=onIdentityCleanup(()=>clearLiveTime())
void clearAll // handler stays registered until page shutdown

/** Scoped entrypoint. One instance per active identity epoch; no raw key material escapes. */
export class LocalPhotoVault implements PhotoRepository, EncryptedBlobStore, PhotoSyncOutbox {
  private readonly grant=acquireStorageKeys()
  private readonly scope=this.grant.scope
  readonly time:TimeAuthority=new BrowserTimeAuthority(this.grant)
  private readonly timeReady=this.time.restoreFromStorage()
  private capabilities:Capabilities|null=null

  private check():void{this.grant.check()}
  private async clockReady():Promise<void>{await this.timeReady;this.check()}
  private async init():Promise<StorageBackend>{
    this.check()
    if(!this.capabilities)this.capabilities=await probeStorageCapabilities()
    this.check()
    if(!this.capabilities.backend)throw new Error('storage.unavailable')
    return this.capabilities.backend
  }
  async diagnostics(requestPersist=false):Promise<Capabilities>{
    this.capabilities=await probeStorageCapabilities(requestPersist)
    this.check()
    return this.capabilities
  }
  private async existing(input:CreatePhoto):Promise<PhotoHeader|null>{
    const row=await db.photos.get(photoKey(this.scope,input.photoId))
    const matched=await db.photos.where('[accountId+operationId]')
      .equals([this.scope.accountId,input.operationId]).first()
    this.check()
    if(await db.tombstones.get(photoKey(this.scope,input.photoId)))throw new Error('storage.tombstoned')
    if(row){
      if(row.operationId!==input.operationId)throw new Error('storage.photo_conflict')
      if(row.accountId!==this.scope.accountId || row.assetId!==input.assetId ||
        row.metadataAssetId!==input.metadataAssetId || row.expiresAt!==input.expiresAt ||
        row.revision!==input.revision || row.state!=='local')
        throw new Error('storage.operation_conflict')
      return row
    }
    if(matched)throw new Error('storage.operation_conflict')
    return null
  }
  async commit(input:CreatePhoto):Promise<PhotoHeader>{
    this.check()
    if(navigator.locks?.request){
      return navigator.locks.request('pb-local-v1:'+this.scope.accountId+':'+input.photoId,
        {mode:'exclusive'},async()=>this.commitUnlocked(input))
    }
    // Safari fallback: unique attempt paths and atomic Dexie CAS still protect manifests.
    return this.commitUnlocked(input)
  }
  private async commitUnlocked(input:CreatePhoto):Promise<PhotoHeader>{
    this.check()
    const backend=await this.init()
    await this.clockReady()
    const now=this.time.now()
    for(const id of [input.operationId,input.photoId,input.assetId,input.metadataAssetId])identifier(id)
    invalid(input.assetId!==input.metadataAssetId && input.revision===1 &&
      ['master','original','edit','thumbnail'].includes(input.kind),'storage.invalid_capture')
    invalid(Number.isSafeInteger(input.capturedAt) && Number.isSafeInteger(input.expiresAt) &&
      retentionValid(input.capturedAt,input.expiresAt) &&
      Math.abs(input.capturedAt-now)<=MAX_CLOCK_SKEW_MS && now<input.expiresAt,'storage.invalid_ttl')
    invalid(input.pixels instanceof Blob && input.pixels.size>0,'storage.invalid_blob')
    const meta=metadataEncoder.encode(JSON.stringify({version:1,capturedAt:input.capturedAt,data:input.metadata}))
    invalid(meta.byteLength>0 && meta.byteLength<=256*1024,'storage.invalid_metadata')
    const previously=await this.existing(input)
    if(previously)return previously

    const attemptId=crypto.randomUUID()
    const photoReference=photoKey(this.scope,input.photoId)
    const imagePath=assetKey(this.scope,input.photoId,input.assetId)+'/'+attemptId
    const metadataPath=assetKey(this.scope,input.photoId,input.metadataAssetId)+'/'+attemptId
    // Reserve both backend paths BEFORE writing, for crash-recovery of partial blobs.
    // Reserve every backend that this attempt can actually touch. On browsers
    // without OPFS, recording phantom OPFS paths makes successful IDB commits
    // fail during cleanup because navigator.storage.getDirectory is absent.
    const allPaths=[imagePath,metadataPath].flatMap(path=>backend==='opfs'
      ?['opfs|'+path,'idb-blob|'+path]
      :['idb-blob|'+path])
    const journalKey=photoReference+'/'+attemptId
    const journal:JournalRow={key:journalKey,accountId:this.scope.accountId,deviceId:this.scope.deviceId,
      photoId:input.photoId,operationId:input.operationId,attemptId,assetKeys:allPaths,
      state:'staging',createdAt:now}
    await db.journal.add(journal)
    const staged:{manifest:CipherManifest;blob:Blob}[]=[]
    let manifestCommitted=false
    try{
      for(const item of [
        {assetId:input.assetId,kind:input.kind,content:input.pixels,path:imagePath},
        {assetId:input.metadataAssetId,kind:'metadata' as const,content:new Blob([meta]),path:metadataPath},
      ]){
        this.check()
        const expires=String(input.expiresAt)
        const {key,wrapped}=await this.grant.create(item.assetId,expires)
        const result=await encryptAsset(this.scope,input.photoId,item.assetId,item.kind,input.revision,input.expiresAt,
          item.content,key,wrapped,backend,item.path,()=>this.check())
        let storedBackend:StorageBackend=backend
        let verified:Blob
        let manifest:CipherManifest
        try{
          await writeCiphertext(backend,item.path,result.blob,this.scope)
          verified=await readCiphertext(backend,item.path)
          manifest={...result.manifest,backend}
          const opened=await decryptAsset(manifest,verified,key,this.scope,()=>this.check())
          invalid(opened.size===item.content.size,'storage.readback_failed')
        }catch(error){
          // OPFS read/write failure can be recovered *before* manifest publication;
          // never substitute an unencrypted browser file or claim save success.
          if(backend!=='opfs' || !(await probeStorageCapabilities()).fallbackBlob)throw error
          this.check()
          storedBackend='idb-blob'
          await writeCiphertext(storedBackend,item.path,result.blob,this.scope)
          verified=await readCiphertext(storedBackend,item.path)
          manifest={...result.manifest,backend:storedBackend}
          const opened=await decryptAsset(manifest,verified,key,this.scope,()=>this.check())
          invalid(opened.size===item.content.size,'storage.readback_failed')
        }
        staged.push({manifest,blob:verified})
      }
      this.check()
      // Dexie atomic manifest, encrypted metadata pointer, photo header & outbox.
      const stored:PhotoRow={
        key:photoReference,accountId:this.scope.accountId,photoId:input.photoId,assetId:input.assetId,
        metadataAssetId:input.metadataAssetId,
        expiresAt:input.expiresAt,revision:input.revision,
        operationId:input.operationId,state:'local',
      }
      const outbox:StoredOutbox={
        key:this.scope.accountId+'/'+input.operationId,accountId:this.scope.accountId,
        photoId:input.photoId,operationId:input.operationId,intent:'upload',state:'pending',
        attempts:0,nextAttemptAt:0,expiresAt:input.expiresAt,
      }
      const outcome:PhotoRow=await db.transaction('rw',
        [db.photos,db.assets,db.outbox,db.journal,db.tombstones],async()=>{
        this.check()
        if(await db.tombstones.get(photoReference))throw new Error('storage.tombstoned')
        const row=await db.photos.get(photoReference)
        if(row){
          if(row.operationId!==input.operationId || row.assetId!==input.assetId)
            throw new Error('storage.photo_conflict')
          // Concurrent exact retry: original committed pointers win, never duplicate.
          await db.journal.update(journalKey,{state:'cleanup'})
          return row
        }
        const other=await db.photos.where('[accountId+operationId]')
          .equals([this.scope.accountId,input.operationId]).first()
        if(other)throw new Error('storage.operation_conflict')
        for(const item of staged)await db.assets.add({key:assetKey(this.scope,input.photoId,item.manifest.assetId),...item.manifest})
        await db.photos.add(stored)
        await db.outbox.add(outbox)
        await db.journal.update(journalKey,{state:'cleanup'})
        return stored
      })
      manifestCommitted=true
      // If a concurrent attempt won, only its manifest is durable; remove this attempt.
      if(staged.some(x=>x.manifest.storageKey!==imagePath && x.manifest.storageKey!==metadataPath)){
        // impossible internal invariant — fail closed
        throw new Error('storage.invalid_staging')
      }
      // Keep journal until EVERY unreferenced OPFS/fallback staging path was removed.
      const persisted=await db.assets.where('[accountId+photoId]').equals([this.scope.accountId,input.photoId]).toArray()
      const protectedPaths=new Set(persisted.map(x=>x.backend+'|'+x.storageKey))
      for(const target of allPaths){
        this.check()
        if(protectedPaths.has(target))continue
        const [destination,path]=target.split('|') as [StorageBackend,string]
        await deleteCiphertext(destination,path)
      }
      await db.journal.delete(journalKey)
      // Durable outbox is already committed; wake foreground delivery without waiting for network.
      if(typeof window!=='undefined')window.dispatchEvent(new Event('photobunker-outbox'))
      return outcome
    }catch(error){
      // Once manifest committed, its ciphertext is live; never compensate committed pointers.
      if(manifestCommitted)throw error
      const liveAssets=await db.assets.where('[accountId+photoId]').equals([this.scope.accountId,input.photoId]).toArray()
      if(liveAssets.some(x=>x.storageKey===imagePath||x.storageKey===metadataPath))
        throw error // never destroy a committed concurrent winner
      // Journal survives if compensation fails; reconcile will retry without a false commit.
      let cleaned=true
      for(const target of allPaths){
        const [destination,path]=target.split('|') as [StorageBackend,string]
        try{await deleteCiphertext(destination,path)}catch{cleaned=false}
      }
      if(cleaned)await db.journal.delete(journalKey).catch(()=>{})
      throw error
    }
  }
  private async current(photoId:string):Promise<PhotoRow>{
    this.check();await this.clockReady();identifier(photoId)
    const row=await db.photos.get(photoKey(this.scope,photoId))
    this.check()
    if(!row || row.state!=='local' || await db.tombstones.get(photoKey(this.scope,photoId)))
      throw new Error('storage.photo_unavailable')
    if(this.time.proveExpiry(row.expiresAt)){
      await this.confirmExpiry(photoId)
      throw new Error('storage.photo_expired')
    }
    return row
  }
  async readHeader(photoId:string):Promise<PhotoHeader|null>{
    try{return await this.current(photoId)}catch{return null}
  }
  async list():Promise<PhotoHeader[]>{
    this.check();await this.clockReady()
    const now=this.time.now()
    const rows=await db.photos.where('accountId').equals(this.scope.accountId).toArray()
    this.check()
    // Expired material never flashes: do not return even if cleanup has not finished.
    const result=[]
    for(const row of rows){
      if(row.state!=='local' || row.expiresAt<=now)continue
      if(!await db.tombstones.get(photoKey(this.scope,row.photoId)))result.push(row)
    }
    return result
  }
  async read(photoId:string,assetId:string):Promise<Blob>{
    this.check()
    const row=await this.current(photoId)
    const storedAsset=await db.assets.get(assetKey(this.scope,photoId,assetId))
    invalid(!!storedAsset && storedAsset.accountId===this.scope.accountId && storedAsset.photoId===photoId &&
      (assetId===row.assetId || assetId===row.metadataAssetId),'storage.asset_unavailable')
    // `key` is a Dexie-only index and is not part of the authenticated manifest
    // protocol. Never feed storage bookkeeping into the exact-field validator.
    const assetRecord:Partial<ManifestRow>={...storedAsset}
    delete assetRecord.key
    const asset=assetRecord as CipherManifest
    manifestValid(asset,{scope:this.scope,photoId,assetId})
    const key=await this.grant.open(asset.assetId,String(asset.expiresAt),asset.wrappedDEK)
    const blob=await readCiphertext(asset.backend,asset.storageKey)
    this.check()
    // Live trusted clock must still be valid after asynchronous read.
    await this.current(photoId)
    return decryptAsset(asset,blob,key,this.scope,()=>{this.check();this.time.now()})
  }
  async readMetadata(photoId:string):Promise<unknown>{
    const row=await this.current(photoId)
    const result=await this.read(photoId,row.metadataAssetId)
    this.check()
    const decoded=JSON.parse(metadataDecoder.decode(await result.arrayBuffer())) as {
      version?:unknown;capturedAt?:unknown;data?:unknown
    }
    invalid(decoded!==null&&typeof decoded==='object'&&decoded.version===1&&
      Number.isSafeInteger(decoded.capturedAt),'storage.metadata_invalid')
    return decoded.data
  }
  async pending():Promise<StoredOutbox[]>{
    this.check();await this.clockReady()
    const now=this.time.now()
    const all=await db.outbox.where('accountId').equals(this.scope.accountId).toArray()
    this.check()
    return all.filter(x=>x.state!=='cancelled'&&x.state!=='acknowledged'&&x.expiresAt>now)
  }
  async retry(operationId:string):Promise<void>{
    this.check();await this.clockReady();identifier(operationId)
    const now=this.time.now()
    await db.transaction('rw',db.outbox,db.tombstones,async()=>{
      const key=this.scope.accountId+'/'+operationId
      const row=await db.outbox.get(key)
      if(!row)throw new Error('storage.outbox_missing')
      if(await db.tombstones.get(photoKey(this.scope,row.photoId))||row.expiresAt<=now)
        throw new Error('storage.expired_upload_forbidden')
      if(row.state==='cancelled'||row.state==='acknowledged')return
      this.check()
      await db.outbox.update(key,{state:'retry'})
    })
  }
  /** Exports ciphertext only through the existing R2-04 outbox, never a second queue. */
  async delivery(operationId:string):Promise<SyncSnapshot>{
    this.check();await this.clockReady();identifier(operationId)
    const task=await db.outbox.where('[accountId+operationId]')
      .equals([this.scope.accountId,operationId]).first()
    if(!task||task.state==='cancelled'||task.intent!=='upload')throw new Error('sync.operation_unavailable')
    const photo=await this.current(task.photoId)
    if(photo.operationId!==operationId||photo.expiresAt!==task.expiresAt)throw new Error('sync.operation_conflict')
    const records=await db.assets.where('[accountId+photoId]')
      .equals([this.scope.accountId,photo.photoId]).toArray()
    invalid(records.length===2,'sync.assets_incomplete')
    const assets=[]
    for(const asset of records){
      this.check()
      invalid(asset.assetId===photo.assetId||asset.assetId===photo.metadataAssetId,'sync.asset_unexpected')
      const {key,backend,storageKey,...manifest}=asset
      void key
      manifestValid({...manifest,backend,storageKey},{scope:this.scope,photoId:photo.photoId,assetId:asset.assetId})
      const ciphertext=await readCiphertext(backend,storageKey)
      invalid(ciphertext.size===asset.cipherBytes,'sync.blob_truncated')
      const sha256=await sha(new Uint8Array(await ciphertext.arrayBuffer()))
      this.check()
      assets.push({assetId:asset.assetId,kind:asset.kind,revision:asset.revision,
        bytes:asset.cipherBytes,sha256,manifest,ciphertext})
    }
    assets.sort((a,b)=>a.assetId.localeCompare(b.assetId))
    return{photoId:photo.photoId,operationId,expiresAt:photo.expiresAt,assets}
  }
  async failDelivery(operationId:string,code:string):Promise<void>{
    this.check();await this.clockReady();identifier(operationId)
    const now=this.time.now()
    await db.transaction('rw',db.outbox,db.tombstones,async()=>{
      this.check()
      const key=this.scope.accountId+'/'+operationId
      const row=await db.outbox.get(key)
      if(!row||row.state==='acknowledged'||row.state==='cancelled')return
      if(await db.tombstones.get(photoKey(this.scope,row.photoId))||row.expiresAt<=now)return
      const attempts=Math.min(24,(row.attempts??0)+1)
      const nextAttemptAt=now+Math.min(300000,1000*2**Math.min(8,attempts))
      await db.outbox.update(key,{state:'retry',attempts,nextAttemptAt,lastError:code.slice(0,40)})
    })
  }
  async acknowledge(operationId:string,receipt:SyncReceipt):Promise<void>{
    this.check();await this.clockReady();identifier(operationId)
    const data=await this.delivery(operationId)
    invalid(receipt.photoId===data.photoId&&receipt.operationId===operationId &&
      receipt.expiresAt===data.expiresAt&&Array.isArray(receipt.assets),'sync.receipt_mismatch')
    const expected=data.assets.map(a=>({assetId:a.assetId,kind:a.kind,bytes:a.bytes,sha256:a.sha256}))
    const actual=[...receipt.assets].sort((a,b)=>a.assetId.localeCompare(b.assetId))
    invalid(JSON.stringify(expected)===JSON.stringify(actual),'sync.receipt_assets_mismatch')
    const payload={photoId:data.photoId,operationId,expiresAt:data.expiresAt,assets:expected}
    const receiptHash=await sha(new TextEncoder().encode(JSON.stringify(payload)))
    invalid(receipt.receiptHash===receiptHash,'sync.receipt_digest_mismatch')
    await db.transaction('rw',db.photos,db.outbox,db.tombstones,async()=>{
      this.check()
      const key=this.scope.accountId+'/'+operationId
      const row=await db.outbox.get(key)
      const photo=await db.photos.get(photoKey(this.scope,data.photoId))
      if(!row||!photo||row.photoId!==data.photoId||row.state==='cancelled'||
          photo.expiresAt<=this.time.now()||
          await db.tombstones.get(photoKey(this.scope,data.photoId)))
        throw new Error('sync.ack_expired_or_revoked')
      if(row.state==='acknowledged')invalid(row.receiptHash===receiptHash,'sync.ack_conflict')
      else await db.outbox.update(key,{state:'acknowledged',receiptHash,
        attempts:0,nextAttemptAt:0,lastError:undefined})
    })
  }
  async syncState(photoId:string):Promise<SyncState>{
    this.check();identifier(photoId)
    if(await db.tombstones.get(photoKey(this.scope,photoId)))return 'expired'
    const photo=await db.photos.get(photoKey(this.scope,photoId))
    if(!photo||photo.state!=='local')return 'expired'
    if(!this.time.status().trusted)return 'local'
    if(this.time.now()>=photo.expiresAt)return 'expired'
    const task=await db.outbox.get(this.scope.accountId+'/'+photo.operationId)
    return task?.state==='acknowledged'?'synced':task?.state==='retry'?'retry':'local'
  }
  /** A same-origin authenticated 410 is authoritative even before local wall-clock expiry. */
  async revokeFromServer(photoId:string):Promise<void>{
    this.check();identifier(photoId)
    const key=photoKey(this.scope,photoId)
    await db.transaction('rw',db.photos,db.outbox,db.tombstones,async()=>{
      this.check()
      const photo=await db.photos.get(key)
      if(!photo)return
      if(!await db.tombstones.get(key))
        await db.tombstones.put({key,accountId:this.scope.accountId,photoId,
          expiresAt:photo.expiresAt,confirmedAt:0})
      await db.photos.update(key,{state:'delete_pending'})
      await db.outbox.update(this.scope.accountId+'/'+photo.operationId,{state:'cancelled'})
    })
    await this.cleanupTombstone(photoId)
  }

  async confirmExpiry(photoId:string):Promise<void>{
    this.check();await this.clockReady();identifier(photoId)
    const key=photoKey(this.scope,photoId)
    const row=await db.photos.get(key)
    if(!row)return
    if(!this.time.proveExpiry(row.expiresAt))throw new Error('time.not_expired')
    // Commit tombstone first so no late ACK/retry can resurrect the photo.
    await db.transaction('rw',db.photos,db.outbox,db.tombstones,async()=>{
      this.check()
      const existing=await db.photos.get(key)
      if(!existing)return
      if(!await db.tombstones.get(key))await db.tombstones.add({key,accountId:this.scope.accountId,
        photoId,expiresAt:existing.expiresAt,confirmedAt:this.time.now()})
      await db.photos.update(key,{state:'delete_pending'})
      await db.outbox.update(this.scope.accountId+'/'+existing.operationId,{state:'cancelled',intent:'delete'})
    })
    await this.cleanupTombstone(photoId)
  }
  private async cleanupTombstone(photoId:string):Promise<void>{
    const key=photoKey(this.scope,photoId)
    if(!await db.tombstones.get(key))return
    const assets=await db.assets.where('[accountId+photoId]').equals([this.scope.accountId,photoId]).toArray()
    for(const item of assets){
      this.check()
      await deleteCiphertext(item.backend,item.storageKey)
    }
    await db.transaction('rw',db.photos,db.assets,db.outbox,async()=>{
      this.check()
      for(const item of assets)await db.assets.delete(item.key)
      const photo=await db.photos.get(key)
      if(photo){
        await db.outbox.delete(this.scope.accountId+'/'+photo.operationId)
        await db.photos.delete(key)
      }
    })
  }
  async reconcile():Promise<void>{
    this.check()
    await this.init()
    await this.clockReady()
    // Sweep abandoned staging attempts only after a grace period. Never touch committed pointers.
    const clock=this.time.status()
    const old=clock.trusted&&clock.now!==null?clock.now-ORPHAN_GRACE:null
    const journals=await db.journal.where('accountId').equals(this.scope.accountId).toArray()
    for(const row of journals){
      this.check()
      if(row.state!=='cleanup' && (old===null||row.createdAt>old))continue
      const manifests=await db.assets.where('[accountId+photoId]').equals([this.scope.accountId,row.photoId]).toArray()
      const protectedKeys=new Set(manifests.map(item=>item.backend+'|'+item.storageKey))
      let failed=false
      for(const item of row.assetKeys){
        if(protectedKeys.has(item))continue
        const [backend,path]=item.split('|') as [StorageBackend,string]
        try{await deleteCiphertext(backend,path)}catch{failed=true}
      }
      if(!failed)await db.journal.delete(row.key)
    }
    const deleted=await db.tombstones.where('accountId').equals(this.scope.accountId).toArray()
    for(const row of deleted)await this.cleanupTombstone(row.photoId)
    if(this.time.status().trusted){
      const expired=await db.photos.where('[accountId+expiresAt]')
        .between([this.scope.accountId,0],[this.scope.accountId,this.time.now()],true,true).toArray()
      for(const row of expired)await this.confirmExpiry(row.photoId)
    }
  }
}
export function openLocalPhotoVault():LocalPhotoVault{return new LocalPhotoVault()}
