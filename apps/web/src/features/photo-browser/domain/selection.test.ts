import {describe,expect,it} from 'vitest'
import {selectedVisiblePhotos,togglePhotoSelection} from './selection'
import type {BrowserPhoto} from './model'
const photo=(id:string):BrowserPhoto=>({
  id,assignmentId:null,title:id,nameId:null,capturedAt:1,expiresAt:100,
  sync:'local',
})
describe('bounded owner Browser selection',()=>{
  const visible=Array.from({length:12},(_,index)=>photo(String(index)))
  it('selects and deselects only currently visible entries',()=>{
    const one=togglePhotoSelection(new Set<string>(), '0', visible)
    expect([...one]).toEqual(['0'])
    expect([...togglePhotoSelection(one,'0',visible)]).toEqual([])
    expect([...togglePhotoSelection(one,'hidden',[photo('1')])]).toEqual(['0'])
  })
  it('never selects more than 10 files',()=>{
    let selection=new Set<string>()
    for(const item of visible)selection=togglePhotoSelection(selection,item.id,visible)
    expect(selection.size).toBe(10)
    expect([...selection].includes('10')).toBe(false)
  })
  it('derives export rows from current visible rows rather than stale selection',()=>{
    const selected=new Set(['1','2','stale'])
    expect(selectedVisiblePhotos([photo('1')],selected).map(item=>item.id)).toEqual(['1'])
  })
})
