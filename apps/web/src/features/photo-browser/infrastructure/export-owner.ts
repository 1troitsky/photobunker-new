import {identity,registerDecryptedObjectUrl,revokeDecryptedObjectUrl} from '../../identity'
import {openLocalPhotoVault} from '../../local-storage'
import type {BrowserPhoto} from '../domain/model'
import {ZipWriter,safePart,distinctPath} from './zip'

const MAX_FILES=10,MAX_DOWNLOAD=16*1024*1024,MAX_SOURCE=32*1024*1024
const NAME_ID=/^[A-Z]{4}[0-9]{4}$/
type Account=Readonly<{accountId:string;deviceId:string}>
function guard(active:Account,signal:AbortSignal):void{
  if(signal.aborted||document.hidden||
     identity.value?.accountId!==active.accountId||
     identity.value?.deviceId!==active.deviceId)
    throw new DOMException('Private export aborted','AbortError')
}
async function stripJpeg(source:Blob,active:Account,signal:AbortSignal):Promise<Blob>{
  guard(active,signal)
  if(source.size<1||source.size>MAX_SOURCE)throw Error('browser.export_image_limit')
  const object=URL.createObjectURL(source),image=new Image()
  const canvas=document.createElement('canvas')
  try{
    image.src=object;await image.decode();guard(active,signal)
    if(!image.naturalWidth||!image.naturalHeight||
      image.naturalWidth*image.naturalHeight>8_000_000)
      throw Error('browser.export_image_limit')
    canvas.width=image.naturalWidth;canvas.height=image.naturalHeight
    const g=canvas.getContext('2d')
    if(!g)throw Error('browser.export_canvas_unavailable')
    g.fillStyle='#fff';g.fillRect(0,0,canvas.width,canvas.height)
    g.drawImage(image,0,0)
    const result=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>{
      if(!blob||blob.type!=='image/jpeg')reject(Error('browser.export_encode_failed'))
      else resolve(blob)
    },'image/jpeg',.9))
    guard(active,signal)
    if(result.size<1||result.size>MAX_SOURCE)throw Error('browser.export_image_limit')
    return result
  }finally{
    URL.revokeObjectURL(object);image.removeAttribute('src')
    canvas.width=0;canvas.height=0
  }
}
/** Explicit owner export only: current locally encrypted rendition, NOT the
 * immutable original, grant thumbnails, hidden metadata or EXIF. No legacy API.
 * The only plaintext persistence is the user-requested ZIP in Downloads.
 */
export async function exportOwnerBrowserZip(
  selected:readonly BrowserPhoto[],signal:AbortSignal,
  progress:(done:number,total:number)=>void=()=>{},
):Promise<void>{
  const active=identity.value
  if(!active)throw Error('browser.account_locked')
  if(!selected.length||selected.length>MAX_FILES||
    new Set(selected.map(p=>p.id)).size!==selected.length)
    throw Error('browser.export_limit')
  guard(active,signal)
  const vault=openLocalPhotoVault(),chunks:Uint8Array<ArrayBuffer>[]=[]
  let total=0
  const zip=new ZipWriter(async bytes=>{
    guard(active,signal)
    if(total+bytes.byteLength>MAX_DOWNLOAD)throw Error('browser.export_limit')
    total+=bytes.byteLength;chunks.push(bytes)
  },signal)
  const paths=new Set<string>()
  for(let i=0;i<selected.length;i++){
    guard(active,signal)
    const item=selected[i]!
    const header=await vault.readHeader(item.id)
    guard(active,signal)
    if(!header||header.accountId!==active.accountId||
      header.photoId!==item.id||header.expiresAt<=vault.time.now()||
      header.expiresAt!==item.expiresAt)
      throw Error('browser.export_denied')
    // Owner vault ACL ensures selected version is the current active rendition.
    const jpeg=await vault.read(item.id,header.assetId)
    guard(active,signal)
    const safe=await stripJpeg(jpeg,active,signal)
    guard(active,signal)
    const latest=await vault.readHeader(item.id)
    guard(active,signal)
    if(!latest||latest.assetId!==header.assetId||
      latest.revision!==header.revision||latest.expiresAt<=vault.time.now())
      throw Error('browser.export_changed')
    const base=NAME_ID.test(item.nameId??'')?item.nameId!:item.title
    const name=distinctPath(safePart(base,item.id)+'.jpg',paths)
    await zip.add(name,safe)
    guard(active,signal)
    progress(i+1,selected.length)
  }
  await zip.finish();guard(active,signal)
  const blob=new Blob(chunks,{type:'application/zip'})
  if(blob.size!==total)throw Error('browser.export_length')
  const url=URL.createObjectURL(blob)
  registerDecryptedObjectUrl(url)
  try{
    guard(active,signal)
    const anchor=document.createElement('a')
    anchor.href=url;anchor.download='PhotoBunker-photos.zip'
    anchor.style.display='none';document.body.append(anchor)
    try{anchor.click()}finally{anchor.remove()}
  }finally{
    // No persistent plaintext object URL after the user-initiated download.
    window.setTimeout(()=>revokeDecryptedObjectUrl(url),10000)
  }
}
