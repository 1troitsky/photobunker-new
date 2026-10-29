import {describe,expect,it} from 'vitest'
import {assertJpegWithoutMetadata} from './jpeg'
const jpeg=(...a:number[])=>new Blob([new Uint8Array(a)],{type:'image/jpeg'})
describe('R2-11 JPEG privacy envelope',()=>{
 it('accepts a flattened header whose scan begins without EXIF',async()=>{
  await expect(assertJpegWithoutMetadata(jpeg(
   0xff,0xd8,0xff,0xe0,0x00,0x02,0xff,0xda,0x00,0x02,0x11,0x22,0xff,0xd9,
  ))).resolves.toBeUndefined()
 })
 it('rejects APP1 EXIF, APP13 and COM comments even after JFIF',async()=>{
  for(const marker of [0xe1,0xed,0xfe]){
   await expect(assertJpegWithoutMetadata(jpeg(
    0xff,0xd8,0xff,0xe0,0,2,0xff,marker,0,2,0xff,0xda,0,2,0xff,0xd9,
   ))).rejects.toThrow('editor.metadata_in_jpeg')
  }
 })
 it('rejects truncated, oversized or fake JPEG without image scan',async()=>{
  await expect(assertJpegWithoutMetadata(jpeg(0xff,0xd8,0xff,0xd9,0,0,0,0)))
   .rejects.toThrow('editor.jpeg_no_pixels')
  await expect(assertJpegWithoutMetadata(jpeg(0xff,0xd8,0xff,0xe0,0xff,0xff,0,0)))
   .rejects.toThrow('editor.jpeg_invalid_segment')
 })
})
