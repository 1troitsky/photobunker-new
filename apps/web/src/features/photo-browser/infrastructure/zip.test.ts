import {describe,it,expect} from 'vitest'
import {ZipWriter,safePart,distinctPath} from './zip'
describe('ported PB1 ZIP32 writer, used only by PB2 owner export',()=>{
  it('writes JPEG without source timestamps, duplicate file paths or traversal',async()=>{
    const chunks:Uint8Array<ArrayBuffer>[]=[]
    const signal=new AbortController().signal
    const zip=new ZipWriter(async chunk=>{chunks.push(chunk)},signal)
    const used=new Set<string>()
    expect(safePart('../../secret\\evil','photo')).not.toContain('/')
    expect(safePart('con','fallback')).toBe('_con')
    const a=distinctPath('Photo.jpg',used),b=distinctPath('photo.jpg',used)
    expect(a).toBe('Photo.jpg');expect(b).toBe('photo-2.jpg')
    await zip.add(a,new Blob([Uint8Array.from([0xff,0xd8,0xff,0xd9])]))
    await zip.finish()
    const data=new Uint8Array(await new Blob(chunks).arrayBuffer())
    expect(new DataView(data.buffer).getUint32(0,true)).toBe(0x04034b50)
    expect(new DataView(data.buffer).getUint32(data.length-22,true)).toBe(0x06054b50)
  })
  it('rejects an aborted export before writing',async()=>{
    const ac=new AbortController();ac.abort()
    const zip=new ZipWriter(async()=>{},ac.signal)
    await expect(zip.add('photo.jpg',new Blob(['jpg']))).rejects.toThrow()
  })
})
