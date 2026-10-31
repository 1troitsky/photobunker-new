import Dexie, { type Table } from 'dexie'
import type { CipherManifest, OutboxEntry, PhotoHeader, Scope, StorageBackend } from '../domain/contracts'

export type PhotoRow=PhotoHeader & {key:string}
export type ManifestRow=CipherManifest & {key:string}
export type JournalRow={
  key:string; operationId:string; accountId:string; deviceId:string; photoId:string
  attemptId:string; assetKeys:string[]; createdAt:number; state:'staging'|'cleanup'
}
export type BlobRow={key:string; accountId:string; blob:Blob}
export type ClockRow={key:string;accountId:string;deviceId:string;iv:string;ciphertext:string;
  wrappedDEK:{iv:string;ciphertext:string}}
export type TombstoneRow={key:string;accountId:string;photoId:string;expiresAt:number;confirmedAt:number}
export type StoredOutbox=OutboxEntry & {key:string}
export type NameLeaseRow={key:string;accountId:string;deviceId:string;leaseId:string;assignmentId?:string|null;
  iv:string;ciphertext:Blob;wrappedDEK:{iv:string;ciphertext:string}}
export type ThumbnailCacheRow={key:string;accountId:string;photoId:string;assetId:string;bytes:number;accessedAt:number;expiresAt:number;backend:StorageBackend;storageKey:string}
export class PhotoDatabase extends Dexie{
  photos!:Table<PhotoRow,string>
  assets!:Table<ManifestRow,string>
  journal!:Table<JournalRow,string>
  blobFallback!:Table<BlobRow,string>
  outbox!:Table<StoredOutbox,string>
  clock!:Table<ClockRow,string>
  tombstones!:Table<TombstoneRow,string>
  nameLeases!:Table<NameLeaseRow,string>
  thumbnailCache!:Table<ThumbnailCacheRow,string>
  constructor(){
    super('photobunker-encrypted-local-v1')
    this.version(1).stores({
      photos:'&key, accountId, [accountId+expiresAt], [accountId+state], &[accountId+operationId]',
      assets:'&key,accountId, [accountId+photoId]',
      journal:'&key,accountId,operationId',
      blobFallback:'&key,accountId',
      outbox:'&key,accountId, [accountId+state], [accountId+expiresAt], &[accountId+operationId]',
      clock:'&key,accountId',
      tombstones:'&key,accountId,[accountId+expiresAt]',
    })
    this.version(2).stores({
      photos:'&key, accountId, [accountId+expiresAt], [accountId+state], &[accountId+operationId]',
      assets:'&key,accountId, [accountId+photoId]',
      journal:'&key,accountId,operationId',
      blobFallback:'&key,accountId',
      outbox:'&key,accountId, [accountId+state], [accountId+expiresAt], &[accountId+operationId]',
      clock:'&key,accountId',
      tombstones:'&key,accountId,[accountId+expiresAt]',
      nameLeases:'&key,accountId,[accountId+deviceId]',
      thumbnailCache:'&key,accountId,[accountId+accessedAt],[accountId+photoId]',
    })
    this.version(3).stores({
      photos:'&key, accountId, [accountId+expiresAt], [accountId+state], &[accountId+operationId]',
      assets:'&key,accountId,[accountId+photoId]',
      journal:'&key,accountId,operationId',
      blobFallback:'&key,accountId',
      outbox:'&key,accountId,[accountId+state],[accountId+expiresAt],&[accountId+operationId]',
      clock:'&key,accountId',
      tombstones:'&key,accountId,[accountId+expiresAt]',
      nameLeases:'&key,accountId,[accountId+deviceId],[accountId+deviceId+assignmentId]',
      thumbnailCache:'&key,accountId,[accountId+accessedAt],[accountId+photoId]',
    })
  }
}
export const db=new PhotoDatabase()
export const photoKey=(scope:Scope,photoId:string)=>scope.accountId+'/'+photoId
export const assetKey=(scope:Scope,photoId:string,assetId:string)=>scope.accountId+'/'+photoId+'/'+assetId
export const clockKey=(scope:Scope)=>scope.accountId+'/'+scope.deviceId

