import type { EncryptedFile } from 'matrix-js-sdk/lib/@types/media'
export const maxVoiceBytes = 20 * 1024 * 1024
export const maxVoiceDuration = 10 * 60 * 1000
export type VoiceDraft = { blob: Blob; duration: number; waveform: number[] }
export type VoiceMessage = { file: EncryptedFile; mimetype: string; size: number; duration: number; waveform: number[] }
const mime = /^(audio\/(?:webm|ogg|mp4|mpeg|wav|x-wav))(?:;[a-z0-9= ._-]+)?$/i
export function voiceContent(content: Record<string, any>): VoiceMessage | undefined {
  if (content.msgtype !== 'm.audio' || !content.file || !mime.test(content.info?.mimetype || '')) return
  const { file, info } = content
  if (file.v !== 'v2' || typeof file.url !== 'string' || !/^mxc:\/\/[a-z0-9.:-]+\/[a-z0-9_-]+$/i.test(file.url) || file.url.length > 512 || file.key?.alg !== 'A256CTR' || file.key?.kty !== 'oct' || typeof file.key?.k !== 'string' || file.key.k.length > 64 || typeof file.iv !== 'string' || file.iv.length > 32 || typeof file.hashes?.sha256 !== 'string' || file.hashes.sha256.length > 64) return
  if (!Number.isSafeInteger(info.size) || info.size <= 0 || info.size > maxVoiceBytes || !Number.isFinite(info.duration) || info.duration <= 0 || info.duration > maxVoiceDuration) return
  const waveform = content['org.matrix.msc1767.audio']?.waveform
  return { file, mimetype: info.mimetype, size: info.size, duration: info.duration, waveform: Array.isArray(waveform) ? waveform.slice(0, 64).map(value => Math.max(0, Math.min(1024, Number(value) || 0))) : [] }
}
export async function encryptVoice(blob: Blob) {
  if (!blob.size || blob.size > maxVoiceBytes || !mime.test(blob.type)) throw new Error('voice.invalid')
  const crypto = await import('@matrix-org/matrix-sdk-crypto-wasm')
  await crypto.initAsync()
  const raw = new Uint8Array(await blob.arrayBuffer())
  let encrypted: InstanceType<typeof crypto.EncryptedAttachment> | undefined
  try {
    encrypted = crypto.Attachment.encrypt(raw)
    const bytes = encrypted.encryptedData
    return { blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }), file: JSON.parse(encrypted.mediaEncryptionInfo!) as Omit<EncryptedFile, 'url'> }
  } finally { raw.fill(0); encrypted?.free() }
}
export async function decryptVoice(bytes: Uint8Array<ArrayBuffer>, voice: VoiceMessage) {
  if (!bytes.length || bytes.length > maxVoiceBytes || bytes.length !== voice.size) throw new Error('voice.invalid')
  const crypto = await import('@matrix-org/matrix-sdk-crypto-wasm')
  await crypto.initAsync()
  let encrypted: InstanceType<typeof crypto.EncryptedAttachment> | undefined
  try {
    const { url: _url, ...info } = voice.file
    encrypted = new crypto.EncryptedAttachment(bytes, JSON.stringify(info))
    const clear = crypto.Attachment.decrypt(encrypted)
    try { return new Blob([clear as Uint8Array<ArrayBuffer>], { type: voice.mimetype }) }
    finally { clear.fill(0) }
  } catch { throw new Error('voice.invalid') }
  finally { bytes.fill(0); encrypted?.free() }
}
export function voiceTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
