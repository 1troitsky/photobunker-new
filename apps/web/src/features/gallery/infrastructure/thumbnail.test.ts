// @vitest-environment jsdom
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {thumbnailWebp} from './thumbnail'
describe('R2-07 optional single WebP with no-upscale and URL cleanup',()=>{
 beforeEach(()=>{vi.restoreAllMocks()})
 it('safely skips unsupported browser encoder without fabricating JPEG preview',async()=>{
   Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()})
   Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=> 'blob:private')})
   const revoke=vi.mocked(URL.revokeObjectURL)
   const create=vi.mocked(URL.createObjectURL)
   const blob=await thumbnailWebp(new Blob(['synthetic'],{type:'image/jpeg'}))
   expect(blob).toBeNull()
   expect(create).toHaveBeenCalledTimes(1)
   expect(revoke).toHaveBeenCalledWith('blob:private')
 })
})
