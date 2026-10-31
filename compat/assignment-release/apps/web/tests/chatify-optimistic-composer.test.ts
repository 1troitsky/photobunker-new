// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MessageComposer from '../src/messages/shared-ui/MessageComposer.vue'
import { visiblePendingText, acknowledgedPendingText, type PendingText } from '../src/messages/optimistic'

const props = {
  modelValue: '',
  placeholder: 'Message',
  inputLabel: 'Message',
  sendLabel: 'Send',
  cancelReplyLabel: 'Cancel reply',
  replyLabel: 'Reply',
  voiceDirty: false,
  disabled: false,
}
const optimistic = (suffix: string, overrides: Partial<PendingText> = {}): PendingText => ({
  id: '~pb-ui:pb-' + suffix,
  txnId: 'pb-' + suffix,
  roomId: '!room:example',
  body: 'same text',
  status: 'sending',
  time: 42,
  inFlight: false,
  ...overrides,
})

describe('PB-U03 Chatify composer UI', () => {
  it('is controlled, accessible and never sends a blank text message', async () => {
    const wrapper = mount(MessageComposer, { props })
    expect(wrapper.get('textarea').attributes('aria-label')).toBe('Message')
    expect(wrapper.find('.message-send').exists()).toBe(false)
    await wrapper.get('textarea').setValue('hello')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['hello'])
    await wrapper.setProps({ modelValue: 'hello' })
    expect(wrapper.get('button.message-send').attributes('aria-label')).toBe('Send')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toHaveLength(1)
  })

  it('keeps the draft and submit disabled while the host is not authorized to send', async () => {
    const wrapper = mount(MessageComposer, { props: { ...props, modelValue: 'secret', disabled: true } })
    expect(wrapper.get('textarea').attributes('disabled')).toBeDefined()
    expect(wrapper.get('button.message-send').attributes('disabled')).toBeDefined()
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toBeUndefined()
    await wrapper.setProps({ disabled: false })
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toHaveLength(1)
  })

  it('allows trusted offline draft edits without enabling send', async () => {
    const wrapper = mount(MessageComposer, {
      props: { ...props, modelValue: 'draft', disabled: true, allowDraftWhenDisabled: true },
    })
    expect(wrapper.get('textarea').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('button.message-send').attributes('disabled')).toBeDefined()
    await wrapper.get('textarea').setValue('edited offline draft')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['edited offline draft'])
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toBeUndefined()
    await wrapper.setProps({ allowDraftWhenDisabled: false })
    expect(wrapper.get('textarea').attributes('disabled')).toBeDefined()
  })

  it('renders reply securely, and cancels without erasing the draft', async () => {
    const wrapper = mount(MessageComposer, { props: { ...props, modelValue: 'draft', replyPreview: '<img src=x onerror=bad()>' } })
    expect(wrapper.get('.reply-preview').text()).toContain('<img src=x')
    expect(wrapper.find('img').exists()).toBe(false)
    await wrapper.get('button[aria-label="Cancel reply"]').trigger('click')
    expect(wrapper.emitted('cancelReply')).toHaveLength(1)
    expect(wrapper.get('textarea').element.value).toBe('draft')
  })

  it('retains the existing host voice recorder and hides send while voiceDirty', async () => {
    const wrapper = mount(MessageComposer, {
      props: { ...props, modelValue: 'text', voiceDirty: true },
      slots: { voice: '<div class="voice-from-host">Encrypted recorder</div>' },
    })
    expect(wrapper.find('.voice-from-host').exists()).toBe(true)
    expect(wrapper.find('.message-send').exists()).toBe(false)
    expect(wrapper.find('.message-input').isVisible()).toBe(false)
    await wrapper.setProps({ voiceDirty: false })
    expect(wrapper.find('.message-send').exists()).toBe(true)
  })

  it('supports Cmd+Enter, respects IME composition and Shift+Enter', async () => {
    const wrapper = mount(MessageComposer, { props: { ...props, modelValue: 'ready' } })
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', metaKey: true })
    expect(wrapper.emitted('submit')).toHaveLength(1)
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', metaKey: true, isComposing: true })
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', metaKey: true, shiftKey: true })
    expect(wrapper.emitted('submit')).toHaveLength(1)
  })
})

describe('PB-U03 strict Matrix outbox reconciliation', () => {
  it('shows preflight placeholder before local echo and removes it once Matrix owns the transaction', () => {
    const pending = [optimistic('one')]
    expect(visiblePendingText(pending, [], '!room:example')).toEqual(pending)
    expect(visiblePendingText(pending, [{ id: '~matrix:local', txnId: 'pb-one' }], '!room:example')).toEqual([])
  })

  it('never merges two identical bodies when transaction IDs differ', () => {
    const pending = [optimistic('one'), optimistic('two')]
    expect(visiblePendingText(pending, [{ id: '~matrix:local', txnId: 'pb-one' }], '!room:example')).toEqual([pending[1]])
  })

  it('hides the placeholder on server event ID even if an echo loses its transaction ID', () => {
    const message = optimistic('one', { serverEventId: '$server:example', status: 'sent' })
    expect(visiblePendingText([message], [{ id: '$server:example' }], '!room:example')).toEqual([])
    expect(acknowledgedPendingText([message], [{ id: '$server:example' }])).toEqual([])
  })

  it('does not hide messages merely because they contain identical plaintext', () => {
    const message = optimistic('one')
    expect(visiblePendingText([message], [{ id: '$different-message' }], '!room:example')).toEqual([message])
  })

  it('never exposes a pending entry in a different room', () => {
    expect(visiblePendingText([optimistic('one')], [], '!other:example')).toEqual([])
  })

  it('keeps failed preflight entries for retry but does not expose them as read or delivered', () => {
    const item = optimistic('one', { status: 'notSent' })
    expect(visiblePendingText([item], [], '!room:example').map(x => x.status)).toEqual(['notSent'])
  })
})
