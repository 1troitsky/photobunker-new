// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactionKeys, summarizeReactions, isReactionKey } from '../src/messages/reactions'
import MessageBubble from '../src/messages/shared-ui/MessageBubble.vue'
import MessageActionList from '../src/messages/shared-ui/MessageActionList.vue'
import MessageComposer from '../src/messages/shared-ui/MessageComposer.vue'

describe('PB-U05 reaction aggregation (pure typed UI contract)', () => {
  it('deduplicates same sender/key but never aggregates different emojis or people', () => {
    const data = [
      { id: '$a', sender: '@a:local', key: '👍', timestamp: 2 },
      { id: '$b', sender: '@a:local', key: '👍', timestamp: 4 },
      { id: '$c', sender: '@b:local', key: '👍', timestamp: 3 },
      { id: '$d', sender: '@b:local', key: '❤️', timestamp: 5 },
      { id: '$malicious', sender: '@c:local', key: '<script>', timestamp: 6 },
    ]
    expect(summarizeReactions(data, '@a:local')).toEqual([
      { key: '👍', count: 2, mine: true },
      { key: '❤️', count: 1, mine: false },
    ])
    expect(reactionKeys).toHaveLength(5)
    expect(isReactionKey('👍')).toBe(true)
    expect(isReactionKey('<script>')).toBe(false)
  })

  it('does not infer read, send or reaction state from unrecognized annotations', () => {
    expect(summarizeReactions([{ id: '$a', sender: '@a:local', key: 'custom', timestamp: 1 }], '@a:local')).toEqual([])
  })
})

const props = {
  id: '$encrypted-event',
  mine: true,
  locked: false,
  grouped: false,
  highlighted: false,
  selected: false,
  selecting: false,
  sender: 'Synthetic person',
  showSender: false,
  body: 'edited, decrypted content from host',
  timeLabel: '12:34',
  status: 'read' as const,
  statusLabel: 'Read',
  menuLabel: 'Message actions',
  selectLabel: 'Select',
  hasVoice: false,
  hasPhoto: false,
}

describe('PB-U05 independent message presentation', () => {
  it('renders edited marker and safe aggregated chips; emits reaction intents only', async () => {
    const wrapper = mount(MessageBubble, { props: {
      ...props, edited: true, editedLabel: 'изменено', reactionLabel: 'Реакция',
      reactions: [{ key: '👍', count: 2, mine: true }, { key: '❤️', count: 1, mine: false }],
    } })
    expect(wrapper.get('.chatify-message-edited').text()).toBe('изменено')
    expect(wrapper.findAll('.chatify-reaction-chip')).toHaveLength(2)
    expect(wrapper.get('.chatify-reaction-chip').attributes('aria-pressed')).toBe('true')
    await wrapper.get('.chatify-reaction-chip').trigger('click')
    expect(wrapper.emitted('react')?.[0]).toEqual(['👍'])
    await wrapper.setProps({ locked: true })
    expect(wrapper.find('.chatify-reaction-chip').exists()).toBe(false)
    expect(wrapper.find('.chatify-message-edited').exists()).toBe(false)
    expect(wrapper.get('.message-body').text()).toBe(props.body)
  })

  it('allows only explicitly host-authorized edit/reaction menu options', async () => {
    const wrapper = mount(MessageActionList, {
      props: { preview: 'message',
        actions: [{ id: 'edit', label: 'Edit' }, { id: 'react', label: 'Reaction' }],
      },
    })
    expect(wrapper.findAll('button')).toHaveLength(2)
    await wrapper.findAll('button')[0]!.trigger('click')
    expect(wrapper.emitted('action')?.[0]).toEqual(['edit'])
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(wrapper.emitted('action')?.[1]).toEqual(['react'])
    await wrapper.setProps({ actions: [] })
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('disables paste/drop and attachment picker during editing without erasing text', async () => {
    const file = new File(['pdf'], 'synthetic.pdf', { type: 'application/pdf' })
    const wrapper = mount(MessageComposer, { props: {
      modelValue: 'an edit in progress', placeholder: 'Edit', inputLabel: 'Message',
      sendLabel: 'Save', cancelReplyLabel: 'Cancel editing', replyLabel: 'Editing',
      replyPreview: 'Original message', voiceDirty: false, disabled: false,
      attachLabel: 'Attach', allowAttachments: false,
    } })
    expect(wrapper.get('textarea').element.value).toBe('an edit in progress')
    expect(wrapper.find('.chatify-composer-attach').exists()).toBe(false)
    await wrapper.get('form').trigger('drop', { dataTransfer: { files: [file] } })
    await wrapper.get('form').trigger('paste', { clipboardData: { files: [file] } })
    expect(wrapper.emitted('selectFile')).toBeUndefined()
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toHaveLength(1)
    await wrapper.get('button[aria-label="Cancel editing"]').trigger('click')
    expect(wrapper.emitted('cancelReply')).toHaveLength(1)
  })
})