function fileName(path:string):string[]{
  const parts=path.split('/')
  if(parts.length!==4 || parts.some(part=>!/^[0-9a-f-]{36}$/.test(part)))
    throw new Error('storage.invalid_path')
  return parts
}
async function resolveFile(root:FileSystemDirectoryHandle,path:string,create:boolean):Promise<{dir:FileSystemDirectoryHandle;name:string}>{
  const parts=fileName(path)
  let dir=root
  for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part,{create})
  return {dir,name:parts[3]!}
}
export async function writeCiphertext(backend:StorageBackend,path:string,blob:Blob,scope:Scope):Promise<void>{
  if(backend==='idb-blob'){
    await db.blobFallback.put({key:path,accountId:scope.accountId,blob})
    return
  }
  const root=await navigator.storage.getDirectory()
  const directory=await root.getDirectoryHandle('pb-cipher-v1',{create:true})
  const {dir,name}=await resolveFile(directory,path,true)
  const file=await dir.getFileHandle(name,{create:true})
  const writable=await file.createWritable()
  try{await writable.write(blob);await writable.close()}
  catch(error){try{await writable.abort()}catch{/* best effort */}throw error}
}
export async function readCiphertext(backend:StorageBackend,path:string):Promise<Blob>{
  if(backend==='idb-blob'){
    const row=await db.blobFallback.get(path)
    if(!row)throw new Error('storage.blob_missing')
    return row.blob
  }
  const root=await navigator.storage.getDirectory()
  const directory=await root.getDirectoryHandle('pb-cipher-v1')
  const {dir,name}=await resolveFile(directory,path,false)
  const handle=await dir.getFileHandle(name)
  return handle.getFile()
}
export async function deleteCiphertext(backend:StorageBackend,path:string):Promise<void>{
  if(backend==='idb-blob'){await db.blobFallback.delete(path);return}
  try{
    const root=await navigator.storage.getDirectory()
    const directory=await root.getDirectoryHandle('pb-cipher-v1')
    const {dir,name}=await resolveFile(directory,path,false)
    await dir.removeEntry(name)
  }catch(e){
    if(e instanceof DOMException && e.name==='NotFoundError')return
    throw e
  }
}
export async function probeOpfs():Promise<boolean>{
  if(!navigator.storage?.getDirectory)return false
  const name='pb-probe-'+crypto.randomUUID()
  let directory:FileSystemDirectoryHandle|null=null
  try{
    const root=await navigator.storage.getDirectory()
    directory=await root.getDirectoryHandle('pb-capabilities',{create:true})
    const handle=await directory.getFileHandle(name,{create:true})
    const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt'])
    const iv=crypto.getRandomValues(new Uint8Array(12))
    const probe=crypto.getRandomValues(new Uint8Array(32))
    const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,probe)
    const w=await handle.createWritable()
    try{await w.write(new Blob([cipher]));await w.close()}
    catch(e){try{await w.abort()}catch{/* ignore */}throw e}
    const raw=await (await handle.getFile()).arrayBuffer()
    if(raw.byteLength!==cipher.byteLength)throw new Error('storage.opfs_probe')
    const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,raw)
    if(new Uint8Array(clear).some((v,i)=>v!==probe[i]))throw new Error('storage.opfs_probe')
    return true
  }catch{return false}
  finally{if(directory)await directory.removeEntry(name).catch(()=>{})}
}
export async function probeEncryptedFallback():Promise<boolean>{
  const key='probe-'+crypto.randomUUID()
  try{
    const secret=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt'])
    const iv=crypto.getRandomValues(new Uint8Array(12))
    const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},secret,crypto.getRandomValues(new Uint8Array(64)))
    await db.blobFallback.put({key,accountId:'probe',blob:new Blob([cipher])})
    const row=await db.blobFallback.get(key)
    if(!row || row.blob.size!==cipher.byteLength)return false
    const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv},secret,await row.blob.arrayBuffer())
    return decrypted.byteLength===64
  }catch{return false}
  finally{await db.blobFallback.delete(key).catch(()=>{})}
}

/** Scoped, read-only crash journal and outbox counts for device safety. */
export async function inspectPhotoStoreCounts(account:string){
  const [photoJournals,photoCipherAssets,rows]=await Promise.all([
    db.journal.where('accountId').equals(account).count(),
    db.assets.where('accountId').equals(account).count(),
    db.outbox.where('accountId').equals(account).toArray(),
  ])
  return{photoJournals,photoCipherAssets,
    photoOutbox:rows.filter(row=>!['acknowledged','cancelled'].includes(row.state)).length}
}
