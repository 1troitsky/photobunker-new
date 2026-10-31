import {describe,expect,it} from 'vitest'
import {validateThumbnailPage} from './recipient-list'
const id=()=>crypto.randomUUID()
const photo=(p:string,a:string)=>({photoId:p,assetId:a,expiresAt:Date.now()+3600000})
describe('PB2 recipient encrypted-thumbnail list validation',()=>{
  it('accepts empty or bounded pages without disclosing user data',()=>{
    expect(validateThumbnailPage({photos:[],nextCursor:null},null,Date.now()))
      .toEqual({photos:[],nextCursor:null})
    const p=id(),q=id(),sorted=[p,q].sort()
    const page={photos:[photo(sorted[0],id())],nextCursor:'A'.repeat(80)}
    expect(validateThumbnailPage(page,null,Date.now()).photos).toHaveLength(1)
  })
  it('rejects stale pages, duplications, tampering and non-progressing cursors',()=>{
    const a=id(),b=id()
    expect(()=>validateThumbnailPage({photos:[photo(a,b),photo(a,id())],nextCursor:null},null,Date.now())).toThrow()
    expect(()=>validateThumbnailPage({photos:[photo(a,b)],nextCursor:a},null,Date.now())).toThrow()
    expect(()=>validateThumbnailPage({photos:[photo(a,b)],nextCursor:'A'.repeat(80)},'A'.repeat(80),Date.now())).toThrow()
    expect(()=>validateThumbnailPage({photos:[{...photo(a,b),expiresAt:0}],nextCursor:null},null,Date.now())).toThrow()
    expect(()=>validateThumbnailPage({photos:[{photoId:'../../secret',assetId:b,expiresAt:Date.now()+10000}],nextCursor:null},null,Date.now())).toThrow()
  })
})
