// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { webcrypto } from 'node:crypto'
import { Blob as NodeBlob } from 'node:buffer'
const state=vi.hoisted(()=>({photo:undefined as any,version:undefined as any,rows:[] as any[],decoded:undefined as any}))
vi.mock('../src/identity/store',async()=>{const {ref}=await import('vue');return {account:ref({id:'owner'}),deviceId:ref('device')}})
vi.mock('../src/app/lock',async()=>{const {ref}=await import('vue');return {appLocked:ref(false)}})
vi.mock('../src/crypto/store',async()=>{const {ref}=await import('vue');return {photoReadAllowed:()=>true,strongUnlocked:ref(true),warmLocked:ref(false)}})
vi.mock('../src/studio/photo-card-reader',()=>({readPrivateCardPhoto:vi.fn(async()=>state.photo)}))
vi.mock('../src/studio/versions',()=>({listPhotoVersions:async()=>[state.version],savePhotoVersion:vi.fn(),emptyEdits:()=>({})}))
vi.mock('../src/server/photos',()=>({readPhoto:vi.fn()}))
vi.mock('../src/studio/export',()=>({externalPhotoFile:async(_photo:unknown,blob:Blob)=>blob}))
vi.mock('../src/crypto/card-share-outbox',()=>({
  commitCardShare:vi.fn(async(id,card,scopes,expiry,duration,files)=>{
    const {encryptCardBundle,decryptCard}=await import('../src/crypto/card-shares')
    const encrypted=await encryptCardBundle(card,scopes,expiry,duration,files)
    state.decoded=await decryptCard(encrypted.ciphertext,encrypted.manifest,encrypted.secret)
    const row={id:encrypted.manifest.id,photoId:id,state:'queued',expiresAt:expiry,url:'https://example.test/c/'+encrypted.manifest.id+'#'+encrypted.secret}
    state.rows.push(row);return row
  }),
  flushCardShares:async()=>{for(const row of state.rows)row.state='sent'},
  listCardShareIntents:async()=>state.rows,
}))
import PublicCardLink from '../src/components/PublicCardLink.vue'
import { readPrivateCardPhoto } from '../src/studio/photo-card-reader'
import { commitCardShare } from '../src/crypto/card-share-outbox'
beforeAll(()=>{Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});Object.defineProperty(globalThis,'Blob',{value:NodeBlob,configurable:true})})
describe('Existing photo to public URL',()=>{
  it('rechecks a cached photo, encrypts the approved card/image and enables its external link after ACK',async()=>{
    const id='85acf08b-c2a7-4304-a670-299bc7e53dd8'
    state.photo={id,accountId:'owner',encrypted:true,remoteRevision:2,title:'Synthetic photo',shortId:'TEST0001',note:'Allowed description',favorite:false,createdAt:Date.now()-1000,expiresAt:Date.now()+86400000,width:10,height:10,bytes:100,mime:'image/jpeg',method:'demo',workspaceAccess:{role:'owner',read:true,thumbnail:true,edit:true,delete:true,share:true,shareExternal:true}}
    state.version={id:'57f50fa9-0638-40b9-92e3-a7e6b990b7cd',parentId:id,createdAt:Date.now(),sync:'synced',conflict:false,blob:new Blob(['synthetic pixels'],{type:'image/jpeg'})}
    const cached={...state.photo,workspaceAccess:undefined,remoteRevision:undefined}
    const wrapper=mount(PublicCardLink,{props:{photo:cached}})
    await vi.waitFor(()=>expect(wrapper.find('a').exists()).toBe(true))
    expect(readPrivateCardPhoto).toHaveBeenCalledWith(id,true)
    expect(commitCardShare).toHaveBeenCalledOnce()
    expect(state.decoded.title).toBe('Synthetic photo')
    expect(state.decoded.description).toBe('Allowed description')
    expect(wrapper.get('a').attributes('href')).toMatch(/^https:\/\/example\.test\/c\//)
    expect(wrapper.get('a').attributes('target')).toBe('_blank')
    wrapper.unmount()
  })
  it('cannot use a cached grant to bypass a current server denial',async()=>{
    state.photo={...state.photo,id:'d927668c-d854-48d8-931f-e862018512f5',workspaceAccess:{...state.photo.workspaceAccess,shareExternal:false}}
    const stale={...state.photo,workspaceAccess:{...state.photo.workspaceAccess,shareExternal:true}}
    const before=vi.mocked(commitCardShare).mock.calls.length
    const wrapper=mount(PublicCardLink,{props:{photo:stale,menu:true}})
    await vi.waitFor(()=>expect(wrapper.text()).toContain('Нет разрешения'))
    expect(wrapper.find('a').exists()).toBe(false)
    expect(vi.mocked(commitCardShare).mock.calls.length).toBe(before)
    expect(wrapper.text()).toContain('Нет разрешения')
    wrapper.unmount()
  })
})
