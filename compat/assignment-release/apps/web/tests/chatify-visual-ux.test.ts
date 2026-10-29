// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ConversationListItem from '../src/messages/shared-ui/ConversationListItem.vue'
import MessageBubble from '../src/messages/shared-ui/MessageBubble.vue'
import MessageComposer from '../src/messages/shared-ui/MessageComposer.vue'

describe('PhotoBunker Chatify conversation UX', () => {
  const conversation = {
    id: '!room:example', name: 'Test contact', avatarClass: 'avatar-color-0',
    avatarInitials: 'T', group: false, timeLabel: '11:40',
    preview: 'Encrypted local preview', unreadCount: 3, muted: false,
  }

  it('distinguishes unread, active and muted states without a network or Matrix dependency', async () => {
    const wrapper = mount(ConversationListItem, {
      props: { conversation, active: true, swiped: false },
    })
    expect(wrapper.get('.chat-row').classes()).toContain('chatify-has-unread')
    expect(wrapper.get('.chat-row').attributes('data-unread')).toBe('true')
    expect(wrapper.get('.chat-row').attributes('aria-current')).toBe('true')
    expect(wrapper.get('.chat-unread').text()).toBe('3')
    await wrapper.get('.chat-row').trigger('click')
    expect(wrapper.emitted('select')).toHaveLength(1)
    await wrapper.setProps({
      conversation: { ...conversation, unreadCount: 0, muted: true },
      active: false,
    })
    expect(wrapper.get('.chat-row').classes()).not.toContain('chatify-has-unread')
    expect(wrapper.get('.chat-row').attributes('data-unread')).toBe('false')
    expect(wrapper.find('.chat-unread').exists()).toBe(false)
    expect(wrapper.find('.chat-muted-icon').exists()).toBe(true)
  })

  it('opens Chatify message actions via keyboard and selects messages without plaintext leaks', async () => {
    const wrapper = mount(MessageBubble, {
      props: {
        id: '$event', mine: true, locked: false, grouped: false,
        highlighted: false, selected: false, selecting: false, sender: 'Me',
        showSender: false, body: 'Message', timeLabel: '11:40',
        status: 'sent', statusLabel: 'Sent', menuLabel: 'Message actions',
        selectLabel: 'Select message', hasVoice: false, hasPhoto: false,
      },
    })
    await wrapper.get('.chatify-message-bubble').trigger('keydown', { key: 'F10', shiftKey: true })
    expect(wrapper.emitted('menu')).toHaveLength(1)
    await wrapper.get('.chatify-message-bubble').trigger('keydown', { key: ' ', code: 'Space' })
    expect(wrapper.emitted('menu')).toHaveLength(2)
    await wrapper.setProps({ selecting: true })
    await wrapper.get('.chatify-message-bubble').trigger('keydown', { key: ' ', code: 'Space' })
    expect(wrapper.emitted('toggle')).toHaveLength(1)
    expect(wrapper.emitted('menu')).toHaveLength(2)
  })

  it('escapes a reply without erasing a typed draft or submitting to Matrix', async () => {
    const wrapper = mount(MessageComposer, {
      props: {
        modelValue: 'This draft must stay', placeholder: 'Message',
        inputLabel: 'Message', sendLabel: 'Send', cancelReplyLabel: 'Cancel reply',
        replyLabel: 'Reply', replyPreview: 'Quoted message',
        voiceDirty: false, disabled: false,
      },
    })
    await wrapper.get('textarea').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('cancelReply')).toHaveLength(1)
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.get('textarea').element.value).toBe('This draft must stay')
    await wrapper.setProps({ replyPreview: undefined })
    await wrapper.get('textarea').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('cancelReply')).toHaveLength(1)
  })
})
