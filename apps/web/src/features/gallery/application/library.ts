import {identity,photoRequest} from '../../identity'
import {openLocalPhotoVault} from '../../local-storage'
import type {CloudAsset,CloudPhoto,PhotoHeader,SyncState} from '../../local-storage'
import {checkMetadata} from '../domain/metadata'
export type GalleryItem={header:PhotoHeader;title:string;capturedAt:number;nameId:string|null;state:SyncState;remote:boolean}
export type CloudEntry=CloudPhoto
function guard(account:string,device:string):void{
  if(identity.value?.accountId!==account||identity.value?.deviceId!==device)
    throw Error('gallery.identity_changed')
}
async function received<T>(path:string):Promise<T>{
  const r=await photoRequest(path)
  if(!r.ok)throw Error('gallery.http_'+r.status)
  return await r.json() as T
}
export async function remoteHeaders():Promise<CloudPhoto[]>{
  if(!identity.value||identity.value.offline||!navigator.onLine)return []
  const {accountId,deviceId}=identity.value
  const items:CloudPhoto[]=[],seen=new Set<string>()
  let cursor:string|null=null
  for(let page=0;page<200;page++){
    guard(accountId,deviceId)
    const path:string=cursor?'/list?after='+cursor+'&limit=50':'/list'
    const answer:{photos:CloudPhoto[];nextCursor:string|null}=
      await received<{photos:CloudPhoto[];nextCursor:string|null}>(path)
    guard(accountId,deviceId)
    if(!Array.isArray(answer.photos))throw Error('gallery.bad_server_list')
    for(const item of answer.photos){
      if(seen.has(item.photoId))continue
      seen.add(item.photoId);items.push(item)
    }
    if(!answer.nextCursor)break
    if(answer.nextCursor===cursor)throw Error('gallery.invalid_cursor')
    cursor=answer.nextCursor
  }
  if(cursor)throw Error('gallery.pagination_limit')
  return items
}
export async function manifests(photoId:string):Promise<CloudAsset[]>{
  const result=await received<{photoId:string;assets:CloudAsset[]}>( '/'+photoId+'/manifests')
  if(result.photoId!==photoId||!Array.isArray(result.assets))throw Error('gallery.invalid_remote_manifest')
  return result.assets
}
export async function cloudCiphertext(photoId:string,asset:CloudAsset):Promise<Blob>{
  const response=await photoRequest('/'+photoId+'/objects/'+asset.assetId)
  if(!response.ok)throw Error('gallery.cloud_read_'+response.status)
  const blob=await response.blob()
  if(blob.size!==asset.bytes)throw Error('gallery.cloud_length')
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())))
    .map(x=>x.toString(16).padStart(2,'0')).join('')
  if(hash!==asset.sha256)throw Error('gallery.cloud_digest')
  return blob
}
/** Decrypt the current metadata only in memory for the cloud gallery list. */
export async function remoteMetadata(photo:CloudPhoto):Promise<ReturnType<typeof checkMetadata>>{
  const assets=await manifests(photo.photoId)
  const asset=assets.find(item=>item.kind==='metadata'&&item.assetId===photo.metadataAssetId)
  if(!asset)throw Error('gallery.cloud_metadata_missing')
  const ciphertext=await cloudCiphertext(photo.photoId,asset)
  const clear=await openLocalPhotoVault().decryptRemote(photo.photoId,
    asset as CloudAsset&{kind:'metadata'},ciphertext)
  const decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await clear.arrayBuffer())) as {
    version?:unknown;capturedAt?:unknown;data?:unknown
  }
  if(decoded.version!==1||!Number.isSafeInteger(decoded.capturedAt))
    throw Error('gallery.cloud_metadata_invalid')
  const metadata=checkMetadata(decoded.data)
  if(metadata.capturedAt!==decoded.capturedAt||metadata.expiresAt!==photo.expiresAt)
    throw Error('gallery.cloud_metadata_mismatch')
  return metadata
}
export async function hydratePhoto(photo:CloudPhoto):Promise<boolean>{
  const current=identity.value
  if(!current)throw Error('gallery.locked')
  const vault=openLocalPhotoVault()
  if(await vault.readHeader(photo.photoId))return false
  const assets=await manifests(photo.photoId)
  guard(current.accountId,current.deviceId)
  const currentObjects=assets.filter(x=>x.kind==='master'||x.kind==='original'
    ||x.kind==='thumbnail'||(x.kind==='metadata'&&x.assetId===photo.metadataAssetId))
  if(!currentObjects.some(x=>x.kind==='metadata')||!currentObjects.some(x=>x.kind==='master'||x.kind==='original'))
    throw Error('gallery.cloud_incomplete')
  const fetched=[]
  for(const asset of currentObjects){
    guard(current.accountId,current.deviceId)
    fetched.push({asset,blob:await cloudCiphertext(photo.photoId,asset)})
  }
  guard(current.accountId,current.deviceId)
  return vault.importCloud(photo,fetched)
}
export async function thumbnail(photoId:string):Promise<Blob|null>{
  if(!identity.value)return null
  const vault=openLocalPhotoVault()
  const header=await vault.readHeader(photoId)
  if(header?.thumbnailAssetId){
    try{
      const bytes=await vault.read(photoId,header.thumbnailAssetId)
      await vault.cacheThumbnail(photoId).catch(()=>{})
      return new Blob([bytes],{type:'image/webp'})
    }catch{/* missing local ciphertext: remote read only if authenticated */ }
  }
  if(identity.value.offline||!navigator.onLine)return null
  const assets=await manifests(photoId)
  const item=assets.find(x=>x.kind==='thumbnail')
  if(!item)return null
  const ciphertext=await cloudCiphertext(photoId,item)
  const plain=await vault.decryptRemote(photoId,item as CloudAsset&{kind:'thumbnail'},ciphertext)
  return new Blob([plain],{type:'image/webp'})
}
export async function localGallery():Promise<GalleryItem[]>{
  const vault=openLocalPhotoVault()
  if(!vault.time.status().trusted)await vault.time.restoreFromStorage()
  if(!vault.time.status().trusted&&!identity.value?.offline)await vault.time.refreshFromServer()
  await vault.reconcile()
  const rows=await vault.list(),items:GalleryItem[]=[]
  for(const header of rows){
    try{
      const m=checkMetadata(await vault.readMetadata(header.photoId))
      if(m.expiresAt!==header.expiresAt)continue
      items.push({header,title:m.title??'',capturedAt:m.capturedAt,nameId:header.nameId??null,
        state:await vault.syncState(header.photoId),remote:false})
    }catch{/* corrupted item remains inaccessible; no plaintext fallback */}
  }
  items.sort((a,b)=>b.capturedAt-a.capturedAt||a.header.photoId.localeCompare(b.header.photoId))
  return items
}
