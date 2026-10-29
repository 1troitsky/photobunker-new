import { expect, it } from 'vitest'
import { decryptVoice, encryptVoice, maxVoiceBytes, voiceContent, voiceTime } from '../src/messages/voice'
it('encrypts attachments with Matrix v2 and detects tampering before playback', async () => {
  const plain = new TextEncoder().encode('synthetic microphone bytes for encrypted roundtrip')
  const encrypted = await encryptVoice(new Blob([plain], { type: 'audio/webm;codecs=opus' }))
  const bytes = new Uint8Array(await encrypted.blob.arrayBuffer())
  expect(bytes).not.toEqual(plain)
  const voice = voiceContent({ msgtype: 'm.audio', file: { ...encrypted.file, url: 'mxc://matrix.local/synthetic' }, info: { size: plain.length, duration: 2000, mimetype: 'audio/webm;codecs=opus' }, 'org.matrix.msc1767.audio': { waveform: [12, 400, 1200, -1] } })!
  expect(voice).toBeDefined(); expect(voice.waveform).toEqual([12, 400, 1024, 0])
  const content = { msgtype: 'm.audio', file: voice.file, info: { size: voice.size, duration: voice.duration, mimetype: voice.mimetype } }
  expect(voiceContent({ ...content, info: { ...content.info, size: maxVoiceBytes + 1 } })).toBeUndefined()
  expect(voiceContent({ ...content, info: { ...content.info, duration: Infinity } })).toBeUndefined()
  expect(voiceContent({ ...content, info: { ...content.info, mimetype: 'text/html' } })).toBeUndefined()
  expect(voiceContent({ ...content, file: { ...voice.file, url: 'https://foreign.invalid/audio' } })).toBeUndefined()
  const clear = await decryptVoice(bytes.slice(), voice)
  expect(new Uint8Array(await clear.arrayBuffer())).toEqual(plain)
  bytes[0] ^= 1
  await expect(decryptVoice(bytes, voice)).rejects.toThrow('voice.invalid')
  expect(bytes.every(value => value === 0)).toBe(true)
})
it('rejects unencrypted, oversized and remote URL audio metadata', () => {
  expect(voiceContent({ msgtype: 'm.audio', url: 'https://example.invalid/audio' })).toBeUndefined()
  expect(voiceContent({ msgtype: 'm.audio', file: {}, info: { size: maxVoiceBytes + 1 } })).toBeUndefined()
  expect(voiceTime(65000)).toBe('1:05')
})
