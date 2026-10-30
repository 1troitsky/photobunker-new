import { acquireStorageKeys, onIdentityCleanup } from '../../identity'
import type { CreatePhoto, EncryptedBlobStore, PhotoRepository, PhotoSyncOutbox, PhotoHeader, CipherManifest, Capabilities, StorageBackend, TimeAuthority, SyncSnapshot, SyncReceipt, SyncState, CloudAsset, CloudPhoto, ReviewDecision, ReviewEnvelope, ReviewContract, ReviewSnapshot } from '../domain/contracts'
import { db, photoKey, assetKey, writeCiphertext, readCiphertext, deleteCiphertext } from './database'
import type { PhotoRow, ManifestRow, JournalRow, StoredOutbox } from './database'
import { encryptAsset, decryptAsset, identifier, invalid, manifestValid, sha } from './cipher'
import {originalUploadPointers} from '../domain/original-upload'
import { probeStorageCapabilities } from './capabilities'
import { BrowserTimeAuthority, clearLiveTime } from './time'
import { MAX_CLOCK_SKEW_MS, retentionValid } from '../domain/time-policy'
import { assertJpegWithoutMetadata } from './jpeg'

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
        row.nameId!==input.nameId ||
        row.metadataAssetId!==input.metadataAssetId || row.expiresAt!==input.expiresAt ||
        row.revision!==input.revision || row.state!=='local')
        throw new Error('storage.operation_conflict')
      if(JSON.stringify(row.capture??null)!==JSON.stringify(input.capture??null))throw new Error('storage.capture_conflict')
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
    if(input.thumbnailAssetId)identifier(input.thumbnailAssetId)
    invalid(!input.thumbnail || (!!input.thumbnailAssetId&&input.thumbnail.type==='image/webp'&&input.thumbnail.size<=512*1024),'gallery.thumbnail_invalid')
    invalid(input.assetId!==input.metadataAssetId && input.revision===1 &&
      ['master','original','edit','thumbnail'].includes(input.kind),'storage.invalid_capture')
    invalid(Number.isSafeInteger(input.capturedAt) && Number.isSafeInteger(input.expiresAt) &&
      retentionValid(input.capturedAt,input.expiresAt) &&
      Math.abs(input.capturedAt-now)<=MAX_CLOCK_SKEW_MS && now<input.expiresAt,'storage.invalid_ttl')
    invalid(input.pixels instanceof Blob && input.pixels.size>0,'storage.invalid_blob')
    if(input.capture){
      invalid(input.capture.capturedAt===input.capturedAt&&
        input.capture.retentionDays>=1&&input.capture.retentionDays<=45&&
        input.expiresAt===input.capturedAt+input.capture.retentionDays*86400000&&
        (input.capture.mode===2&&input.kind==='original'||
          input.capture.mode===3&&input.kind==='master'),'storage.capture_policy_mismatch')
      identifier(input.capture.assignmentId)
    }
    if(input.capture){
      const metadata=input.metadata as {policy?:Record<string,unknown>;capturedAt?:number;
        expiresAt?:number;mode?:number}
      const p=metadata?.policy
      invalid(metadata.capturedAt===input.capture.capturedAt &&
        metadata.expiresAt===input.expiresAt &&metadata.mode===input.capture.mode &&
        p?.source==='assignment' &&p.assignmentId===input.capture.assignmentId &&
        p.assignmentRevision===input.capture.assignmentRevision &&
        p.policyRevision===input.capture.policyRevision &&
        p.mode===input.capture.mode &&p.ttlDays===input.capture.retentionDays,
        'storage.capture_metadata_conflict')
    }
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
    const thumbnailPath=input.thumbnailAssetId?assetKey(this.scope,input.photoId,input.thumbnailAssetId)+'/'+attemptId:null
    const allPaths=[imagePath,metadataPath,...(thumbnailPath?[thumbnailPath]:[])].flatMap(path=>backend==='opfs'
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
        ...(input.thumbnail&&input.thumbnailAssetId&&thumbnailPath?[{assetId:input.thumbnailAssetId,kind:'thumbnail' as const,content:input.thumbnail,path:thumbnailPath}]:[]),
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
        metadataAssetId:input.metadataAssetId,thumbnailAssetId:input.thumbnailAssetId,
        ...(input.nameId?{nameId:input.nameId,namePending:true,leaseId:input.leaseId,nameNumber:input.nameNumber}:{namePending:true}),
        expiresAt:input.expiresAt,revision:input.revision,
        ...(input.capture?{capture:input.capture}:{}),operationId:input.operationId,state:'local',
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
      if(staged.some(x=>![imagePath,metadataPath,thumbnailPath].includes(x.manifest.storageKey))){
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
  /** NAME-ID is an allowed minimal technical header, never a primary key. */
  async setName(photoId:string,nameId:string,pending:boolean,leaseId?:string,number?:number):Promise<void>{
    const photo=await this.current(photoId)
    invalid(/^[A-Z]{4}[0-9]{4}$/.test(nameId),'gallery.name_invalid')
    if(leaseId)identifier(leaseId)
    await db.transaction('rw',db.photos,async()=>{
      this.check()
      const live=await db.photos.get(photoKey(this.scope,photoId))
      invalid(!!live&&live.state==='local'&&live.operationId===photo.operationId,'gallery.photo_changed')
      if(live.nameId && live.nameId!==nameId)throw Error('gallery.name_immutable')
      await db.photos.update(live.key,{nameId,namePending:pending,
        ...(leaseId?{leaseId,nameNumber:number}: {})})
    })
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
      (assetId===row.assetId || assetId===row.sourceAssetId || assetId===row.metadataAssetId || assetId===row.thumbnailAssetId),'storage.asset_unavailable')
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
  /** Crash-safe encrypted title/GPS revision, queued in the *existing* outbox. */
  async editMetadata(photoId:string,data:unknown):Promise<string>{
    const photo=await this.current(photoId),backend=await this.init()
    if(photo.capture){
      const meta=data as {policy?:Record<string,unknown>;capturedAt?:number;expiresAt?:number;mode?:number}
      const p=meta?.policy
      invalid(meta.capturedAt===photo.capture.capturedAt&&
        meta.expiresAt===photo.expiresAt&&meta.mode===photo.capture.mode&&
        p?.source==='assignment'&&p.assignmentId===photo.capture.assignmentId&&
        p.assignmentRevision===photo.capture.assignmentRevision&&
        p.policyRevision===photo.capture.policyRevision&&p.mode===photo.capture.mode&&
        p.ttlDays===photo.capture.retentionDays,'gallery.frozen_capture_changed')
    }
    const bytes=metadataEncoder.encode(JSON.stringify({version:1,capturedAt:(data as {capturedAt:number}).capturedAt,data}))
    invalid(bytes.length>0&&bytes.length<=256*1024,'gallery.metadata_too_large')
    const operationId=crypto.randomUUID(),assetId=crypto.randomUUID(),revision=photo.revision+1,attempt=crypto.randomUUID()
    const path=assetKey(this.scope,photoId,assetId)+'/'+attempt
    const journalKey=photoKey(this.scope,photoId)+'/'+attempt
    await db.journal.add({key:journalKey,operationId,accountId:this.scope.accountId,deviceId:this.scope.deviceId,
      photoId,attemptId:attempt,assetKeys:[backend+'|'+path],createdAt:this.time.now(),state:'staging'})
    let committed=false
    try{
      const {key,wrapped}=await this.grant.create(assetId,String(photo.expiresAt))
      const cipher=await encryptAsset(this.scope,photoId,assetId,'metadata',revision,photo.expiresAt,
        new Blob([bytes]),key,wrapped,backend,path,()=>this.check())
      await writeCiphertext(backend,path,cipher.blob,this.scope)
      const reloaded=await readCiphertext(backend,path)
      await decryptAsset(cipher.manifest,reloaded,key,this.scope,()=>this.check())
      await db.transaction('rw',[db.photos,db.assets,db.outbox,db.journal,db.tombstones],async()=>{
        this.check()
        const current=await db.photos.get(photoKey(this.scope,photoId))
        invalid(!!current&&current.state==='local'&&current.revision===photo.revision&&
          current.expiresAt===photo.expiresAt,'gallery.metadata_conflict')
        invalid(!await db.tombstones.get(photoKey(this.scope,photoId)),'gallery.tombstoned')
        await db.assets.add({key:assetKey(this.scope,photoId,assetId),...cipher.manifest})
        await db.photos.update(photoKey(this.scope,photoId),{metadataAssetId:assetId,revision})
        await db.outbox.add({key:this.scope.accountId+'/'+operationId,accountId:this.scope.accountId,
          photoId,operationId,intent:'metadata',metadataAssetId:assetId,expectedRevision:photo.revision,
          state:'pending',attempts:0,nextAttemptAt:0,expiresAt:photo.expiresAt})
        await db.journal.update(journalKey,{state:'cleanup'})
      })
      committed=true
      await db.journal.delete(journalKey)
      if(typeof window!=='undefined')window.dispatchEvent(new Event('photobunker-outbox'))
      return operationId
    }catch(error){
      if(!committed){await deleteCiphertext(backend,path).catch(()=>{});await db.journal.delete(journalKey).catch(()=>{})}
      throw error
    }
  }
  /** Metadata operations are durable rows in the same R2-04 outbox. */
  async metadataDelivery(operationId:string):Promise<{photoId:string;operationId:string;expectedRevision:number;asset:SyncSnapshot['assets'][number]}>{
    const task=await db.outbox.get(this.scope.accountId+'/'+operationId)
    invalid(!!task&&task.intent==='metadata'&&!!task.metadataAssetId&&Number.isSafeInteger(task.expectedRevision),'gallery.metadata_outbox_missing')
    const photo=await this.current(task.photoId)
    invalid(photo.revision>=task.expectedRevision!+1,'gallery.metadata_conflict')
    const record=await db.assets.get(assetKey(this.scope,photo.photoId,task.metadataAssetId!))
    invalid(!!record,'gallery.metadata_asset_missing')
    const {key,backend,storageKey,...manifest}=record
    void key
    const ciphertext=await readCiphertext(backend,storageKey)
    const sha256=await sha(new Uint8Array(await ciphertext.arrayBuffer()))
    this.check()
    return{photoId:photo.photoId,operationId,expectedRevision:task.expectedRevision!,
      asset:{assetId:record.assetId,kind:'metadata',revision:record.revision,
        bytes:ciphertext.size,sha256,manifest,ciphertext}}
  }
  async acknowledgeMetadata(operationId:string,assetId:string):Promise<void>{
    this.check()
    const task=await db.outbox.get(this.scope.accountId+'/'+operationId)
    invalid(!!task&&task.intent==='metadata'&&task.metadataAssetId===assetId,'gallery.ack_mismatch')
    const photo=await this.current(task.photoId)
    invalid(photo.revision>=task.expectedRevision!+1,'gallery.ack_stale')
    await db.transaction('rw',db.outbox,async()=>{
      this.check()
      await db.outbox.update(this.scope.accountId+'/'+operationId,{state:'acknowledged',attempts:0,nextAttemptAt:0})
    })
    const older=await db.assets.where('[accountId+photoId]')
      .equals([this.scope.accountId,photo.photoId]).filter(a=>a.kind==='metadata'&&
        a.revision<task.expectedRevision!+1&&a.assetId!==photo.metadataAssetId).toArray()
    for(const old of older){
      await deleteCiphertext(old.backend,old.storageKey)
      await db.assets.delete(old.key)
    }
  }
  /** R2-10 review decisions share the existing encrypted photo outbox, no extra queue. */
  /** Edit output is ephemeral until encrypted and readback-verified. A mode-3
   *  swap never removes its sole source before the new durable ciphertext exists. */
  async saveEdit(photoId:string,pixels:Blob):Promise<{operationId:string;revision:number;assetId:string}>{
    this.check();await this.clockReady();identifier(photoId)
    invalid(pixels instanceof Blob&&pixels.type==='image/jpeg'&&pixels.size>0&&
      pixels.size<=64*1024*1024,'editor.invalid_jpeg')
    const header=await this.current(photoId)
    const metadata=await this.readMetadata(photoId) as {mode?:number;policy?:{mode?:number}}
    const mode=metadata?.mode
    invalid((mode===2||mode===3)&&metadata.policy?.mode===mode&&
      (!header.capture||header.capture.mode===mode),'editor.mode_mismatch')
    // Local-first: a verified, durable original capture exists even before the
    // server ACK. Its initial ciphertext must remain pinned until uploaded.
    const originalUpload=await db.outbox.get(this.scope.accountId+'/'+header.operationId)
    invalid(!!originalUpload&&originalUpload.intent==='upload'&&
      originalUpload.state!=='cancelled','editor.original_unavailable')
    const pending=await db.outbox.where('accountId').equals(this.scope.accountId)
      .filter(x=>x.photoId===photoId&&x.intent==='edit'&&
        !['cancelled','acknowledged'].includes(x.state)).first()
    invalid(!pending,'editor.pending_edit')
    await assertJpegWithoutMetadata(pixels)
    const backend=await this.init()
    const operationId=crypto.randomUUID(),assetId=crypto.randomUUID(),attempt=crypto.randomUUID()
    const revision=(header.editRevision??0)+1,kind=mode===2?'edit':'master'
    const path=assetKey(this.scope,photoId,assetId)+'/'+attempt
    const reference=photoKey(this.scope,photoId),journalKey=reference+'/'+attempt
    await db.journal.add({key:journalKey,accountId:this.scope.accountId,deviceId:this.scope.deviceId,
      photoId,operationId,attemptId:attempt,
      assetKeys:backend==='opfs'?['opfs|'+path,'idb-blob|'+path]:['idb-blob|'+path],
      createdAt:this.time.now(),state:'staging'})
    let committed=false,actualBackend=backend
    try{
      const {key,wrapped}=await this.grant.create(assetId,String(header.expiresAt))
      const result=await encryptAsset(this.scope,photoId,assetId,kind,revision,header.expiresAt,
        pixels,key,wrapped,backend,path,()=>{this.check();this.time.now()})
      let manifest:CipherManifest={...result.manifest,backend,storageKey:path}
      try{
        await writeCiphertext(backend,path,result.blob,this.scope)
        const check=await readCiphertext(backend,path)
        const clear=await decryptAsset(manifest,check,key,this.scope,()=>{this.check();this.time.now()})
        invalid(clear.size===pixels.size,'editor.readback_failed')
      }catch(e){
        if(backend!=='opfs'||!(await probeStorageCapabilities()).fallbackBlob)throw e
        await writeCiphertext('idb-blob',path,result.blob,this.scope)
        actualBackend='idb-blob'
        manifest={...result.manifest,backend:actualBackend,storageKey:path}
        const check=await readCiphertext(actualBackend,path)
        const clear=await decryptAsset(manifest,check,key,this.scope,()=>{this.check();this.time.now()})
        invalid(clear.size===pixels.size,'editor.readback_failed')
      }
      await db.transaction('rw',[db.photos,db.assets,db.outbox,db.journal,db.tombstones],async()=>{
        this.check()
        const row=await db.photos.get(reference)
        invalid(!!row&&row.state==='local'&&row.assetId===header.assetId &&
          (row.editRevision??0)===(revision-1)&&row.expiresAt===header.expiresAt,
          'editor.revision_conflict')
        invalid(!await db.tombstones.get(reference)&&row.expiresAt>this.time.now(),
          'editor.expired')
        const other=await db.outbox.where('accountId').equals(this.scope.accountId)
          .filter(x=>x.photoId===photoId&&x.intent==='edit'&&
            !['cancelled','acknowledged'].includes(x.state)).first()
        invalid(!other,'editor.concurrent_edit')
        await db.assets.add({key:assetKey(this.scope,photoId,assetId),...manifest})
        await db.photos.update(reference,{
          assetId,editRevision:revision,
          // Preserve the immutable shutter-time upload set before changing the
          // current rendition pointer. Both IDs may outlive the first edit.
          initialAssetId:row.initialAssetId??row.assetId,
          initialThumbnailAssetId:row.initialThumbnailAssetId??row.thumbnailAssetId,
          ...(mode===2?{sourceAssetId:row.sourceAssetId??row.assetId}:
            {thumbnailAssetId:undefined,sourceAssetId:undefined}),
        })
        await db.outbox.add({key:this.scope.accountId+'/'+operationId,
          accountId:this.scope.accountId,photoId,operationId,
          intent:'edit',editAssetId:assetId,editMode:mode,expectedRevision:revision-1,
          state:'pending',attempts:0,nextAttemptAt:0,expiresAt:header.expiresAt})
        await db.journal.update(journalKey,{state:'cleanup'})
      })
      committed=true
      // Local mode 3 must not keep a second master once the replacement is durable.
      await this.cleanReplacedRenditions(photoId)
      // OPFS→IDB fallback can leave a failed OPFS candidate. Delete every
      // unreferenced backend before deleting the durable recovery journal.
      if(backend!==actualBackend)await deleteCiphertext(backend,path)
      await db.journal.delete(journalKey)
      if(typeof window!=='undefined')window.dispatchEvent(new Event('photobunker-outbox'))
      return{operationId,revision,assetId}
    }catch(e){
      if(!committed){
        const pointer=await db.assets.get(assetKey(this.scope,photoId,assetId))
        if(!pointer){
          let cleaned=true
          for(const target of [...new Set([backend,actualBackend])] as StorageBackend[]){
            try{await deleteCiphertext(target,path)}catch{cleaned=false}
          }
          if(cleaned)await db.journal.delete(journalKey).catch(()=>{})
        }
      }
      throw e
    }
  }
  /** Removes only ciphertext no longer named by an active photo pointer. */
  private async cleanReplacedRenditions(photoId:string):Promise<void>{
    const current=await this.current(photoId)
    const initialUpload=await db.outbox.get(this.scope.accountId+'/'+current.operationId)
    const protectOriginal=!!initialUpload&&initialUpload.state!=='acknowledged'
    const originalId=current.initialAssetId??current.assetId
    const thumbnailId=current.initialThumbnailAssetId??current.thumbnailAssetId
    const objects=await db.assets.where('[accountId+photoId]')
      .equals([this.scope.accountId,photoId]).toArray()
    for(const a of objects){
      this.check()
      if(!['master','edit','thumbnail'].includes(a.kind)||
        a.assetId===current.assetId||a.assetId===current.sourceAssetId||
        a.assetId===current.thumbnailAssetId||
        protectOriginal&&(a.assetId===originalId||a.assetId===thumbnailId))continue
      // Do not delete until another master/edit has been stored and CAS committed.
      await deleteCiphertext(a.backend,a.storageKey)
      await db.assets.delete(a.key)
      if(a.kind==='thumbnail')await db.thumbnailCache.delete(a.key)
    }
  }
  async initialUploadAcknowledged(photoId:string):Promise<boolean>{
    const photo=await this.current(photoId)
    const row=await db.outbox.get(this.scope.accountId+'/'+photo.operationId)
    this.check()
    return row?.intent==='upload'&&row.state==='acknowledged'
  }
  async editDelivery(operationId:string):Promise<{photoId:string;operationId:string;
    expectedRevision:number;mode:2|3;asset:SyncSnapshot['assets'][number]}>{
    this.check();identifier(operationId)
    const task=await db.outbox.get(this.scope.accountId+'/'+operationId)
    invalid(!!task&&task.intent==='edit'&&!!task.editAssetId&&
      (task.editMode===2||task.editMode===3)&&Number.isSafeInteger(task.expectedRevision),
      'editor.outbox_missing')
    const photo=await this.current(task.photoId)
    invalid(photo.expiresAt===task.expiresAt&&photo.assetId===task.editAssetId&&
      photo.editRevision===task.expectedRevision!+1,'editor.edit_conflict')
    const record=await db.assets.get(assetKey(this.scope,photo.photoId,task.editAssetId!))
    invalid(!!record&&record.kind===(task.editMode===2?'edit':'master'),
      'editor.asset_missing')
    const {key,backend,storageKey,...manifest}=record
    void key
    manifestValid({...manifest,backend,storageKey},{scope:this.scope,photoId:photo.photoId,
      assetId:record.assetId})
    const ciphertext=await readCiphertext(backend,storageKey)
    invalid(ciphertext.size===record.cipherBytes,'editor.ciphertext_missing')
    const digest=await sha(new Uint8Array(await ciphertext.arrayBuffer()))
    this.check()
    return{photoId:photo.photoId,operationId,expectedRevision:task.expectedRevision!,
      mode:task.editMode!,asset:{assetId:record.assetId,kind:record.kind,revision:record.revision,
        bytes:record.cipherBytes,sha256:digest,manifest,ciphertext}}
  }
  async acknowledgeEdit(operationId:string,assetId:string,revision:number):Promise<void>{
    const edit=await this.editDelivery(operationId)
    invalid(edit.asset.assetId===assetId && edit.expectedRevision+1===revision,
      'editor.ack_conflict')
    await db.outbox.update(this.scope.accountId+'/'+operationId,
      {state:'acknowledged',lastError:undefined,attempts:0,nextAttemptAt:0})
  }
  async markEditConflict(operationId:string):Promise<void>{
    await this.editDelivery(operationId)
    await db.outbox.update(this.scope.accountId+'/'+operationId,
      {state:'conflict',lastError:'editor.server_conflict'})
  }
  async queueReview(photoId:string,action:'review'|'respond',state:Exclude<ReviewDecision,'pending'>|null,comment:string):Promise<string>{
    this.check();await this.clockReady();identifier(photoId)
    invalid(action==='review'&&['accepted','correction','reshoot','rejected'].includes(state??'')||
      action==='respond'&&state===null,'review.state_invalid')
    invalid(typeof comment==='string'&&[...comment].length<=2000&&
      (action==='review'&&state==='accepted'||comment.trim().length>0),'review.comment_invalid')
    const row=await this.current(photoId)
    invalid(!!row.capture,'review.assignment_required')
    const old=await db.outbox.where('accountId').equals(this.scope.accountId)
      .filter(x=>x.photoId===photoId&&x.intent==='review'&&
        !['acknowledged','cancelled'].includes(x.state)).first()
    invalid(!old,'review.pending_conflict_resolve_first')
    if(action==='respond')invalid(['correction','reshoot'].includes(row.reviewState??''),'review.response_not_allowed')
    const revision=row.reviewRevision??1,operationId=crypto.randomUUID()
    const {key,wrapped}=await this.grant.create(operationId,'photo-review-v1')
    const iv=crypto.getRandomValues(new Uint8Array(12))
    const clear=metadataEncoder.encode(JSON.stringify({comment}))
    const aad=metadataEncoder.encode('photobunker.review.v1|'+this.scope.accountId+'|'+photoId+'|'+operationId+'|'+(revision+1))
    let cipher:ArrayBuffer
    try{cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,clear)}
    finally{clear.fill(0)}
    const b64=(a:Uint8Array)=>{
      let value='';for(const b of a)value+=String.fromCharCode(b)
      return btoa(value).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
    }
    const envelope:ReviewEnvelope={v:1,accountId:this.scope.accountId,photoId,operationId,
      revision:revision+1,iv:b64(iv),wrappedDEK:wrapped,ciphertext:b64(new Uint8Array(cipher))}
    const contract:ReviewContract={v:1,photoId,operationId,expectedRevision:revision,
      action,state,envelope}
    await db.transaction('rw',[db.photos,db.outbox,db.tombstones],async()=>{
      this.check()
      const current=await db.photos.get(photoKey(this.scope,photoId))
      invalid(!!current&&current.operationId===row.operationId&&
        (current.reviewRevision??1)===revision,'review.local_conflict')
      invalid(!await db.tombstones.get(photoKey(this.scope,photoId)),'review.expired')
      const newState=action==='review'?state!:row.reviewState??'pending'
      await db.photos.update(photoKey(this.scope,photoId),{
        reviewRevision:revision+1,reviewState:newState,
        ...(action==='review'?{reviewEnvelope:envelope,responseEnvelope:null}:{responseEnvelope:envelope}),
      })
      await db.outbox.add({key:this.scope.accountId+'/'+operationId,accountId:this.scope.accountId,
        photoId,operationId,intent:'review',reviewContract:contract,
        state:'pending',attempts:0,nextAttemptAt:0,expiresAt:row.expiresAt})
    })
    if(typeof window!=='undefined')window.dispatchEvent(new Event('photobunker-outbox'))
    return operationId
  }
  async reviewDelivery(operationId:string):Promise<ReviewContract>{
    this.check();identifier(operationId)
    const row=await db.outbox.get(this.scope.accountId+'/'+operationId)
    invalid(!!row&&row.intent==='review'&&!!row.reviewContract,'review.outbox_missing')
    const photo=await this.current(row.photoId)
    invalid(!!photo.capture&&photo.expiresAt===row.expiresAt,'review.policy_expired')
    // The review outbox is the existing PHOTO outbox: never race review with its upload.
    const upload=await db.outbox.get(this.scope.accountId+'/'+photo.operationId)
    invalid(!!upload&&upload.intent==='upload'&&upload.state==='acknowledged',
      'review.photo_not_synced')
    return row.reviewContract
  }
  async acknowledgeReview(operationId:string,revision:number):Promise<void>{
    const contract=await this.reviewDelivery(operationId)
    invalid(contract.expectedRevision+1===revision,'review.receipt_mismatch')
    await db.transaction('rw',db.outbox,async()=>{
      this.check()
      const row=await db.outbox.get(this.scope.accountId+'/'+operationId)
      invalid(!!row&&row.intent==='review'&&
        JSON.stringify(row.reviewContract)===JSON.stringify(contract),'review.op_changed')
      await db.outbox.update(row.key,{state:'acknowledged',attempts:0,nextAttemptAt:0,lastError:undefined})
    })
  }
  async conflictReview(operationId:string):Promise<void>{
    await this.reviewDelivery(operationId)
    await db.outbox.update(this.scope.accountId+'/'+operationId,
      {state:'conflict',lastError:'review.conflict'})
  }
  async reviewStatus(photoId:string):Promise<'pending'|'conflict'|'synced'>{
    this.check()
    const rows=await db.outbox.where('accountId').equals(this.scope.accountId)
      .filter(x=>x.photoId===photoId&&x.intent==='review'&&
        !['acknowledged','cancelled'].includes(x.state)).toArray()
    return rows.some(x=>x.state==='conflict')?'conflict':rows.length?'pending':'synced'
  }
  async reviewDetails(photoId:string):Promise<{state:ReviewDecision;revision:number;reviewComment:string;responseComment:string;sync:string}>{
    const photo=await this.current(photoId)
    invalid(!!photo.capture,'review.assignment_required')
    const open=async(e?:ReviewEnvelope|null):Promise<string>=>{
      if(!e)return ''
      invalid(e.accountId===this.scope.accountId&&e.photoId===photoId,'review.wrong_scope')
      const key=await this.grant.open(e.operationId,'photo-review-v1',e.wrappedDEK)
      const decode=(raw:string)=>{
        const bytes=Uint8Array.from(atob(raw.replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0))
        return bytes
      }
      const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(e.iv),
        additionalData:metadataEncoder.encode('photobunker.review.v1|'+e.accountId+'|'+photoId+'|'+e.operationId+'|'+e.revision)},
        key,decode(e.ciphertext))
      const value=JSON.parse(metadataDecoder.decode(clear)) as {comment:string}
      invalid(typeof value.comment==='string','review.payload_invalid')
      return value.comment
    }
    const [reviewComment,responseComment]=await Promise.all([
      open(photo.reviewEnvelope),open(photo.responseEnvelope)])
    this.check()
    return{state:photo.reviewState??'pending',revision:photo.reviewRevision??1,
      reviewComment,responseComment,sync:await this.reviewStatus(photoId)}
  }
  async ingestReview(remote:ReviewSnapshot):Promise<void>{
    this.check()
    const current=await this.current(remote.photoId)
    invalid(!!current.capture&&current.capture.assignmentId===remote.assignmentId &&
      Number.isInteger(remote.revision)&&remote.revision>=1 &&
      ['pending','accepted','correction','reshoot','rejected'].includes(remote.state),'review.remote_invalid')
    if(await this.reviewStatus(remote.photoId)!=='synced')return
    if((current.reviewRevision??1)>remote.revision)return
    // Authenticated ciphertext is checked before replacing a previous local view.
    const envelopes=[remote.reviewEnvelope,remote.responseEnvelope].filter(Boolean)
    for(const envelope of envelopes){
      const e=envelope!
      invalid(e.accountId===this.scope.accountId&&e.photoId===remote.photoId,'review.wrong_scope')
      const key=await this.grant.open(e.operationId,'photo-review-v1',e.wrappedDEK)
      const from=(x:string)=>Uint8Array.from(atob(x.replace(/-/g,'+').replace(/_/g,'/')),v=>v.charCodeAt(0))
      await crypto.subtle.decrypt({name:'AES-GCM',iv:from(e.iv),
        additionalData:metadataEncoder.encode('photobunker.review.v1|'+e.accountId+'|'+e.photoId+'|'+e.operationId+'|'+e.revision)},key,from(e.ciphertext))
    }
    await db.photos.update(photoKey(this.scope,remote.photoId),{
      reviewState:remote.state,reviewRevision:remote.revision,
      reviewEnvelope:remote.reviewEnvelope,responseEnvelope:remote.responseEnvelope,
    })
  }
  async acceptReviewConflict(remote:ReviewSnapshot):Promise<void>{
    this.check()
    const photo=await this.current(remote.photoId)
    invalid(!!photo.capture&&photo.capture.assignmentId===remote.assignmentId&&
      remote.revision>=1&&['pending','accepted','correction','reshoot','rejected'].includes(remote.state),
      'review.remote_invalid')
    // Verify all remote ciphertext before discarding a local conflict.
    for(const e of [remote.reviewEnvelope,remote.responseEnvelope]){
      if(!e)continue
      invalid(e.accountId===this.scope.accountId&&e.photoId===remote.photoId,'review.wrong_scope')
      const key=await this.grant.open(e.operationId,'photo-review-v1',e.wrappedDEK)
      const decode=(v:string)=>Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))
      await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(e.iv),
        additionalData:metadataEncoder.encode('photobunker.review.v1|'+e.accountId+'|'+e.photoId+'|'+e.operationId+'|'+e.revision)},
        key,decode(e.ciphertext))
    }
    await db.transaction('rw',[db.outbox,db.photos],async()=>{
      const pending=await db.outbox.where('accountId').equals(this.scope.accountId)
        .filter(x=>x.photoId===remote.photoId&&x.intent==='review'&&x.state==='conflict').toArray()
      if(!pending.length)throw Error('review.no_conflict')
      for(const op of pending)await db.outbox.update(op.key,{state:'cancelled'})
    })
    await this.ingestReview(remote)
  }
  async pending():Promise<StoredOutbox[]>{
    this.check();await this.clockReady()
    const now=this.time.now()
    const all=await db.outbox.where('accountId').equals(this.scope.accountId).toArray()
    this.check()
    return all.filter(x=>x.state!=='cancelled'&&x.state!=='acknowledged'&&x.state!=='conflict'&&x.expiresAt>now)
      .sort((a,b)=>(a.intent==='upload'?0:a.intent==='metadata'?1:a.intent==='edit'?2:3)-
        (b.intent==='upload'?0:b.intent==='metadata'?1:b.intent==='edit'?2:3)||
        (a.reviewContract?.expectedRevision??0)-(b.reviewContract?.expectedRevision??0))
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
      await db.outbox.update(key,{state:'retry',nextAttemptAt:0,lastError:undefined})
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
    // The visible asset pointer may already be a local offline edit. Upload
    // precisely the original shutter-time ciphertext, never a later revision.
    const {primary:initialAssetId,thumbnail:initialThumbId,
      metadata:initialMetadataId}=originalUploadPointers(photo)
    const baseline=records.filter(x=>
      x.assetId===initialAssetId||
      x.assetId===initialMetadataId&&x.kind==='metadata'&&x.revision===1||
      initialThumbId!==undefined&&x.assetId===initialThumbId)
    invalid(baseline.length>=2&&baseline.length<=3&&
      baseline.some(x=>x.assetId===initialAssetId&&
        (x.kind==='master'||x.kind==='original'))&&
      baseline.some(x=>x.kind==='metadata'&&x.revision===1),
      'sync.assets_incomplete')
    const assets=[]
    for(const asset of baseline){
      this.check()
      invalid(asset.assetId===initialAssetId||asset.kind==='metadata'&&asset.revision===1||
        asset.assetId===initialThumbId,'sync.asset_unexpected')
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
    return{photoId:photo.photoId,operationId,expiresAt:photo.expiresAt,assets,...(photo.capture?{capture:photo.capture}:{})}
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
    // Safe after acknowledged original receipt; never prune baseline earlier.
    await this.cleanReplacedRenditions(data.photoId)
  }
  async syncState(photoId:string):Promise<SyncState>{
    this.check();identifier(photoId)
    if(await db.tombstones.get(photoKey(this.scope,photoId)))return 'expired'
    const photo=await db.photos.get(photoKey(this.scope,photoId))
    if(!photo||photo.state!=='local')return 'expired'
    if(!this.time.status().trusted)return 'local'
    if(this.time.now()>=photo.expiresAt)return 'expired'
    const tasks=await db.outbox.where('accountId').equals(this.scope.accountId)
      .filter(task=>task.photoId===photoId&&task.state!=='cancelled').toArray()
    if(tasks.some(task=>task.state==='retry'||task.state==='conflict'))return 'retry'
    if(tasks.some(task=>task.state!=='acknowledged'))return 'local'
    const original=tasks.find(task=>task.operationId===photo.operationId)
    return original?.state==='acknowledged'?'synced':'local'
  }
  /** Remote E2EE object: validate scope/digest before opening only in volatile memory. */
  async decryptRemote(photoId:string,asset:{assetId:string;kind:'thumbnail'|'metadata';revision:number;
    bytes:number;sha256:string;manifest:Omit<CipherManifest,'backend'|'storageKey'>},ciphertext:Blob):Promise<Blob>{
    this.check();await this.clockReady();identifier(photoId)
    invalid(ciphertext.size===asset.bytes,'gallery.remote_length')
    const hash=await sha(new Uint8Array(await ciphertext.arrayBuffer()))
    invalid(hash===asset.sha256,'gallery.remote_checksum')
    const storageKey=assetKey(this.scope,photoId,asset.assetId)+'/'+crypto.randomUUID()
    const manifest:CipherManifest={...asset.manifest,backend:'idb-blob',storageKey}
    manifestValid(manifest,{scope:this.scope,photoId,assetId:asset.assetId})
    invalid(manifest.kind===asset.kind&&manifest.cipherBytes===asset.bytes&&
      manifest.expiresAt>this.time.now(),'gallery.remote_expired')
    const key=await this.grant.open(asset.assetId,String(manifest.expiresAt),manifest.wrappedDEK)
    return decryptAsset(manifest,ciphertext,key,this.scope,()=>{this.check();this.time.now()})
  }
  /** Confirmed thumbnail ciphertext may be evicted; unsynced upload assets never are. */
  async cacheThumbnail(photoId:string):Promise<void>{
    const photo=await this.current(photoId)
    if(!photo.thumbnailAssetId||await this.syncState(photoId)!=='synced')return
    const asset=await db.assets.get(assetKey(this.scope,photoId,photo.thumbnailAssetId))
    if(!asset)return
    const key=assetKey(this.scope,photoId,photo.thumbnailAssetId)
    await db.thumbnailCache.put({key,accountId:this.scope.accountId,photoId,assetId:photo.thumbnailAssetId,
      backend:asset.backend,storageKey:asset.storageKey,bytes:asset.cipherBytes,
      expiresAt:photo.expiresAt,accessedAt:this.time.now()})
    await this.trimThumbnailCache()
  }
  async trimThumbnailCache():Promise<void>{
    this.check()
    const now=this.time.now()
    const entries=await db.thumbnailCache.where('accountId').equals(this.scope.accountId).toArray()
    entries.sort((a,b)=>a.accessedAt-b.accessedAt)
    let total=entries.reduce((n,item)=>n+item.bytes,0),count=entries.length
    for(const item of entries){
      if(item.expiresAt>now&&total<=64*1024*1024&&count<=500)break
      const photo=await db.photos.get(photoKey(this.scope,item.photoId))
      const out=photo?await db.outbox.get(this.scope.accountId+'/'+photo.operationId):null
      if(photo&&out?.state!=='acknowledged'&&item.expiresAt>now)continue
      // Delete only local cached ciphertext. Manifest remains for authorized cloud re-download.
      await deleteCiphertext(item.backend,item.storageKey)
      await db.thumbnailCache.delete(item.key)
      total-=item.bytes;count--
    }
  }

  /** Import a server-authorized encrypted photo without ever writing plaintext or duplicating UUIDs. */
  async importCloud(photo:CloudPhoto,downloaded:ReadonlyArray<{asset:CloudAsset;blob:Blob}>):Promise<boolean>{
    this.check();await this.clockReady()
    identifier(photo.photoId)
    invalid(photo.expiresAt>this.time.now(),'gallery.cloud_expired')
    if(await db.tombstones.get(photoKey(this.scope,photo.photoId)))return false
    if(await db.photos.get(photoKey(this.scope,photo.photoId)))return false
    const originals=downloaded.filter(x=>x.asset.kind==='master'||x.asset.kind==='original')
    const edits=downloaded.filter(x=>x.asset.kind==='edit')
    const metadata=downloaded.filter(x=>x.asset.kind==='metadata'&&x.asset.assetId===photo.metadataAssetId)
    const thumbnails=downloaded.filter(x=>x.asset.kind==='thumbnail')
    invalid(originals.length===1&&edits.length<=1&&metadata.length===1&&thumbnails.length<=1,
      'gallery.cloud_objects_invalid')
    const backend=await this.init()
    const attempt=crypto.randomUUID(),journalKey=photoKey(this.scope,photo.photoId)+'/'+attempt
    const paths=downloaded.map(x=>assetKey(this.scope,photo.photoId,x.asset.assetId)+'/'+attempt)
    await db.journal.add({key:journalKey,accountId:this.scope.accountId,deviceId:this.scope.deviceId,
      photoId:photo.photoId,operationId:photo.photoId,attemptId:attempt,assetKeys:paths.map(path=>backend+'|'+path),
      state:'staging',createdAt:this.time.now()})
    const staged:CipherManifest[]=[]
    let published=false
    try{
      for(let i=0;i<downloaded.length;i++){
        this.check()
        const {asset,blob}=downloaded[i]!,path=paths[i]!
        invalid(asset.manifest.accountId===this.scope.accountId&&asset.manifest.photoId===photo.photoId&&
          asset.manifest.assetId===asset.assetId&&asset.manifest.kind===asset.kind&&
          asset.manifest.expiresAt===photo.expiresAt,'gallery.cloud_scope')
        const m:CipherManifest={...asset.manifest,backend,storageKey:path}
        manifestValid(m,{scope:this.scope,photoId:photo.photoId,assetId:asset.assetId})
        invalid(blob.size===asset.bytes,'gallery.cloud_truncated')
        const digest=await sha(new Uint8Array(await blob.arrayBuffer()))
        invalid(digest===asset.sha256,'gallery.cloud_digest')
        const key=await this.grant.open(asset.assetId,String(photo.expiresAt),m.wrappedDEK)
        await decryptAsset(m,blob,key,this.scope,()=>{this.check();this.time.now()})
        await writeCiphertext(backend,path,blob,this.scope)
        staged.push(m)
      }
      const main=edits[0]?.asset??originals[0]!.asset
      invalid((photo.editRevision??0)===0 || main.assetId===photo.editAssetId,'gallery.edit_pointer_mismatch')
      const stored:PhotoRow={key:photoKey(this.scope,photo.photoId),accountId:this.scope.accountId,
        photoId:photo.photoId,assetId:main.assetId,metadataAssetId:photo.metadataAssetId,
        editRevision:photo.editRevision??0,
        ...(edits.length?{sourceAssetId:originals[0]!.asset.assetId}:{}),
        thumbnailAssetId:thumbnails[0]?.asset.assetId,expiresAt:photo.expiresAt,
        state:'local',revision:photo.metadataRevision,operationId:photo.photoId,
        ...(photo.nameId?{nameId:photo.nameId,namePending:false}:{namePending:true})}
      await db.transaction('rw',[db.photos,db.assets,db.outbox,db.journal,db.tombstones],async()=>{
        this.check()
        if(await db.tombstones.get(stored.key))throw Error('gallery.tombstoned')
        if(await db.photos.get(stored.key))throw Error('gallery.cloud_conflict')
        await db.photos.add(stored)
        for(const m of staged)await db.assets.add({key:assetKey(this.scope,photo.photoId,m.assetId),...m})
        await db.outbox.put({key:this.scope.accountId+'/'+photo.photoId,
          accountId:this.scope.accountId,photoId:photo.photoId,operationId:photo.photoId,
          state:'acknowledged',intent:'upload',expiresAt:photo.expiresAt,
          attempts:0,nextAttemptAt:0})
        await db.journal.update(journalKey,{state:'cleanup'})
      })
      published=true
      await db.journal.delete(journalKey)
      return true
    }catch(error){
      if(!published){
        for(const m of staged)await deleteCiphertext(m.backend,m.storageKey).catch(()=>{})
        await db.journal.delete(journalKey).catch(()=>{})
      }
      throw error
    }
  }

  /** Authenticated cloud revision from another trusted device. Refuse to
   * overwrite a locally pending edit; never persist a decrypted staging copy. */
  async adoptCloudEdit(photo:CloudPhoto,asset:CloudAsset,ciphertext:Blob):Promise<boolean>{
    this.check();await this.clockReady()
    const row=await this.current(photo.photoId)
    const next=photo.editRevision??0,previous=row.editRevision??0
    if(next<=previous)return false
    invalid(next===previous+1 || next>previous,'editor.cloud_revision_invalid')
    invalid(!!photo.editAssetId&&asset.assetId===photo.editAssetId&&
      asset.revision===next,'editor.cloud_asset_invalid')
    const metadata=await this.readMetadata(photo.photoId) as {mode?:number}
    const kind=metadata.mode===2?'edit':metadata.mode===3?'master':null
    invalid(kind!==null&&asset.kind===kind&&photo.expiresAt===row.expiresAt,
      'editor.cloud_mode_mismatch')
    const outstanding=await db.outbox.where('accountId').equals(this.scope.accountId)
      .filter(task=>task.photoId===photo.photoId&&task.state!=='acknowledged'&&
        task.state!=='cancelled').first()
    if(outstanding)return false
    invalid(asset.manifest.accountId===this.scope.accountId&&
      asset.manifest.photoId===photo.photoId&&
      asset.manifest.assetId===asset.assetId&&asset.manifest.kind===asset.kind&&
      asset.manifest.expiresAt===row.expiresAt,'editor.cloud_scope')
    invalid(ciphertext.size===asset.bytes&&
      await sha(new Uint8Array(await ciphertext.arrayBuffer()))===asset.sha256,
      'editor.cloud_digest')
    const backend=await this.init(),attempt=crypto.randomUUID()
    const path=assetKey(this.scope,photo.photoId,asset.assetId)+'/'+attempt
    const journalKey=photoKey(this.scope,photo.photoId)+'/'+attempt
    const key=await this.grant.open(asset.assetId,String(row.expiresAt),asset.manifest.wrappedDEK)
    const manifest:CipherManifest={...asset.manifest,backend,storageKey:path}
    manifestValid(manifest,{scope:this.scope,photoId:photo.photoId,assetId:asset.assetId})
    await decryptAsset(manifest,ciphertext,key,this.scope,()=>{this.check();this.time.now()})
    await db.journal.add({key:journalKey,accountId:this.scope.accountId,deviceId:this.scope.deviceId,
      photoId:photo.photoId,operationId:photo.photoId,attemptId:attempt,
      assetKeys:[backend+'|'+path],state:'staging',createdAt:this.time.now()})
    let committed=false
    try{
      await writeCiphertext(backend,path,ciphertext,this.scope)
      await decryptAsset(manifest,await readCiphertext(backend,path),key,
        this.scope,()=>{this.check();this.time.now()})
      await db.transaction('rw',[db.photos,db.assets,db.outbox,db.journal,db.tombstones],async()=>{
        this.check()
        const now=await db.photos.get(photoKey(this.scope,photo.photoId))
        invalid(!!now&&now.assetId===row.assetId&&
          (now.editRevision??0)===previous&&now.expiresAt===photo.expiresAt,
          'editor.concurrent_cloud_edit')
        invalid(!await db.tombstones.get(now.key)&&now.expiresAt>this.time.now(),
          'editor.cloud_expired')
        const queued=await db.outbox.where('accountId').equals(this.scope.accountId)
          .filter(x=>x.photoId===photo.photoId&&!['acknowledged','cancelled'].includes(x.state)).first()
        invalid(!queued,'editor.local_changes_pending')
        await db.assets.add({key:assetKey(this.scope,photo.photoId,asset.assetId),...manifest})
        await db.photos.update(now.key,{assetId:asset.assetId,editRevision:next,
          ...(kind==='edit'?{sourceAssetId:now.sourceAssetId??now.assetId}:
            {sourceAssetId:undefined,thumbnailAssetId:undefined})})
        await db.journal.update(journalKey,{state:'cleanup'})
      })
      committed=true
      await this.cleanReplacedRenditions(photo.photoId)
      await db.journal.delete(journalKey)
      return true
    }catch(e){
      if(!committed){
        const live=await db.assets.get(assetKey(this.scope,photo.photoId,asset.assetId))
        if(!live){
          try{await deleteCiphertext(backend,path);await db.journal.delete(journalKey)}
          catch{/* journal cleanup at next restart */}
        }
      }
      throw e
    }
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
    await db.transaction('rw',[db.photos,db.assets,db.outbox,db.thumbnailCache],async()=>{
      this.check()
      for(const item of assets)await db.assets.delete(item.key)
      await db.thumbnailCache.where('[accountId+photoId]').equals([this.scope.accountId,photoId]).delete()
      const photo=await db.photos.get(key)
      const operations=await db.outbox.where('accountId').equals(this.scope.accountId)
        .filter(row=>row.photoId===photoId).primaryKeys()
      await db.outbox.bulkDelete(operations)
      if(photo)await db.photos.delete(key)
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
      // Restart after mode3 pointer CAS: scrub old master blobs even if the
      // browser crashed between durable commit and delete.
      const live=await db.photos.where('accountId').equals(this.scope.accountId).toArray()
      for(const row of live){
        if(row.state==='local'&&row.expiresAt>this.time.now()&&(row.editRevision??0)>0)
          await this.cleanReplacedRenditions(row.photoId)
      }
    }
  }
}
export function openLocalPhotoVault():LocalPhotoVault{return new LocalPhotoVault()}
