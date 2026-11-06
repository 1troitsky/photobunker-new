// @vitest-environment jsdom
import { beforeAll, expect, it, vi } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
const owner='synthetic-owner', authority='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const rows=vi.hoisted(()=>new Map<string,unknown>())
vi.mock('../src/identity/store',()=>({account:{value:{id:'synthetic-owner'}}}))
vi.mock('../src/crypto/store',()=>({checkLifetime:()=>true,photoReadAllowed:()=>true,keyState:{value:{document:{record:{authorityKey:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'}}}},cachedContext:vi.fn(),prepareContext:vi.fn()}))
vi.mock('../src/crypto/state',()=>({lockGeneration:{value:0}}))
vi.mock('../src/crypto/time',()=>({observe:vi.fn(),rememberClock:vi.fn(),trustedNow:()=>Date.now()}))
vi.mock('../src/crypto/client',()=>({cryptoCall:async(_action:string,data:{blob:Blob})=>data.blob}))
vi.mock('../src/crypto/api',()=>({request:async(path:string)=>new Blob([JSON.stringify(rows.get(path.split('/').at(-1)!))])}))
vi.mock('../src/crypto/database',()=>({get:vi.fn(),put:vi.fn()}))
vi.mock('../src/local/photo-names',()=>({isNameId:()=>false,localName:vi.fn(),ensureName:vi.fn()}))
import { getMetadata, type Remote } from '../src/crypto/photos'
import { publicCardPolicy } from '../src/studio/public-card-policy'
beforeAll(()=>Object.defineProperty(globalThis,'Blob',{value:NodeBlob,configurable:true}))
it('reads saved Public card edits while preserving the immutable captured assignment ceiling',async()=>{
  const captured={id:'photo',createdAt:Date.now()-1000,width:10,height:10,bytes:100,mime:'image/jpeg',method:'demo',title:'Photo',note:'',favorite:false,metadata:{publicCard:publicCardPolicy({enabled:false}),publicCardAssignment:publicCardPolicy({location:false})}}
  const latest={...captured,metadata:{publicCard:publicCardPolicy({enabled:true}),publicCardAssignment:publicCardPolicy({location:true}),editedAt:Date.now()}}
  rows.set('captured',captured);rows.set('latest',latest)
  const object=(id:string)=>({packet:{statement:{descriptor:{kind:'metadata',object_id:id}},plan:{authority:{record:{accountId:owner,authorityKey:authority}}},envelopes:[{accountId:owner}]}})
  const remote={id:'photo',captureKey:{record:{publicId:'SYNTHETIC'}},revision:2,reviewRevision:1,expiresAt:Date.now()+3600000,access:{role:'owner',read:true,thumbnail:true,edit:true,share:true,shareExternal:true},captureMetadata:object('captured'),objects:{metadata:object('latest')}} as unknown as Remote
  const photo=await getMetadata(remote)
  expect(photo.metadata?.publicCard?.enabled).toBe(true)
  expect(photo.metadata?.editedAt).toBe(latest.metadata.editedAt)
  expect(photo.metadata?.publicCardAssignment?.location).toBe(false)
  expect(photo.remoteRevision).toBe(2)
})
