// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
const publish=vi.hoisted(() => vi.fn())
vi.mock('../src/studio/card-share-images',()=>({createPublicCardLink:publish}))
vi.mock('../src/identity/store',async()=>{const {ref}=await import('vue');return {account:ref({id:'owner'}),deviceId:ref('device')}})
vi.mock('../src/app/lock',async()=>{const {ref}=await import('vue');return {appLocked:ref(false)}})
vi.mock('../src/crypto/store',async()=>{const {ref}=await import('vue');return {strongUnlocked:ref(true),warmLocked:ref(false)}})
import PublicCardLink from '../src/components/PublicCardLink.vue'
import { appLocked } from '../src/app/lock'
import { publicCardPolicy } from '../src/studio/public-card-policy'
import type { Photo } from '../src/local/photos'
const photo=():Photo=>({id:'photo',accountId:'owner',remoteRevision:1,encrypted:true,title:'Synthetic',note:'',favorite:false,createdAt:Date.now(),expiresAt:Date.now()+3600000,width:10,height:10,bytes:100,mime:'image/jpeg',method:'demo',workspaceAccess:{role:'owner',read:true,thumbnail:true,edit:true,delete:true,share:true,shareExternal:true}})
beforeEach(()=>{appLocked.value=false;publish.mockReset();publish.mockResolvedValue('https://example.test/c/synthetic#public-capability')})
describe('Direct public card link',()=>{
  it('checks the publisher instead of permanently disabling a cached photo without grant/revision fields',async()=>{
    const input=photo();delete input.remoteRevision;delete input.workspaceAccess
    const wrapper=mount(PublicCardLink,{props:{photo:input}})
    await flushPromises()
    expect(publish).toHaveBeenCalled()
    expect(wrapper.find('a').exists()).toBe(true)
    wrapper.unmount()
  })
  it('prepares an ordinary external link and removes it when the app locks',async()=>{
    const open=vi.spyOn(window,'open')
    const wrapper=mount(PublicCardLink,{props:{photo:photo()}})
    await flushPromises()
    const anchor=wrapper.get('a')
    expect(anchor.attributes('href')).toBe('https://example.test/c/synthetic#public-capability')
    expect(anchor.attributes('target')).toBe('_blank')
    expect(anchor.attributes('rel')).toContain('noopener')
    expect(wrapper.find('[role=dialog]').exists()).toBe(false)
    expect(open).not.toHaveBeenCalled()
    appLocked.value=true;await nextTick()
    expect(wrapper.find('a').exists()).toBe(false)
    wrapper.unmount();open.mockRestore()
  })
  it('does not publish when the captured assignment disables the card',async()=>{
    const input=photo();input.metadata={publicCard:publicCardPolicy(),publicCardAssignment:publicCardPolicy({enabled:false})}
    const wrapper=mount(PublicCardLink,{props:{photo:input}})
    await flushPromises()
    expect(publish).not.toHaveBeenCalled();expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
    await wrapper.get('button').trigger('click');await flushPromises()
    expect(publish).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
