import {COMPRESSION_V1,geometry} from '../domain/policy'

/** Strip APP1–APP15 and COM from the *re-encoded* JPEG, not merely source metadata.
 * Preserve JFIF APP0 needed for broad decoder compatibility. Reject malformed headers.
 */
export async function stripJpegMetadata(source:Blob):Promise<Blob>{
  if(source.size<4||source.size>128*1024*1024)throw new Error('camera.jpeg_invalid')
  const header=new Uint8Array(await source.slice(0,Math.min(source.size,2*1024*1024)).arrayBuffer())
  if(header[0]!==0xff||header[1]!==0xd8)throw new Error('camera.jpeg_invalid')
  const chunks:BlobPart[]=[source.slice(0,2)]
  let offset=2
  for(let i=0;i<16384;i++){
    if(offset+2>header.length||header[offset]!==0xff)throw new Error('camera.jpeg_invalid')
    const begin=offset
    while(header[offset]===0xff)offset++
    const marker=header[offset++]
    if(marker===undefined || marker===0x00 || marker===0xd8)throw new Error('camera.jpeg_invalid')
    if(marker===0xda){ // scan data is not parsed or modified
      if(source.size<offset+4)throw new Error('camera.jpeg_invalid')
      chunks.push(source.slice(begin))
      return new Blob(chunks,{type:'image/jpeg'})
    }
    if(marker===0xd9){chunks.push(source.slice(begin));return new Blob(chunks,{type:'image/jpeg'})}
    if(offset+2>header.length)throw new Error('camera.jpeg_invalid')
    const size=header[offset]! *256+header[offset+1]!
    if(size<2||offset+size>header.length)throw new Error('camera.jpeg_invalid')
    const end=offset+size
    if(!(marker>=0xe1&&marker<=0xef) && marker!==0xfe)chunks.push(source.slice(begin,end))
    offset=end
  }
  throw new Error('camera.jpeg_header_limit')
}
function jpegCanvas(canvas:HTMLCanvasElement):Promise<Blob>{
  return new Promise((resolve,reject)=>{
    try{canvas.toBlob(blob=>blob&&blob.type==='image/jpeg'&&blob.size>0
      ?resolve(blob):reject(new Error('camera.jpeg_encode_failed')),COMPRESSION_V1.mime,COMPRESSION_V1.quality)}
    catch(e){reject(e)}
  })
}
export type Compressed=Readonly<{blob:Blob;sourceWidth:number;sourceHeight:number;outputWidth:number;outputHeight:number}>
type DecodedImage=Readonly<{source:CanvasImageSource;width:number;height:number;close:()=>void}>
async function decodeImage(source:Blob):Promise<DecodedImage>{
  if(typeof createImageBitmap==='function'){
    try{
      const bitmap=await createImageBitmap(source)
      return{source:bitmap,width:bitmap.width,height:bitmap.height,close:()=>bitmap.close()}
    }catch{/* Safari and some camera codecs need the HTML image decoder fallback. */}
  }
  if(typeof Image==='undefined'||typeof URL.createObjectURL!=='function')throw new Error('camera.decode_failed')
  const objectUrl=URL.createObjectURL(source),image=new Image()
  try{
    await new Promise<void>((resolve,reject)=>{
      image.onload=()=>resolve()
      image.onerror=()=>reject(new Error('camera.decode_failed'))
      image.src=objectUrl
    })
    if(image.naturalWidth<1||image.naturalHeight<1)throw new Error('camera.decode_failed')
    return{source:image,width:image.naturalWidth,height:image.naturalHeight,
      close:()=>URL.revokeObjectURL(objectUrl)}
  }catch(error){URL.revokeObjectURL(objectUrl);throw error}
}
export async function compressCapture(source:Blob,check:()=>void):Promise<Compressed>{
  check()
  if(source.size<1||source.size>128*1024*1024)throw new Error('camera.source_too_large')
  const decoded=await decodeImage(source)
  const canvas=document.createElement('canvas')
  try{
    check()
    const {width,height}=geometry(decoded.width,decoded.height)
    canvas.width=width;canvas.height=height
    const context=canvas.getContext('2d',{alpha:false})
    if(!context)throw new Error('camera.canvas_unavailable')
    context.fillStyle='#fff';context.fillRect(0,0,width,height)
    context.drawImage(decoded.source,0,0,width,height)
    check()
    const encoded=await jpegCanvas(canvas)
    check()
    const blob=await stripJpegMetadata(encoded)
    check()
    return{blob,sourceWidth:decoded.width,sourceHeight:decoded.height,outputWidth:width,outputHeight:height}
  }finally{decoded.close();canvas.width=0;canvas.height=0}
}
