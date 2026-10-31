import type { EncryptedFile } from 'matrix-js-sdk/lib/@types/media'

/** One E2EE attachment per message. Bounding protects iPhone PWA memory. */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
export const MAX_IMAGE_EDGE = 2560
export const permittedTypes = new Set([
  'image/jpeg', 'image/png', 'image/webp',
  'application/pdf', 'text/plain', 'application/zip',
])
export type ChatAttachment = {
  kind: 'image' | 'file'
  name: string
  mimetype: string
  size: number
  file: EncryptedFile
  width?: number
  height?: number
}
export type PreparedAttachment = {
  blob: Blob
  name: string
  mimetype: string
  kind: 'image' | 'file'
  width?: number
  height?: number
}

/** No SVG, HTML, executable formats, paths, or implicit MIME guessing. */
export function validateAttachment(file: Pick<File, 'type' | 'size' | 'name'>) {
  if (!permittedTypes.has(file.type) || !file.size || file.size > MAX_ATTACHMENT_BYTES ||
      !file.name || file.name.length > 255) throw new Error('attachment.invalid')
}
export function safeName(name: string) {
  return name.replace(/[\\/\u0000-\u001f\u007f]/g, '_').slice(0, 120) || 'file'
}
export function attachmentContent(content: Record<string, unknown>): ChatAttachment | undefined {
  if (content.msgtype !== 'm.image' && content.msgtype !== 'm.file') return
  const data = content.file, info = content.info
  if (!data || typeof data !== 'object' || !info || typeof info !== 'object') return
  const file = data as EncryptedFile
  const meta = info as Record<string, unknown>
  const mime = meta.mimetype
  const size = meta.size
  const name = content.body
  if (typeof name !== 'string' || !name || name.length > 255 || typeof mime !== 'string' ||
      !permittedTypes.has(mime) || !Number.isSafeInteger(size) || (size as number) <= 0 ||
      (size as number) > MAX_ATTACHMENT_BYTES || file.v !== 'v2' ||
      typeof file.url !== 'string' || !/^mxc:\/\/[a-z0-9.:-]+\/[a-z0-9_-]+$/i.test(file.url) ||
      file.url.length > 512 || file.key?.alg !== 'A256CTR' || file.key?.kty !== 'oct' ||
      typeof file.key.k !== 'string' || file.key.k.length > 64 ||
      typeof file.iv !== 'string' || file.iv.length > 32 ||
      typeof file.hashes?.sha256 !== 'string' || file.hashes.sha256.length > 64) return
  const kind = content.msgtype === 'm.image' ? 'image' : 'file'
  if (kind === 'image' ? !mime.startsWith('image/') : mime.startsWith('image/')) return
  return { kind, file, name: safeName(name), mimetype: mime, size: size as number,
    ...(typeof meta.w === 'number' && Number.isSafeInteger(meta.w) && meta.w > 0 && meta.w <= 8192 ? { width: Number(meta.w) } : {}),
    ...(typeof meta.h === 'number' && Number.isSafeInteger(meta.h) && meta.h > 0 && meta.h <= 8192 ? { height: Number(meta.h) } : {}),
  }
}
/**
 * Image pixels are re-encoded in the browser (no source EXIF/GPS).
 * Do not ever upload the original image blob. PDFs/text/archives remain
 * byte-exact, and may contain metadata explicitly embedded in the document.
 */
export async function prepareAttachment(file: File): Promise<PreparedAttachment> {
  validateAttachment(file)
  if (!file.type.startsWith('image/')) return {
    blob: file, name: safeName(file.name), mimetype: file.type, kind: 'file',
  }
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('attachment.invalid')
    ctx.drawImage(bitmap, 0, 0, width, height)
    const mimetype = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(value => value ? resolve(value) : reject(new Error('attachment.invalid')), mimetype, 0.85))
    canvas.width = canvas.height = 0
    if (!blob.size || blob.size > MAX_ATTACHMENT_BYTES) throw new Error('attachment.invalid')
    return { blob, kind: 'image', mimetype, name: safeName(file.name.replace(/\.[^.]+$/, '') + (mimetype === 'image/png' ? '.png' : '.jpg')), width, height }
  } finally { bitmap.close() }
}
export async function encryptAttachment(blob: Blob) {
  if (!blob.size || blob.size > MAX_ATTACHMENT_BYTES) throw new Error('attachment.invalid')
  const crypto = await import('@matrix-org/matrix-sdk-crypto-wasm')
  await crypto.initAsync()
  const clear = new Uint8Array(await blob.arrayBuffer())
  let encrypted: InstanceType<typeof crypto.EncryptedAttachment> | undefined
  try {
    encrypted = crypto.Attachment.encrypt(clear)
    return {
      blob: new Blob([encrypted.encryptedData as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }),
      file: JSON.parse(encrypted.mediaEncryptionInfo!) as Omit<EncryptedFile, 'url'>,
    }
  } finally { clear.fill(0); encrypted?.free() }
}
export async function decryptAttachment(bytes: Uint8Array<ArrayBuffer>, item: ChatAttachment): Promise<Blob> {
  if (!bytes.length || bytes.length !== item.size || bytes.length > MAX_ATTACHMENT_BYTES)
    throw new Error('attachment.invalid')
  const crypto = await import('@matrix-org/matrix-sdk-crypto-wasm')
  await crypto.initAsync()
  let encrypted: InstanceType<typeof crypto.EncryptedAttachment> | undefined
  try {
    const { url: _url, ...info } = item.file
    encrypted = new crypto.EncryptedAttachment(bytes, JSON.stringify(info))
    const clear = crypto.Attachment.decrypt(encrypted)
    try { return new Blob([clear as Uint8Array<ArrayBuffer>], { type: item.mimetype }) }
    finally { clear.fill(0) }
  } catch { throw new Error('attachment.invalid') }
  finally { bytes.fill(0); encrypted?.free() }
}
