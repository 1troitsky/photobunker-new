// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import { ZipWriter, distinctPath, safePart } from '../src/photo-browser/zip'
import { chooseZipDestination, permittedSource, fileName } from '../src/photo-browser/download'
import type { Photo } from '../src/local/photos'

const photo = (read: boolean, thumbnail: boolean, shareExternal: boolean): Photo =>
  ({ id: '123e4567-e89b-12d3-a456-426614174000',
    workspaceAccess: { role: 'viewer', read, thumbnail, shareExternal,
      share: false, edit: false, delete: false } }) as Photo

describe('R1-13 export permission boundary', () => {
  it('invokes the native save picker with its Window receiver', async () => {
    const writer = { write: async () => {}, close: async () => {}, abort: async () => {} }
    let receiver: unknown
    const previous = (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: function (this: Window) {
      receiver = this
      return Promise.resolve({ createWritable: async () => writer })
    } })
    try {
      expect(await chooseZipDestination()).toBe(writer)
      expect(receiver).toBe(window)
    } finally {
      Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: previous })
    }
  })
  it('permits thumbnail-only only as a restricted thumbnail, never a stronger image', () => {
    expect(permittedSource(photo(false, true, false))).toBe('thumbnail')
    expect(() => permittedSource(photo(false, false, true))).toThrow('browser.denied')
  })
  it('requires existing external file right for flattened version', () => {
    expect(permittedSource(photo(true, true, true))).toBe('flattened-version')
    expect(() => permittedSource(photo(true, true, false))).toThrow('browser.denied')
    expect(() => permittedSource(photo(false, false, false))).toThrow('browser.denied')
  })
  it('uses NAME-ID before private title and falls back to a safe ID', () => {
    const named = { ...photo(true, true, true), title: 'Not the filename', shortId: 'ABCD0001' }
    expect(fileName(named)).toBe('ABCD0001.jpg')
    expect(fileName({ ...photo(false, true, false), title: '../secret', shortId: undefined }))
      .toBe('123e4567-e89b-12d3-a456-426614174000.jpg')
  })
})

describe('R1-13 safe ZIP32 writer', () => {
  it('cleans path traversal and duplicate names', () => {
    expect(safePart('../../outside\\private.jpg', 'fallback')).not.toContain('/')
    expect(safePart('../', 'fallback')).not.toContain('..')
    expect(safePart('CON', 'fallback')).toBe('_CON')
    const used = new Set<string>()
    expect(distinctPath('Assignment/ABCD0001.jpg', used)).toBe('Assignment/ABCD0001.jpg')
    expect(distinctPath('Assignment/ABCD0001.jpg', used)).toBe('Assignment/ABCD0001-2.jpg')
    expect(distinctPath('assignment/abcd0001.jpg', used)).toBe('assignment/abcd0001-3.jpg')
  })
  it('streams a minimal UTF-8 ZIP without metadata, with CRC32 and valid central directory', async () => {
    const chunks: Uint8Array[] = []
    const zip = new ZipWriter(async c => { chunks.push(new Uint8Array(c)) }, new AbortController().signal)
    await zip.add('Задание/ABCD0001.jpg', new NodeBlob(['123456789']) as unknown as Blob)
    await zip.add('Other/EFGH0002.jpg', new NodeBlob(['safe']) as unknown as Blob)
    await zip.finish()
    const output = new Uint8Array(await new NodeBlob(chunks).arrayBuffer())
    const view = new DataView(output.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    expect(view.getUint16(6, true)).toBe(0x0808)
    const firstData = 30 + view.getUint16(26, true)
    const firstDescriptor = firstData + 9
    expect(view.getUint32(firstDescriptor, true)).toBe(0x08074b50)
    expect(view.getUint32(firstDescriptor + 4, true)).toBe(0xcbf43926) // CRC of 123456789
    expect(view.getUint32(firstDescriptor + 8, true)).toBe(9)
    const eocd = output.length - 22
    expect(view.getUint32(eocd, true)).toBe(0x06054b50)
    expect(view.getUint16(eocd + 10, true)).toBe(2)
    const centralOffset = view.getUint32(eocd + 16, true)
    expect(view.getUint32(centralOffset, true)).toBe(0x02014b50)
    const text = new TextDecoder().decode(output)
    expect(text).toContain('Задание/ABCD0001.jpg')
    expect(text).not.toContain('gps')
  })
  it('aborts at a sink boundary and never appends a second object', async () => {
    const controller = new AbortController()
    let written = 0
    const zip = new ZipWriter(async () => {
      written++
      if (written === 2) controller.abort()
    }, controller.signal)
    await expect(zip.add('t/file.jpg', new NodeBlob(['secret']) as unknown as Blob)).rejects.toMatchObject({ name: 'AbortError' })
    await expect(zip.add('t/other.jpg', new Blob(['secret']))).rejects.toMatchObject({ name: 'AbortError' })
    expect(written).toBe(2)
  })
})
