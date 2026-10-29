import {identity} from '../../identity'
import {openLocalPhotoVault} from '../../local-storage'
import {flushPhotoSync} from '../../photo-sync'
import type {EditDocument} from '../domain/document'
import {flattenJpeg} from '../infrastructure/render'
export {EditSession,emptyEdit,normalizedPoint,updateText} from '../domain/document'
export type {EditDocument,Point,Tool} from '../domain/document'
export {renderEdits} from '../infrastructure/render'
export type EditorSource={photoId:string;photo:Blob;mode:2|3;
  revision:number;expiresAt:number;accountId:string;deviceId:string}
export async function openEditor(photoId:string):Promise<EditorSource>{
  const user=identity.value
  if(!user)throw Error('editor.account_locked')
  const vault=openLocalPhotoVault()
  const header=await vault.readHeader(photoId)
  if(!header)throw Error('editor.photo_unavailable')
  const meta=await vault.readMetadata(photoId) as {mode?:number;policy?:{mode?:number}}
  if(![2,3].includes(meta.mode??0)||meta.mode!==meta.policy?.mode||
    (header.capture&&header.capture.mode!==meta.mode))throw Error('editor.policy_invalid')
  const bytes=await vault.read(photoId,header.assetId)
  if(identity.value?.accountId!==user.accountId||identity.value.deviceId!==user.deviceId)
    throw Error('editor.account_switched')
  return{photoId,photo:new Blob([bytes],{type:'image/jpeg'}),mode:meta.mode as 2|3,
    revision:header.editRevision??0,expiresAt:header.expiresAt,
    accountId:user.accountId,deviceId:user.deviceId}
}
export async function saveEditor(source:EditorSource,image:CanvasImageSource,
  width:number,height:number,document:EditDocument):Promise<{assetId:string;revision:number}>{
  const active=identity.value
  if(!active||active.accountId!==source.accountId||active.deviceId!==source.deviceId)
    throw Error('editor.account_switched')
  // Flatten in volatile memory; no unencrypted file/IDB/temp/scratch persistence.
  const jpeg=await flattenJpeg(image,width,height,document)
  if(identity.value?.accountId!==source.accountId||identity.value.deviceId!==source.deviceId)
    throw Error('editor.account_switched')
  const vault=openLocalPhotoVault()
  const header=await vault.readHeader(source.photoId)
  if(!header||header.expiresAt!==source.expiresAt||(header.editRevision??0)!==source.revision)
    throw Error('editor.photo_changed')
  const pending=await vault.saveEdit(source.photoId,jpeg)
  if(!identity.value?.offline&&navigator.onLine)void flushPhotoSync()
  return{assetId:pending.assetId,revision:pending.revision}
}
