// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PublicCardLink from '../src/components/PublicCardLink.vue'
it('opens the standalone text-only page in a browser sheet without photo prerequisites',async()=>{
  const wrapper=mount(PublicCardLink,{global:{stubs:{Teleport:true}}})
  await wrapper.get('button').trigger('click')
  expect(wrapper.get('iframe').attributes('src')).toBe('/public-card.html')
  const anchor=wrapper.get('a')
  expect(anchor.attributes('href')).toBe('/public-card.html')
  expect(anchor.attributes('target')).toBe('_blank')
  expect(anchor.attributes('rel')).toContain('noopener')
  await wrapper.get('[role=dialog]').trigger('keydown',{key:'Escape'})
  expect(wrapper.find('iframe').exists()).toBe(false)
  wrapper.unmount()
})
