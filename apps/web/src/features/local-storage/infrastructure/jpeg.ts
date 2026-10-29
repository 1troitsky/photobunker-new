/** Reject file-level EXIF/XMP/comments even if a caller bypasses the Canvas UI.
 *  All saved image bytes still originate from in-memory Canvas recompression. */
export async function assertJpegWithoutMetadata(blob:Blob):Promise<void>{
 if(blob.type!=='image/jpeg'||blob.size<8||blob.size>64*1024*1024)
  throw Error('editor.invalid_jpeg')
 const read=async(offset:number,n:number)=>{
  if(offset+n>blob.size)throw Error('editor.jpeg_truncated')
  return new Uint8Array(await blob.slice(offset,offset+n).arrayBuffer())
 }
 const soi=await read(0,2)
 if(soi[0]!==0xff||soi[1]!==0xd8)throw Error('editor.not_jpeg')
 let offset=2
 for(let part=0;part<256;part++){
  const head=await read(offset,4)
  if(head[0]!==0xff)throw Error('editor.jpeg_invalid_marker')
  const marker=head[1]!
  if(marker===0xda)return // scan data follows: metadata markers are no longer headers
  if(marker===0xd9)throw Error('editor.jpeg_no_pixels')
  if(marker===0xfe||(marker>=0xe1&&marker<=0xef))
    throw Error('editor.metadata_in_jpeg')
  if(marker===0xd8||(marker>=0xd0&&marker<=0xd7))
    throw Error('editor.jpeg_invalid_marker')
  const length=head[2]!*256+head[3]!
  if(length<2||offset+2+length>blob.size)throw Error('editor.jpeg_invalid_segment')
  offset+=2+length
 }
 throw Error('editor.jpeg_header_limit')
}
