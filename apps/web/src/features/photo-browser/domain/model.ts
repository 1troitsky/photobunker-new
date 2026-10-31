import type {SyncState} from '../../local-storage'

/** The first native PB2 Browser is a private device-local index, NOT a shared collection ACL. */
export type BrowserPhoto=Readonly<{
  id:string;assignmentId:string|null;title:string;nameId:string|null;
  capturedAt:number;expiresAt:number;sync:SyncState
}>
export type BrowserAssignment=Readonly<{id:string;title:string}>
export type BrowserFolder=Readonly<{
  id:string;kind:'all'|'personal'|'assignment'|'missing';title:string|null;count:number
}>
export type BrowserSort='newest'|'oldest'|'name'
export type BrowserDisplay='grid'|'list'

export function browserFolders(assignments:readonly BrowserAssignment[],
  photos:readonly BrowserPhoto[]):BrowserFolder[]{
  const counts=new Map<string,number>()
  const folderId=(p:BrowserPhoto)=>p.assignmentId?'assignment:'+p.assignmentId:'personal'
  for(const photo of photos){
    const key=folderId(photo)
    counts.set(key,(counts.get(key)??0)+1)
  }
  const existing=new Set(assignments.map(a=>a.id))
  const missing=[...counts.keys()].filter(id=>id.startsWith('assignment:')&&!existing.has(id.slice(11)))
    .sort().map(id=>({id,kind:'missing' as const,title:null,count:counts.get(id)??0}))
  return [
    {id:'all',kind:'all',title:null,count:photos.length},
    {id:'personal',kind:'personal',title:null,count:counts.get('personal')??0},
    ...assignments.map(a=>({id:'assignment:'+a.id,kind:'assignment' as const,
      title:a.title,count:counts.get('assignment:'+a.id)??0})),
    ...missing,
  ]
}

/** Cosmetic filter only: real expiry and authorization are enforced by the vault/API. */
export function visibleBrowserPhotos(photos:readonly BrowserPhoto[],
  folder:string,query:string,sort:BrowserSort,now:number):BrowserPhoto[]{
  const needle=query.trim().toLocaleLowerCase()
  return photos.filter(p=>
    p.expiresAt>now&&
    (folder==='all'||(folder==='personal'&&!p.assignmentId)||
      (p.assignmentId!==null&&folder==='assignment:'+p.assignmentId))&&
    (!needle||p.title.toLocaleLowerCase().includes(needle)||
      (p.nameId??'').toLocaleLowerCase().includes(needle))
  ).sort((a,b)=>{
    if(sort==='name')return (a.title||a.nameId||'').localeCompare(b.title||b.nameId||'')||
      a.id.localeCompare(b.id)
    return (sort==='oldest'?a.capturedAt-b.capturedAt:b.capturedAt-a.capturedAt)||
      a.id.localeCompare(b.id)
  })
}
