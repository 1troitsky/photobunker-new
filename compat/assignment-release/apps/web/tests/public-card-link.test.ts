// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PublicCardLink from '../src/components/PublicCardLink.vue'
afterEach(()=>vi.unstubAllGlobals())
it('opens the standalone text-only page in a browser sheet without photo prerequisites',async()=>{
  const wrapper=mount(PublicCardLink,{global:{stubs:{Teleport:true}}})
  await wrapper.get('button').trigger('click')
  expect(wrapper.get('iframe').attributes('src')).toBe('/public-card.html')
  const anchor=wrapper.get('a')
  expect(anchor.attributes('href')).toBe(new URL('/public-card.html',location.origin).href)
  expect(anchor.attributes('target')).toBe('_blank')
  expect(anchor.attributes('rel')).toContain('noopener')
  await wrapper.get('[role=dialog]').trigger('keydown',{key:'Escape'})
  expect(wrapper.find('iframe').exists()).toBe(false)
  wrapper.unmount()
})
it.each([
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',5],
  ['Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)',5],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',5],
])('hands the external action to Safari for Apple mobile UA %s',async(userAgent,maxTouchPoints)=>{
  vi.stubGlobal('navigator',{userAgent,maxTouchPoints})
  vi.stubGlobal('location',new URL('https://photobunker.duckdns.org/'))
  const wrapper=mount(PublicCardLink,{global:{stubs:{Teleport:true}}})
  await wrapper.get('button').trigger('click')
  const anchor=wrapper.get('a')
  expect(anchor.attributes('href')).toBe('x-safari-https://photobunker.duckdns.org/public-card.html')
  expect(anchor.attributes('target')).toBe('_self')
  expect(anchor.attributes('aria-label')).toContain('Safari')
  expect(wrapper.get('iframe').attributes('src')).toBe('/public-card.html')
  wrapper.unmount()
})
