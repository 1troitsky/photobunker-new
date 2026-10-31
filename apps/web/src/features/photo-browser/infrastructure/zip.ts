/**
 * ZIP32 stored entries. JPEG is already compressed: no deflate dependency.
 * Each file is written in chunks with a data descriptor; the central directory
 * contains only sanitized paths and fixed timestamps (no capture metadata).
 */
export type ZipSink = (chunk: Uint8Array<ArrayBuffer>) => Promise<void>
type Entry = { name: Uint8Array<ArrayBuffer>; crc: number; size: number; offset: number }
const encoder = new TextEncoder()
const LE = (size: number) => new DataView(new ArrayBuffer(size))
const data = (view: DataView): Uint8Array<ArrayBuffer> => new Uint8Array(view.buffer as ArrayBuffer)
let crcTable: Uint32Array | undefined
function crc32(previous: number, bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let value = n
      for (let i = 0; i < 8; i++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : value >>> 1
      crcTable[n] = value >>> 0
    }
  }
  let crc = previous
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8)
  return crc
}
function guard32(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)
    throw new Error('browser.zip_limit')
}
export class ZipWriter {
  private offset = 0
  private readonly entries: Entry[] = []
  private readonly sink: ZipSink
  private readonly signal: AbortSignal
  constructor(sink: ZipSink, signal: AbortSignal){this.sink=sink;this.signal=signal}
  private check() {
    if (this.signal.aborted) throw new DOMException('Cancelled', 'AbortError')
  }
  private async write(bytes: Uint8Array<ArrayBuffer>) {
    this.check()
    guard32(this.offset + bytes.byteLength)
    await this.sink(bytes)
    this.offset += bytes.byteLength
    this.check()
  }
  async add(name: string, source: Blob): Promise<void> {
    this.check()
    const utf8 = encoder.encode(name)
    if (!utf8.length || utf8.length > 0xffff || this.entries.length >= 65535)
      throw new Error('browser.zip_limit')
    guard32(source.size)
    const at = this.offset
    const header = LE(30)
    header.setUint32(0, 0x04034b50, true)
    header.setUint16(4, 20, true)
    header.setUint16(6, 0x0808, true) // UTF-8 + trailing data descriptor
    header.setUint16(8, 0, true) // stored JPEG, no recompression
    header.setUint16(26, utf8.length, true)
    await this.write(data(header))
    await this.write(utf8)
    const reader = source.stream().getReader()
    let crc = 0xffffffff, size = 0
    try {
      while (true) {
        this.check()
        const next = await reader.read()
        if (next.done) break
        const bytes = next.value as Uint8Array<ArrayBuffer>
        size += bytes.byteLength
        guard32(size)
        crc = crc32(crc, bytes)
        await this.write(bytes)
      }
    } finally { await reader.cancel().catch(() => {}) }
    const checksum = (crc ^ 0xffffffff) >>> 0
    const descriptor = LE(16)
    descriptor.setUint32(0, 0x08074b50, true)
    descriptor.setUint32(4, checksum, true)
    descriptor.setUint32(8, size, true)
    descriptor.setUint32(12, size, true)
    await this.write(data(descriptor))
    this.entries.push({ name: utf8, crc: checksum, size, offset: at })
  }
  async finish(): Promise<void> {
    this.check()
    if (!this.entries.length) throw new Error('browser.empty_selection')
    const beginning = this.offset
    for (const entry of this.entries) {
      const header = LE(46)
      header.setUint32(0, 0x02014b50, true)
      header.setUint16(4, 20, true)
      header.setUint16(6, 20, true)
      header.setUint16(8, 0x0808, true)
      header.setUint16(12, 0, true)
      header.setUint32(16, entry.crc, true)
      header.setUint32(20, entry.size, true)
      header.setUint32(24, entry.size, true)
      header.setUint16(28, entry.name.length, true)
      header.setUint32(42, entry.offset, true)
      await this.write(data(header))
      await this.write(entry.name)
    }
    const end = LE(22)
    end.setUint32(0, 0x06054b50, true)
    end.setUint16(8, this.entries.length, true)
    end.setUint16(10, this.entries.length, true)
    end.setUint32(12, this.offset - beginning, true)
    end.setUint32(16, beginning, true)
    await this.write(data(end))
  }
}

/** Reject traversal, absolute paths, Windows device names and control/bidi characters. */
export function safePart(value: string, fallback: string): string {
  const normalized = value.normalize('NFKC')
    .replace(/[\\/\\:*?"<>|\u007f\u202a-\u202e\u2066-\u2069]/g, '_')
    .replace(/\p{Cc}/gu, '_')
    .replace(/[. ]+$/g, '').replace(/^\.+/g, '').trim()
    .replace(/\s+/g, ' ').slice(0, 70)
  const base = normalized || fallback
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)
    ? '_' + base : base
}
export function distinctPath(path: string, used: Set<string>): string {
  let name = path, counter = 2
  while (used.has(name.toLocaleLowerCase())) {
    const dot = path.lastIndexOf('.')
    name = dot < 0 ? path + '-' + counter : path.slice(0, dot) + '-' + counter + path.slice(dot)
    counter++
  }
  used.add(name.toLocaleLowerCase())
  return name
}
