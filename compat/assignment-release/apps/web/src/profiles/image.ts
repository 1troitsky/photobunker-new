import piexif from 'piexifjs'
import type { Exif } from 'piexifjs'
import type { Capture } from '../local/photos'
import { aspectRatio, type PhotoMetadata, type ProfileRules } from './model'

export class ResolutionError extends Error {
  constructor(public width: number, public height: number) { super('profile.resolution_unavailable') }
}
export function geometry(width: number, height: number, rules: ProfileRules, allowSmaller = false) {
  const ratio = aspectRatio(rules) ?? width / height
  let availableWidth = width; let availableHeight = height
  if (rules.fit === 'crop') {
    if (width / height > ratio) availableWidth = Math.floor(height * ratio)
    else availableHeight = Math.floor(width / ratio)
  } else {
    if (width / height > ratio) availableHeight = Math.ceil(width / ratio)
    else availableWidth = Math.ceil(height * ratio)
  }
  let outputWidth = availableWidth; let outputHeight = availableHeight
  let limited = false
  if (rules.resolution === 'fixed') {
    outputWidth = rules.width; outputHeight = rules.height
    const scale = rules.fit === 'crop' ? Math.max(outputWidth / width, outputHeight / height) : Math.min(outputWidth / width, outputHeight / height)
    if (scale > 1) {
      limited = true
      outputWidth = Math.max(1, Math.floor(outputWidth / scale)); outputHeight = Math.max(1, Math.floor(outputHeight / scale))
      if (!allowSmaller) throw new ResolutionError(outputWidth, outputHeight)
    }
  }
  if (outputWidth * outputHeight > 50_000_000) throw new Error('profile.image_too_large')
  const scale = rules.fit === 'crop' ? Math.max(outputWidth / width, outputHeight / height) : Math.min(outputWidth / width, outputHeight / height)
  return { width: outputWidth, height: outputHeight, drawWidth: width * scale, drawHeight: height * scale,
    x: (outputWidth - width * scale) / 2, y: (outputHeight - height * scale) / 2, limited }
}
function binary(bytes: Uint8Array): string {
  let result = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) result += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return result
}
function bytes(value: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(value, char => char.charCodeAt(0)) }
export async function stripEncodedMetadata(blob: Blob): Promise<Blob> {
  // WebKit's canvas encoder adds its own EXIF. Remove it before applying the
  // whitelist, rather than relying on an encoder to produce a metadata-free JPEG.
  const data = new Uint8Array(await blob.slice(0, 1024 * 1024).arrayBuffer())
  if (data[0] !== 255 || data[1] !== 216) throw new Error('profile.invalid_jpeg')
  const parts: BlobPart[] = [blob.slice(0, 2)]
  let offset = 2
  while (offset + 4 <= data.length) {
    if (data[offset] !== 255) throw new Error('profile.invalid_jpeg')
    const marker = data[offset + 1]!
    if (marker === 218 || marker === 217) { parts.push(blob.slice(offset)); return new Blob(parts, { type: 'image/jpeg' }) }
    const length = data[offset + 2]! * 256 + data[offset + 3]!
    if (length < 2 || offset + 2 + length > data.length) throw new Error('profile.invalid_jpeg')
    if (marker !== 225 && marker !== 237 && marker !== 254) parts.push(blob.slice(offset, offset + 2 + length))
    offset += length + 2
  }
  throw new Error('profile.invalid_jpeg')
}
export function jpegMetadata(data: Uint8Array): { exif?: string; extra: Uint8Array<ArrayBuffer>[] } {
  const result: { exif?: string; extra: Uint8Array<ArrayBuffer>[] } = { extra: [] }
  if (data[0] !== 255 || data[1] !== 216) return result
  let offset = 2
  while (offset + 4 <= data.length) {
    if (data[offset] !== 255) throw new Error('profile.invalid_jpeg')
    const marker = data[offset + 1]!
    if (marker === 218 || marker === 217) break
    const length = data[offset + 2]! * 256 + data[offset + 3]!
    if (length < 2 || offset + 2 + length > data.length) throw new Error('profile.invalid_jpeg')
    const segment = new Uint8Array(data.subarray(offset, offset + 2 + length))
    if (marker === 225 && binary(segment.subarray(4, 10)) === 'Exif\x00\x00') result.exif = binary(segment.subarray(4))
    else if (marker === 225 || marker === 237 || marker === 254) result.extra.push(segment)
    offset += length + 2
  }
  return result
}
export function selectedExif(source: Exif | undefined, rules: ProfileRules, metadata: PhotoMetadata, width: number, height: number): Partial<Exif> {
  const result: Partial<Exif> = rules.metadata === 'all' && source ? structuredClone(source) : { '0th': {}, Exif: {}, GPS: {} }
  result['0th'] ??= {}; result.Exif ??= {}; result.GPS ??= {}
  // Never copy an embedded source thumbnail after cropping/resizing.
  result['1st'] = {}; result.thumbnail = null
  if (rules.metadata === 'none') return {}
  if (rules.keepCamera && rules.metadata !== 'all' && source) {
    for (const tag of [271, 272]) if (source['0th'][tag] !== undefined) result['0th'][tag] = source['0th'][tag]
    for (const tag of [42035, 42036]) if (source.Exif[tag] !== undefined) result.Exif[tag] = source.Exif[tag]
  }
  if (rules.keepDate && metadata.capturedAt) {
    const date = new Date(metadata.capturedAt)
    const value = `${date.getFullYear()}:${String(date.getMonth() + 1).padStart(2, '0')}:${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
    result.Exif[36867] = value
  }
  if (rules.location === 'off') result.GPS = {}
  else if (source && rules.metadata === 'selected') result.GPS = structuredClone(source.GPS)
  if (metadata.location && rules.location !== 'off') {
    const coordinate = (value: number) => { const v = Math.abs(value); const degrees = Math.floor(v); const minutes = Math.floor((v - degrees) * 60); return [[degrees, 1], [minutes, 1], [Math.round(((v - degrees) * 60 - minutes) * 60 * 1_000_000), 1_000_000]] }
    result.GPS[1] = metadata.location.latitude < 0 ? 'S' : 'N'; result.GPS[2] = coordinate(metadata.location.latitude)
    result.GPS[3] = metadata.location.longitude < 0 ? 'W' : 'E'; result.GPS[4] = coordinate(metadata.location.longitude)
  }
  result['0th'][274] = 1
  result.Exif[40962] = width; result.Exif[40963] = height
  return result
}
export async function applyProfile(capture: Capture, rules: ProfileRules, metadata: PhotoMetadata, allowSmaller = false): Promise<Capture> {
  const placement = geometry(capture.width, capture.height, rules, allowSmaller)
  const url = URL.createObjectURL(capture.blob)
  const image = new Image(); const canvas = document.createElement('canvas')
  const thumbnail = document.createElement('canvas')
  try {
    image.src = url; await image.decode()
    canvas.width = placement.width; canvas.height = placement.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('profile.canvas_unavailable')
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, placement.x, placement.y, placement.drawWidth, placement.drawHeight)
    const encode = (target: HTMLCanvasElement, quality: number) => new Promise<Blob>((resolve, reject) => target.toBlob(blob => blob ? resolve(blob) : reject(new Error('profile.encode_failed')), 'image/jpeg', quality))
    let blob = await stripEncodedMetadata(await encode(canvas, rules.quality))
    if (rules.metadata !== 'none') {
      const source = jpegMetadata(new Uint8Array(await capture.blob.arrayBuffer()))
      const exif = piexif.dump(selectedExif(source.exif ? piexif.load(source.exif) : undefined, rules, metadata, canvas.width, canvas.height))
      if (exif.length + 2 > 65535) throw new Error('profile.exif_too_large')
      const header = new Uint8Array([255, 225, (exif.length + 2) >> 8, (exif.length + 2) & 255])
      blob = new Blob([blob.slice(0, 2), header, bytes(exif), ...(rules.metadata === 'all' ? source.extra : []), blob.slice(2)], { type: 'image/jpeg' })
    }
    const scale = Math.min(1, 480 / Math.max(canvas.width, canvas.height))
    thumbnail.width = Math.max(1, Math.round(canvas.width * scale)); thumbnail.height = Math.max(1, Math.round(canvas.height * scale))
    const small = thumbnail.getContext('2d')
    if (!small) throw new Error('profile.canvas_unavailable')
    small.drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height)
    metadata.resolutionLimited = placement.limited || undefined
    return { blob, thumbnail: await stripEncodedMetadata(await encode(thumbnail, 0.8)), width: canvas.width, height: canvas.height, method: capture.method }
  } finally { URL.revokeObjectURL(url); image.src = ''; canvas.width = canvas.height = thumbnail.width = thumbnail.height = 0 }
}
