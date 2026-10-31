// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { cleanFolders, validateFolderName } from '../src/messages/private-folders'
import EmojiStickerPicker from '../src/messages/shared-ui/EmojiStickerPicker.vue'
import MessageComposer from '../src/messages/shared-ui/MessageComposer.vue'
import { composerEmojis, stickerEmojis, makeLocalSticker } from '../src/messages/picker'

describe('PB-U04c privacy-preserving folder data', () => {
  const id = '11111111-2222-4333-8444-555555555555'
  it('normalizes names and de-duplicates room membership without losing two different rooms', () => {
    expect(validateFolderName('  My    Research  ')).toBe('My Research')
    expect(cleanFolders([{ id, name: ' Projects ', roomIds: ['!first:local', '!first:local', '!second:local', 'invalid'] }]))
      .toEqual([{ id, name: 'Projects', roomIds: ['!first:local', '!second:local'] }])
  })
  it('rejects malformed data, excessively long names and unbounded folder sets', () => {
    expect(() => validateFolderName(' '.repeat(30))).toThrow()
    expect(() => validateFolderName('x'.repeat(41))).toThrow()
    expect(() => cleanFolders([{ id: 'bad', name: 'Research', roomIds: [] }])).toThrow()
    expect(() => cleanFolders(new Array(31).fill({ id, name: 'Folder', roomIds: [] }))).toThrow()
  })
})

describe('PB-U04c offline emoji and sticker UI', () => {
  it('exposes a controlled emoji picker and sticker intents without a network request', async () => {
    const wrapper = mount(EmojiStickerPicker, { props: {
      emojiTitle: 'Emoji', stickerTitle: 'Stickers', selectLabel: 'Insert',
    } })
    expect(wrapper.findAll('.chatify-picker-symbol')).toHaveLength(composerEmojis.length)
    await wrapper.get('.chatify-picker-symbol').trigger('click')
    expect(wrapper.emitted('emoji')?.[0]).toEqual([composerEmojis[0]])
    await wrapper.get('.chatify-picker-tabs button:last-child').trigger('click')
    expect(wrapper.findAll('.chatify-picker-symbol')).toHaveLength(stickerEmojis.length)
    await wrapper.get('.chatify-picker-symbol').trigger('click')
    expect(wrapper.emitted('sticker')?.[0]).toEqual([stickerEmojis[0]])
  })
  it('rejects arbitrary supplied sticker text', async () => {
    await expect(makeLocalSticker('<script>')).rejects.toThrow('sticker.invalid')
  })
  it('generates a genuine local PNG from an allowed symbol without external fetch', async () => {
    const ctx = { clearRect: vi.fn(), fillText: vi.fn(), textAlign: '', textBaseline: '', font: '' }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback =>
      callback(new Blob(['synthetic-png'], { type: 'image/png' })))
    const file = await makeLocalSticker(stickerEmojis[0])
    expect(file.name).toBe('sticker.png')
    expect(file.type).toBe('image/png')
    expect(ctx.fillText).toHaveBeenCalled()
    vi.restoreAllMocks()
  })
  it('composer opens its host picker and inserts text at the cursor', async () => {
    const wrapper = mount(MessageComposer, { props: {
      modelValue: 'hi ', placeholder: 'Message', inputLabel: 'Message',
      sendLabel: 'Send', cancelReplyLabel: 'Cancel', replyLabel: 'Reply',
      voiceDirty: false, disabled: false, pickerLabel: 'Emoji and stickers',
    } })
    const textarea = wrapper.get('textarea').element
    textarea.setSelectionRange(3, 3)
    await wrapper.get('.chatify-composer-emoji').trigger('click')
    expect(wrapper.emitted('openPicker')).toHaveLength(1)
    const vm = wrapper.vm as unknown as { insertText: (value: string) => void }
    vm.insertText('😎')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['hi 😎'])
  })
})
