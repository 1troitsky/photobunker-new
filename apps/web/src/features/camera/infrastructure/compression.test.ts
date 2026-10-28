import {describe,expect,it} from 'vitest'
import {stripJpegMetadata} from './compression'
describe('R2-06 JPEG segment stripping',()=>{
  it('strips EXIF APP1, XMP APP1 and COM, keeps JFIF and scan bytes',async()=>{
    const raw=Uint8Array.from([
      0xff,0xd8,
      0xff,0xe1,0x00,0x06,69,120,105,102,
      0xff,0xfe,0x00,0x04,65,66,
      0xff,0xe0,0x00,0x04,12,34,
      0xff,0xda,0x00,0x08,1,1,0,0,63,0,42,43,0xff,0xd9
    ])
    const stripped=new Uint8Array(await (await stripJpegMetadata(new Blob([raw],{type:'image/jpeg'}))).arrayBuffer())
    expect([...stripped]).toEqual([
      0xff,0xd8,
      0xff,0xe0,0x00,0x04,12,34,
      0xff,0xda,0x00,0x08,1,1,0,0,63,0,42,43,0xff,0xd9
    ])
  })
  it('rejects malformed JPEG length, missing header and unsupported markers',async()=>{
    await expect(stripJpegMetadata(new Blob(['plaintext']))).rejects.toThrow()
    await expect(stripJpegMetadata(new Blob([Uint8Array.of(255,216,255,225,255,255,0)]))).rejects.toThrow()
    await expect(stripJpegMetadata(new Blob([Uint8Array.of(255,216,255,216,1,2,3,4)]))).rejects.toThrow()
  })
})
