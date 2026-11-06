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
  it('retries a cached-photo publication after server read proof refreshes, including an in-flight rejection',async()=>{
    let reject!:(error:Error)=>void
    publish.mockReturnValueOnce(new Promise<string>((_resolve,fail)=>{reject=fail}))
    publish.mockResolvedValueOnce('https://example.test/c/synthetic#public-capability')
    const wrapper=mount(PublicCardLink,{props:{photo:photo()}})
    window.dispatchEvent(new Event('photobunker-photo-security'))
    reject(new Error('identity.request_failed'));await flushPromises()
    expect(publish).toHaveBeenCalledTimes(2)
    expect(wrapper.get('a').attributes('href')).toBe('https://example.test/c/synthetic#public-capability')
    wrapper.unmount()
  })
  it('opens the eventual card from the first tap while preparation is pending',async()=>{
    let finish!:(value:string)=>void
    publish.mockReturnValue(new Promise<string>(resolve=>{finish=resolve}))
    const browser={closed:false,opener:window,document:document.implementation.createHTMLDocument(),location:{replace:vi.fn()},close:vi.fn(),focus:vi.fn()}
    const open=vi.spyOn(window,'open').mockReturnValue(browser as unknown as Window)
    const wrapper=mount(PublicCardLink,{props:{photo:photo()}})
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
    await wrapper.get('button').trigger('click')
    expect(open).toHaveBeenCalledTimes(1)
    expect(browser.opener).toBeNull()
    expect(browser.document.body.textContent).toContain('Public card')
    finish('https://example.test/c/synthetic#public-capability');await flushPromises()
    expect(browser.location.replace).toHaveBeenCalledWith('https://example.test/c/synthetic#public-capability')
    wrapper.unmount();open.mockRestore()
  })
  it('closes the preparing window and never navigates after a publication denial',async()=>{
    let deny!:(error:Error)=>void
    publish.mockReturnValue(new Promise<string>((_resolve,reject)=>{deny=reject}))
    const browser={closed:false,opener:window,document:document.implementation.createHTMLDocument(),location:{replace:vi.fn()},close:vi.fn(),focus:vi.fn()}
    const open=vi.spyOn(window,'open').mockReturnValue(browser as unknown as Window)
    const wrapper=mount(PublicCardLink,{props:{photo:photo(),menu:true}})
    await wrapper.get('button').trigger('click')
    deny(new Error('card_share.denied'));await flushPromises()
    expect(browser.close).toHaveBeenCalledTimes(1)
    expect(browser.location.replace).not.toHaveBeenCalled()
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.get('[role=status]').text()).toContain('Нет разрешения')
    wrapper.unmount();open.mockRestore()
  })
  it('closes preparation on app lock and ignores the late publication result',async()=>{
    let finish!:(value:string)=>void
    publish.mockReturnValue(new Promise<string>(resolve=>{finish=resolve}))
    const browser={closed:false,opener:window,document:document.implementation.createHTMLDocument(),location:{replace:vi.fn()},close:vi.fn(),focus:vi.fn()}
    const open=vi.spyOn(window,'open').mockReturnValue(browser as unknown as Window)
    const wrapper=mount(PublicCardLink,{props:{photo:photo()}})
    await wrapper.get('button').trigger('click')
    appLocked.value=true;await nextTick()
    finish('https://example.test/c/synthetic#public-capability');await flushPromises()
    expect(browser.close).toHaveBeenCalledTimes(1)
    expect(browser.location.replace).not.toHaveBeenCalled()
    expect(wrapper.find('a').exists()).toBe(false)
    wrapper.unmount();open.mockRestore()
  })
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
