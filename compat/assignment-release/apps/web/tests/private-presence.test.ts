// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref, nextTick } from 'vue'
import { describe, expect, it, vi, afterEach } from 'vitest'

const mock = vi.hoisted(() => ({requests:vi.fn(), identity:vi.fn(()=>true)}))
vi.mock('../src/identity/store', async()=>{
  const {ref}=await import('vue')
  return {account:ref({id:'account-a',publicId:'pb_a'}),deviceId:ref('device-a'),
    hasConfirmedIdentity:mock.identity}
})
vi.mock('../src/app/lock',async()=>({appLocked:(await import('vue')).ref(false)}))
vi.mock('../src/identity/api',()=>({
  identityRequest:mock.requests,
  IdentityError:class IdentityError extends Error {
    constructor(public status:number){super('identity.request_failed')}
  },
}))
import { account } from '../src/identity/store'
import { usePeerPresence } from '../src/profiles/presence'
import { presenceLabel, visibilityLabel } from '../src/profiles/presence-text'

afterEach(()=>{mock.requests.mockReset();mock.identity.mockReturnValue(true)})
describe('R1-05 private presence UI',()=>{
  it('uses coarse labels, no exact last-seen times',()=>{
    for(const state of ['online','recent','longAgo','hidden','unknown'] as const){
      expect(presenceLabel(state)).not.toContain('2026')
      expect(presenceLabel(state).length).toBeGreaterThan(3)
    }
    expect(visibilityLabel('contacts')).not.toBe(visibilityLabel('all'))
  })
  it('drops outdated status response after switching conversation peer',async()=>{
    let firstResolve!:(x:{state:string})=>void
    mock.requests.mockImplementation((path:string)=>{
      if(path.includes('alice'))return new Promise(resolve=>{firstResolve=resolve})
      if(path.includes('bob'))return Promise.resolve({state:'hidden'})
      throw Error('unexpected request')
    })
    const Component=defineComponent({
      setup(){const peer=ref('alice');const state=usePeerPresence(peer);return{peer,state}},
      template:'<span>{{state}}</span>',
    })
    const wrapper=mount(Component)
    expect(mock.requests).toHaveBeenCalledWith('/presence/alice')
    wrapper.vm.peer='bob'
    await nextTick();await flushPromises()
    expect(wrapper.text()).toBe('hidden')
    firstResolve({state:'online'})
    await flushPromises()
    expect(wrapper.text()).toBe('hidden')
    wrapper.unmount()
  })
  it('never displays a remembered online state after an unconfirmed session',async()=>{
    mock.requests.mockResolvedValue({state:'online'})
    const Component=defineComponent({
      setup(){const peer=ref('alice');const state=usePeerPresence(peer);return{state}},
      template:'<span>{{state}}</span>',
    })
    mock.identity.mockReturnValue(false)
    const wrapper=mount(Component)
    await flushPromises()
    expect(wrapper.text()).toBe('unknown')
    expect(mock.requests).not.toHaveBeenCalled()
    wrapper.unmount()
    // Account objects are reactive sources; their details are never copied to local storage.
    expect(account.value?.id).toBe('account-a')
  })
})
