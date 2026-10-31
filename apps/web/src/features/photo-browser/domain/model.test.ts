import {describe,expect,it} from 'vitest'
import {browserFolders,browserTreeGroups,visibleBrowserPhotos,type BrowserPhoto} from './model'
const photo=(id:string,assignmentId:string|null,expiresAt=2000,capturedAt=1000):BrowserPhoto=>({
  id,assignmentId,expiresAt,capturedAt,title:id,nameId:null,sync:'local',
})
describe('private local Photo Browser',()=>{
  const rows=[photo('personal',null),photo('assigned','aaa',2000,900),
    photo('orphan','deleted'),photo('expired',null,999)]
  it('groups by real capture binding, never by a display title or implicit Team membership',()=>{
    const folders=browserFolders([{id:'aaa',title:'Assignment'}],rows)
    expect(folders.map(f=>[f.id,f.count,f.kind])).toEqual([
      ['all',4,'all'],['personal',2,'personal'],
      ['assignment:aaa',1,'assignment'],['assignment:deleted',1,'missing'],
    ])
  })
  it('filters expired photos, searches per selected folder and orders deterministically',()=>{
    expect(visibleBrowserPhotos(rows,'all','', 'newest',1000).map(p=>p.id))
      .toEqual(['orphan','personal','assigned'])
    expect(visibleBrowserPhotos(rows,'assignment:aaa','assign','oldest',1000).map(p=>p.id))
      .toEqual(['assigned'])
    expect(visibleBrowserPhotos(rows,'personal','', 'newest',1000).map(p=>p.id))
      .toEqual(['personal'])
  })
  it('never includes a folder that has not been selected and respects the exact expiry boundary',()=>{
    expect(visibleBrowserPhotos(rows,'assignment:deleted','', 'newest',2000)).toEqual([])
    expect(visibleBrowserPhotos(rows,'unknown','', 'newest',1000)).toEqual([])
  })
})

describe('Finder tree owner projection',()=>{
  const rows=[photo('private',null),photo('A','a'),photo('B','b'),photo('orphan','deleted')]
  const assignments=[{id:'a',title:'A'},{id:'b',title:'B'}]
  it('groups distinct assignment bindings and personal items without duplicates',()=>{
    const groups=browserTreeGroups(browserFolders(assignments,rows),rows)
    expect(groups.map(g=>[g.folder.id,g.photos.map(p=>p.id)])).toEqual([
      ['personal',['private']],['assignment:a',['A']],['assignment:b',['B']],
      ['assignment:deleted',['orphan']],
    ])
  })
  it('does not grant access or invent a folder for unknown rows',()=>{
    const subset=visibleBrowserPhotos(rows,'assignment:a','', 'newest',1000)
    expect(browserTreeGroups(browserFolders(assignments,subset),subset)
      .flatMap(g=>g.photos.map(p=>p.id))).toEqual(['A'])
    expect(browserTreeGroups(browserFolders(assignments,[]),[])).toEqual([])
  })
})
