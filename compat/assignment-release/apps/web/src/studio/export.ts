import { stripEncodedMetadata } from '../profiles/image'
import { readPhoto } from '../server/photos'
import { isExpired } from '../delivery/clock'
import type { Photo } from '../local/photos'

export function downloadFile(file: File) {
  const url = URL.createObjectURL(file), link = document.createElement('a')
  link.href = url; link.download = file.name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
export async function shareFile(file: File): Promise<'shared' | 'download' | 'cancelled'> {
  if (!navigator.canShare?.({ files: [file] }) || !navigator.share) return 'download'
  try { await navigator.share({ files: [file] }); return 'shared' }
  catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'; throw error }
}
export async function downloadPhotos(ids: string[]) { for (const id of ids) { const { photo, blob } = await readPhoto(id); downloadFile(await externalPhotoFile(photo, blob)) } }

// Re-encode the visible pixels: no EXIF/XMP/IPTC/comments, author or internal IDs.
export async function externalPhotoFile(photo: Photo, blob: Blob): Promise<File> {
  if (isExpired(photo) || photo.deleteRequested) throw new DOMException('Photo unavailable', 'NotFoundError')
  if (photo.workspaceAccess && !photo.workspaceAccess.shareExternal) throw new DOMException('Sharing unavailable', 'NotAllowedError')
  const url = URL.createObjectURL(blob), image = new Image(), canvas = document.createElement('canvas')
  try {
    image.src = url; await image.decode()
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 50_000_000) throw new Error('export.dimensions')
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')!
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0)
    const encoded = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('export.encode')), 'image/jpeg', .94))
    const clean = await stripEncodedMetadata(encoded)
    if (isExpired(photo) || photo.deleteRequested) throw new DOMException('Photo unavailable', 'NotFoundError')
    return new File([clean], photo.shortId && /^[A-Z]{4}[0-9]{4}$/.test(photo.shortId) ? photo.shortId + '.jpg' : 'photobunker-photo.jpg', { type: 'image/jpeg' })
  } finally { URL.revokeObjectURL(url); image.src = ''; canvas.width = canvas.height = 0 }
}
