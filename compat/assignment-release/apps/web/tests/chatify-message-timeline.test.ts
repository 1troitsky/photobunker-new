// @vitest-environment jsdom
import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MessageBubble from '../src/messages/shared-ui/MessageBubble.vue'
import MessageList from '../src/messages/shared-ui/MessageList.vue'
import MessageActionList from '../src/messages/shared-ui/MessageActionList.vue'
import ScrollToBottomButton from '../src/messages/shared-ui/ScrollToBottomButton.vue'

const bubble = {
  id: '$encrypted-matrix-event',
  mine: true,
  locked: false,
  grouped: false,
  highlighted: false,
  selected: false,
  selecting: false,
  sender: 'Synthetic person',
  showSender: false,
  body: 'Only the caller supplies decrypted text',
  timeLabel: '12:34',
  status: 'sent' as const,
  statusLabel: 'Sent to Matrix',
  menuLabel: 'Message actions',
  selectLabel: 'Select message',
  hasVoice: false,
  hasPhoto: false,
}

describe('PB-U02 Chatify-derived Matrix-independent message presentation', () => {
  it('renders safe message text, event anchor and honest sent/read ticks', async () => {
    const wrapper = mount(MessageBubble, { props: bubble })
    expect(wrapper.get('article').attributes('data-event-id')).toBe(bubble.id)
    expect(wrapper.get('.message-body').text()).toBe(bubble.body)
    expect(wrapper.get('.message-state').attributes('aria-label')).toBe('Sent to Matrix')
    expect(wrapper.findAll('.chatify-message-ticks path')).toHaveLength(1)
    await wrapper.setProps({ status: 'read', statusLabel: 'Read' })
    expect(wrapper.findAll('.chatify-message-ticks path')).toHaveLength(2)
    expect(wrapper.get('.message-state').attributes('aria-label')).toBe('Read')
    await wrapper.setProps({ status: 'sending', statusLabel: 'Sending' })
    expect(wrapper.find('.chatify-message-ticks').exists()).toBe(false)
    expect(wrapper.find('.message-state-sending').exists()).toBeTruthy()
    await wrapper.setProps({ status: 'notSent', statusLabel: 'Not sent' })
    expect(wrapper.find('.message-state-notSent').exists()).toBeTruthy()
    expect(wrapper.find('.chatify-message-ticks').exists()).toBe(false)
  })

  it('does not execute HTML in decrypted body, sender or reply preview', async () => {
    const wrapper = mount(MessageBubble, { props: {
      ...bubble, body: '<script>bad()</script>', sender: '<img src=x>', showSender: true,
      replyId: '$reply', replyPreview: '<iframe src=x>',
    } })
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.text()).toContain('<script>bad()</script>')
    await wrapper.get('.chatify-reply-preview').trigger('click')
    expect(wrapper.emitted('replyJump')?.[0]).toEqual(['$reply'])
  })

  it('keeps voice/photo in host-provided slots and hides both on locked content', async () => {
    const wrapper = mount(MessageBubble, {
      props: { ...bubble, hasVoice: true, hasPhoto: true },
      slots: { voice: '<div class="voice-stub">Decrypted in host</div>', photo: '<button class="photo-stub">Open authorized photo</button>' },
    })
    expect(wrapper.find('.voice-stub').exists()).toBe(true)
    expect(wrapper.find('.photo-stub').exists()).toBe(true)
    await wrapper.setProps({ locked: true })
    expect(wrapper.find('.voice-stub').exists()).toBe(false)
    expect(wrapper.find('.photo-stub').exists()).toBe(false)
    expect(wrapper.get('.message-body').text()).toBe(bubble.body)
  })

  it('emits host intent on menu, keyboard, selection and pointer events', async () => {
    const wrapper = mount(MessageBubble, { props: bubble })
    await wrapper.get('.message-menu-button').trigger('click')
    expect(wrapper.emitted('menu')).toHaveLength(1)
    await wrapper.get('article').trigger('keydown.enter')
    expect(wrapper.emitted('menu')).toHaveLength(2)
    await wrapper.get('article').trigger('contextmenu')
    expect(wrapper.emitted('menu')).toHaveLength(3)
    await wrapper.get('article').trigger('pointercancel')
    expect(wrapper.emitted('pressCancel')).toHaveLength(1)
    await wrapper.setProps({ selecting: true, selected: true })
    expect(wrapper.get('.message-select input').element instanceof HTMLInputElement).toBe(true)
    await wrapper.get('.message-select input').trigger('change')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it('preserves keyed chronology and day separators while leaving content to the parent', () => {
    const items = [
      { message: { id: '$first' }, day: true, dayLabel: 'Сегодня' },
      { message: { id: '$second' }, day: false, dayLabel: '' },
      { message: { id: '$third' }, day: true, dayLabel: 'Вчера' },
    ]
    const wrapper = mount(MessageList, {
      props: { items },
      slots: { default: ({ item }: { item: (typeof items)[number] }) => h('p', { class: 'message-stub' }, item.message.id) },
    })
    expect(wrapper.findAll('.message-day').map(item => item.text())).toEqual(['Сегодня', 'Вчера'])
    expect(wrapper.findAll('.message-stub').map(item => item.text())).toEqual(['$first', '$second', '$third'])
  })

  it('renders exactly host-authorized menu actions and emits selected action ID', async () => {
    const wrapper = mount(MessageActionList, {
      props: {
        preview: '<untrusted message preview>',
        actions: [{ id: 'select', label: 'Select' }, { id: 'delete', label: 'Delete', destructive: true }],
      },
    })
    expect(wrapper.text()).toContain('<untrusted message preview>')
    expect(wrapper.find('untrusted').exists()).toBe(false)
    expect(wrapper.findAll('button')).toHaveLength(2)
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(wrapper.emitted('action')?.[0]).toEqual(['delete'])
    await wrapper.setProps({ actions: [{ id: 'retry', label: 'Retry' }] })
    expect(wrapper.findAll('button')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('Delete')
  })

  it('shows a host-provided new-message count without inventing one', async () => {
    const wrapper = mount(ScrollToBottomButton, { props: { label: 'Jump to latest' } })
    expect(wrapper.get('button').attributes('aria-label')).toBe('Jump to latest')
    expect(wrapper.find('.chatify-scroll-bottom-count').exists()).toBe(false)
    await wrapper.setProps({ count: 105 })
    expect(wrapper.get('.chatify-scroll-bottom-count').text()).toBe('99+')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })
})
