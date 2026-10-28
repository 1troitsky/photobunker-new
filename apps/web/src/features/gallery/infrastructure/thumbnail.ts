/** One optional image rendition, generated from capture JPEG in memory, no EXIF. */
export async function thumbnailWebp(source:Blob):Promise<Blob|null>{
  if(typeof document==='undefined'||typeof Image==='undefined')return null
  const sourceUrl=URL.createObjectURL(source),image=new Image()
  const canvas=document.createElement('canvas')
  try{
    image.src=sourceUrl;await image.decode()
    const w=image.naturalWidth,h=image.naturalHeight
    if(w<=0||h<=0)throw Error('gallery.image_invalid')
    const scale=Math.min(1,320/Math.max(w,h))
    canvas.width=Math.max(1,Math.floor(w*scale))
    canvas.height=Math.max(1,Math.floor(h*scale))
    const ctx=canvas.getContext('2d')
    if(!ctx)return null
    ctx.drawImage(image,0,0,canvas.width,canvas.height)
    const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/webp',0.82))
    if(!blob||blob.type!=='image/webp'||blob.size===0)return null
    return blob
  }catch{return null}
  finally{image.src='';URL.revokeObjectURL(sourceUrl);canvas.width=0;canvas.height=0}
}
