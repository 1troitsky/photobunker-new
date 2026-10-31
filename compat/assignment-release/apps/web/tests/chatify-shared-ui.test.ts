// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ConversationListItem from '../src/messages/shared-ui/ConversationListItem.vue'
import MessageDateSeparator from '../src/messages/shared-ui/MessageDateSeparator.vue'
import MessageStatusTicks from '../src/messages/shared-ui/MessageStatusTicks.vue'
import ConversationSearch from '../src/messages/shared-ui/ConversationSearch.vue'
import SidebarHeader from '../src/messages/shared-ui/SidebarHeader.vue'
import ThreadHeader from '../src/messages/shared-ui/ThreadHeader.vue'
import MessengerSplitLayout from '../src/messages/shared-ui/MessengerSplitLayout.vue'

const conversation = {
  id: '!room:example',
  name: 'Private group',
  avatarClass: 'avatar-color-2',
  avatarInitials: 'PG',
  group: false,
  timeLabel: '12:34',
  preview: 'Decrypted only in the active Matrix session',
  unreadCount: 3,
}

describe('transport-independent adapted Chatify UI', () => {
  it('renders a prepared conversation without looking up or storing its decrypted preview', async () => {
    const wrapper = mount(ConversationListItem, {
      props: { conversation, active: false, swiped: false },
    })
    expect(wrapper.text()).toContain(conversation.name)
    expect(wrapper.text()).toContain(conversation.preview)
    expect(wrapper.text()).toContain('12:34')
    expect(wrapper.find('.chat-unread').text()).toBe('3')
    expect(wrapper.find('button').attributes('aria-current')).toBeUndefined()

    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('select')).toHaveLength(1)
  })

  it('keeps original room swipe, active and unread behavior', async () => {
    const wrapper = mount(ConversationListItem, {
      props: { conversation: { ...conversation, unreadCount: 105 }, active: true, swiped: true },
    })
    expect(wrapper.find('.chat-unread').text()).toBe('99+')
    expect(wrapper.get('button').classes()).toContain('chat-active')
    expect(wrapper.get('button').attributes('aria-current')).toBe('true')
    expect(wrapper.get('button').attributes('style')).toContain('translateX(-112px)')

    await wrapper.setProps({ conversation: { ...conversation, group: true, unreadCount: 0 }, active: false, swiped: false })
    expect(wrapper.find('.chat-unread').exists()).toBe(false)
    expect(wrapper.find('.chat-avatar svg').exists()).toBe(true)
    expect(wrapper.get('button').attributes('style') ?? '').not.toContain('translateX')
  })

  it('renders untrusted preview as text rather than interpreting HTML', () => {
    const wrapper = mount(ConversationListItem, {
      props: {
        conversation: { ...conversation, name: '<img src=x onerror=alert(1)>', preview: '<script>steal()</script>' },
        active: false,
        swiped: false,
      },
    })
    expect(wrapper.text()).toContain('<script>steal()</script>')
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('renders date labels supplied by the host without local date or account assumptions', () => {
    const wrapper = mount(MessageDateSeparator, { props: { label: 'Сегодня' } })
    expect(wrapper.get('.message-day').text()).toBe('Сегодня')
  })

  it('shows a second read tick only when the adapter reports an actual read receipt', async () => {
    const wrapper = mount(MessageStatusTicks, { props: { read: false } })
    expect(wrapper.findAll('path')).toHaveLength(1)
    expect(wrapper.find('.chatify-message-ticks-sent').exists()).toBe(true)
    await wrapper.setProps({ read: true })
    expect(wrapper.findAll('path')).toHaveLength(2)
    expect(wrapper.find('.chatify-message-ticks-read').exists()).toBe(true)
    expect(wrapper.get('span').attributes('aria-hidden')).toBe('true')
  })
})


describe('PB-U01 shared Chatify navigation composition', () => {
  it('keeps search display controlled by the host and emits queries without an API dependency', async () => {
    const wrapper = mount(ConversationSearch, {
      props: {
        modelValue: '',
        placeholder: 'Search chats',
        clearLabel: 'Clear',
        historyLabel: 'Search encrypted history',
        searching: false,
      },
    })
    expect(wrapper.get('form').attributes('role')).toBe('search')
    expect(wrapper.find('.search-history').exists()).toBe(false)
    await wrapper.get('input').setValue('private')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['private'])
    await wrapper.setProps({ modelValue: 'private' })
    expect(wrapper.get('.search-history').text()).toBe('Search encrypted history')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('searchHistory')).toHaveLength(1)

    await wrapper.setProps({ searching: true })
    expect(wrapper.get('.search-history').attributes('disabled')).toBeDefined()
    await wrapper.get('.chatify-search-clear').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([''])
    expect(document.activeElement).not.toBeNull()
  })

  it('isolates sidebar navigation slots and shows a live connection subtitle only if provided', async () => {
    const wrapper = mount(SidebarHeader, {
      props: { title: 'Messages', subtitle: 'Offline' },
      slots: { leading: '<button>Back</button>', actions: '<button>New message</button>' },
    })
    expect(wrapper.get('h1').text()).toBe('Messages')
    expect(wrapper.get('[role="status"]').text()).toBe('Offline')
    expect(wrapper.findAll('button')).toHaveLength(2)
    await wrapper.setProps({ title: 'Contacts', subtitle: '' })
    expect(wrapper.get('h1').text()).toBe('Contacts')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('renders host-provided Matrix header facts and routes actions without impersonating presence', async () => {
    const wrapper = mount(ThreadHeader, {
      props: {
        name: 'Private person',
        subtitle: 'Direct conversation',
        avatarClass: 'avatar-color-0',
        initials: 'PP',
        group: false,
        selecting: false,
        showBack: true,
        backLabel: 'Back',
        openLabel: 'Open profile',
      },
      slots: { actions: '<button class="host-action">Search</button>' },
    })
    expect(wrapper.get('.chat-heading h1').text()).toBe('Private person')
    expect(wrapper.get('.chat-heading small').text()).toBe('Direct conversation')
    expect(wrapper.find('.host-action').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('online')
    await wrapper.get('.messenger-back').trigger('click')
    await wrapper.get('.chat-heading').trigger('click')
    expect(wrapper.emitted('back')).toHaveLength(1)
    expect(wrapper.emitted('open')).toHaveLength(1)
    await wrapper.setProps({ selecting: true, name: '3 selected', group: true })
    expect(wrapper.get('.chat-heading').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.chat-avatar svg').exists()).toBe(true)
    await wrapper.get('.chat-heading').trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)
  })

  it('uses one split layout with parent-owned responsive selection, without a second router', () => {
    const wrapper = mount(MessengerSplitLayout, {
      slots: { default: '<aside class="messenger-sidebar">Inbox</aside><main class="messenger-thread">Timeline</main>' },
    })
    expect(wrapper.find('.messenger-workspace').exists()).toBe(true)
    expect(wrapper.get('aside').text()).toBe('Inbox')
    expect(wrapper.get('main').text()).toBe('Timeline')
    expect(wrapper.findAll('aside')).toHaveLength(1)
  })
})
