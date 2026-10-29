/**
 * Offline-only emoji and self-generated sticker set. No external image pack,
 * CDN, remote GIF provider, telemetry or copyrighted third-party sticker assets.
 */
export const composerEmojis = ['😀','😁','😂','😊','😍','😘','😎','🤔','😢','😭','😮','😡','👍','❤️','🔥','🎉','🙏','👀','💜','✨'] as const
export const stickerEmojis = ['😍','😂','🥳','😭','🤯','🙌','🔥','❤️'] as const
export async function makeLocalSticker(emoji: string): Promise<File> {
  if (!(stickerEmojis as readonly string[]).includes(emoji)) throw new Error('sticker.invalid')
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 320
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('sticker.unavailable')
  ctx.clearRect(0, 0, 320, 320)
  ctx.font = '220px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(emoji, 160, 163)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b =>
    b ? resolve(b) : reject(new Error('sticker.unavailable')), 'image/png'))
  canvas.width = canvas.height = 0
  if (!blob.size || blob.size > 1024 * 1024 || blob.type !== 'image/png') throw new Error('sticker.invalid')
  return new File([blob], 'sticker.png', { type: 'image/png' })
}
