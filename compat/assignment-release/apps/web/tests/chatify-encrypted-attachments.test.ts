// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import MessageComposer from '../src/messages/shared-ui/MessageComposer.vue'
import EncryptedAttachmentView from '../src/messages/shared-ui/EncryptedAttachmentView.vue'
import { MAX_ATTACHMENT_BYTES, safeName, validateAttachment, attachmentContent, prepareAttachment } from '../src/messages/attachment'

afterEach(() => vi.restoreAllMocks())

describe('PB-U04 E2EE media boundary and metadata', () => {
  it('accepts only allowlisted image and document MIME, and bounded files', () => {
    expect(() => validateAttachment({ type: 'image/jpeg', size: 100, name: 'photo.jpg' })).not.toThrow()
    expect(() => validateAttachment({ type: 'application/pdf', size: 150, name: 'file.pdf' })).not.toThrow()
    expect(() => validateAttachment({ type: 'image/svg+xml', size: 100, name: 'script.svg' })).toThrow()
    expect(() => validateAttachment({ type: 'text/html', size: 100, name: 'script.html' })).toThrow()
    expect(() => validateAttachment({ type: 'application/pdf', size: MAX_ATTACHMENT_BYTES + 1, name: 'huge.pdf' })).toThrow()
    expect(() => validateAttachment({ type: '', size: 100, name: 'unknown' })).toThrow()
  })

  it('removes unsafe filename path/control characters before display and download', () => {
    expect(safeName('../abc\\def\u0000.pdf')).toBe('.._abc_def_.pdf')
  })

  it('rejects unencrypted Matrix URL attachments and malformed encrypted metadata', () => {
    const content = { msgtype: 'm.image', body: 'photo.jpg', url: 'mxc://example/file', info: { mimetype: 'image/jpeg', size: 30 } }
    expect(attachmentContent(content)).toBeUndefined()
    const file = {
      v: 'v2', url: 'mxc://example.org/abc12',
      key: { alg: 'A256CTR', kty: 'oct', k: 'key' },
      iv: 'iv', hashes: { sha256: 'hash' },
    }
    expect(attachmentContent({ ...content, file, info: { mimetype: 'image/jpeg', size: 30 } })?.kind).toBe('image')
    expect(attachmentContent({ ...content, file: { ...file, url: 'https://evil.example/file' } })).toBeUndefined()
    expect(attachmentContent({ ...content, file: { ...file, key: { kty: 'oct', alg: 'none', k: 'key' } } })).toBeUndefined()
    expect(attachmentContent({ ...content, msgtype: 'm.image', info: { mimetype: 'application/pdf', size: 30 } })).toBeUndefined()
  })

  it('re-encodes image pixels and does not reuse original EXIF-bearing blob', async () => {
    const bitmap = { width: 3200, height: 1600, close: vi.fn() }
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))
    const paint = vi.fn()
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => ({ drawImage: paint }) as unknown as CanvasRenderingContext2D)
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation(callback => callback(new Blob(['clean image'], { type: 'image/jpeg' })))
    const original = new File(['EXIF GPS ORIGINAL DATA'], 'sample.jpg', { type: 'image/jpeg' })
    const prepared = await prepareAttachment(original)
    expect(prepared.kind).toBe('image')
    expect(prepared.width).toBe(2560)
    expect(prepared.height).toBe(1280)
    expect(prepared.blob).not.toBe(original)
    const decoded = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(prepared.blob)
    })
    expect(decoded).toBe('clean image')
    expect(bitmap.close).toHaveBeenCalledOnce()
    expect(getContext).toHaveBeenCalled()
    expect(toBlob).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('keeps documents byte exact for later E2EE encryption', async () => {
    const pdf = new File(['pdf bytes'], 'demo.pdf', { type: 'application/pdf' })
    const prepared = await prepareAttachment(pdf)
    expect(prepared.blob).toBe(pdf)
    expect(prepared.kind).toBe('file')
  })
})

describe('PB-U04 Chatify composer and on-demand attachment reader', () => {
  const common = {
    modelValue: '', placeholder: 'Message', inputLabel: 'Message', sendLabel: 'Send',
    cancelReplyLabel: 'Cancel', replyLabel: 'Reply', voiceDirty: false, disabled: false,
  }
  it('selects, previews, removes and sends attached files without text', async () => {
    const wrapper = mount(MessageComposer, { props: { ...common, attachLabel: 'Attach', removeAttachmentLabel: 'Remove', attachment: { name: 'test.pdf', kind: 'file' as const, size: 400 } } })
    await wrapper.get('.chatify-composer-attach').trigger('click')
    expect(wrapper.emitted('attach')).toHaveLength(1)
    expect(wrapper.get('.chatify-composer-attachment strong').text()).toBe('test.pdf')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toHaveLength(1)
    await wrapper.get('.chatify-composer-attachment button').trigger('click')
    expect(wrapper.emitted('removeAttachment')).toHaveLength(1)
  })
  it('accepts a pasted image or dropped document as a selection intent, not an upload', async () => {
    const file = new File(['pdf'], 'doc.pdf', { type: 'application/pdf' })
    const wrapper = mount(MessageComposer, { props: common })
    await wrapper.get('form').trigger('drop', { dataTransfer: { files: [file] } })
    expect(wrapper.emitted('selectFile')?.at(-1)).toEqual([file])
    await wrapper.get('form').trigger('paste', { clipboardData: { files: [file] } })
    expect(wrapper.emitted('selectFile')).toHaveLength(2)
    await wrapper.setProps({ disabled: true })
    await wrapper.get('form').trigger('drop', { dataTransfer: { files: [file] } })
    expect(wrapper.emitted('selectFile')).toHaveLength(2)
  })
    it('does not fetch or decrypt on mount; aborts and revokes on lock', async () => {
    const load = vi.fn(async (_signal: AbortSignal) => new Blob(['decrypted'], { type: 'image/jpeg' }))
    // jsdom does not guarantee blob URL APIs. Supply them explicitly.
    const oldCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    const oldRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
    const create = vi.fn().mockReturnValue('blob:private')
    const revoke = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
    const wrapper = mount(EncryptedAttachmentView, { props: {
      kind: 'image', name: 'pic.jpg', size: 100, active: true, load, openLabel: 'View',
      downloadLabel: 'Download', loadingLabel: 'Decrypting', errorLabel: 'Failed',
    } })
    expect(load).not.toHaveBeenCalled()
    await wrapper.get('.chatify-attachment-open').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('.chatify-attachment-image').exists()).toBe(true))
    expect(load).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledOnce()
    await wrapper.setProps({ active: false })
    expect(wrapper.find('.chatify-attachment-image').exists()).toBe(false)
    expect(revoke).toHaveBeenCalledWith('blob:private')
    if (oldCreate) Object.defineProperty(URL, 'createObjectURL', oldCreate)
    else Reflect.deleteProperty(URL, 'createObjectURL')
    if (oldRevoke) Object.defineProperty(URL, 'revokeObjectURL', oldRevoke)
    else Reflect.deleteProperty(URL, 'revokeObjectURL')
  })
})
