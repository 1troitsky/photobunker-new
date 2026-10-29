import { account, deviceId, hasConfirmedIdentity } from '../identity/store'
import { appLockReady, appLocked } from '../app/lock'
import { protectionEnabled, photoReadAllowed } from '../crypto/store'
import { photo as currentPhoto, request } from '../workspace/api'
import { readThumbnail } from '../server/photos'
import { fetchVersions } from '../crypto/version-cloud'
import { listPhotoVersions } from '../studio/versions'
import { stripEncodedMetadata } from '../profiles/image'
import { ZipWriter, safePart, distinctPath } from './zip'
import type { BrowserCollection, BrowserPhoto } from './model'
import type { Photo } from '../local/photos'

/** An export never retrieves an immutable original or an editor layer document. */
export type ExportItem = BrowserPhoto
export type ExportRun = {
  collection: BrowserCollection
  selected: ExportItem[]
  mode: 'single' | 'zip'
  owner: string
  device: string
  signal: AbortSignal
  stillCurrent: () => boolean
  onProgress: (complete: number, total: number) => void
}
const MAX_FALLBACK_BYTES = 16 * 1024 * 1024
const MAX_STREAM_BYTES = 256 * 1024 * 1024
const MAX_FILES = 48
const MAX_FALLBACK_FILES = 10
const NAME_ID = /^[A-Z]{4}[0-9]{4}$/

function aborted(): never { throw new DOMException('Export cancelled', 'AbortError') }
export function checkExport(run: ExportRun) {
  if (run.signal.aborted || !run.stillCurrent() ||
    account.value?.id !== run.owner || deviceId.value !== run.device ||
    !appLockReady.value || appLocked.value || !hasConfirmedIdentity() ||
    (protectionEnabled.value && !photoReadAllowed()) ||
    !navigator.onLine) aborted()
}
export function fileName(photo: Photo): string {
  const prefix = NAME_ID.test(photo.shortId ?? '') ? photo.shortId! :
    safePart(photo.workspaceAccess?.read === true ? photo.title : '', photo.id)
  return safePart(prefix, photo.id) + '.jpg'
}

async function verify(run: ExportRun, item: ExportItem): Promise<Photo> {
  checkExport(run)
  // The URL is only a locator: repeat the server's current collection ACL and
  // individual photo ACL before every object, regardless of an offline snapshot.
  const collection = await request<BrowserCollection>(
    '/browser/' + encodeURIComponent(run.collection.id), 'GET', undefined, run.owner)
  checkExport(run)
  if (collection.id !== run.collection.id ||
    collection.expiresAt <= Date.now() ||
    !collection.assignments.some(task => task.id === item.assignmentId))
    throw new Error('browser.denied')
  const photo = await currentPhoto(item.id)
  checkExport(run)
  if (photo.id !== item.id || photo.accountId !== run.owner ||
    photo.workspaceAssignmentId !== item.assignmentId ||
    photo.workspaceAccess?.thumbnail !== true || photo.uploadOnly ||
    photo.deleteRequested || photo.uiVersionOf ||
    (photo.expiresAt !== undefined && photo.expiresAt <= Date.now()) ||
    item.expiresAt <= Date.now())
    throw new Error('browser.denied')
  return photo
}

async function scrubJpeg(blob: Blob, run: ExportRun): Promise<Blob> {
  checkExport(run)
  // Independently re-encode every file; never put source bytes or EXIF into ZIP.
  const url = URL.createObjectURL(blob), image = new Image(), canvas = document.createElement('canvas')
  try {
    image.src = url
    await image.decode()
    checkExport(run)
    const maxPixels = window.matchMedia?.('(pointer: coarse)').matches ? 8_000_000 : 24_000_000
    if (!image.naturalWidth || !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > maxPixels)
      throw new Error('browser.image_limit')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('browser.canvas_unavailable')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0)
    const encoded = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('browser.encode')), 'image/jpeg', 0.92))
    checkExport(run)
    const clean = await stripEncodedMetadata(encoded)
    checkExport(run)
    return clean
  } finally {
    URL.revokeObjectURL(url)
    image.src = ''
    canvas.width = canvas.height = 0
  }
}

export function permittedSource(photo: Pick<Photo, 'workspaceAccess'>):
  'thumbnail' | 'flattened-version' {
  if (photo.workspaceAccess?.thumbnail !== true)
    throw new Error('browser.denied')
  if (photo.workspaceAccess.read !== true) return 'thumbnail'
  if (photo.workspaceAccess.shareExternal !== true)
    throw new Error('browser.denied')
  return 'flattened-version'
}
async function approvedFile(run: ExportRun, item: ExportItem) {
  const photo = await verify(run, item)
  let source: Blob
  if (permittedSource(photo) === 'thumbnail') {
    // Restricted 80px thumbnail for thumbnail-only grants. In particular,
    // NEVER fall back to preview, a saved version, or original.
    source = await readThumbnail(photo.id)
  } else {
    // E2EE versions are read from the authenticated server; pending local
    // layers and the immutable original are never export candidates.
    const versions = photo.encrypted
      ? await fetchVersions(photo, true)
      : photo.workspaceAccess?.role === 'owner'
        ? await listPhotoVersions(photo) : []
    checkExport(run)
    const version = versions
      .filter(v => v.sync !== 'pending' && (v.expiresAt === undefined || v.expiresAt > Date.now()))
      .sort((a, b) => b.createdAt - a.createdAt)[0]
    if (!version) throw new Error('browser.version_required')
    source = version.blob
  }
  checkExport(run)
  const sourceLimit = window.matchMedia?.('(pointer: coarse)').matches
    ? 16 * 1024 * 1024 : 32 * 1024 * 1024
  if (source.size > sourceLimit) throw new Error('browser.image_limit')
  const clean = await scrubJpeg(source, run)
  // A credential revocation, collection revoke or TTL change racing decode
  // must abort before any pixels are written to a download/ZIP sink.
  await verify(run, item)
  checkExport(run)
  return { name: fileName(photo), blob: clean }
}

type FileWriter = {
  write(data: Uint8Array<ArrayBuffer> | Blob): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}
type FilePicker = (options: {
  suggestedName: string
  types: { description: string; accept: Record<string, string[]> }[]
}) => Promise<{ createWritable(): Promise<FileWriter> }>
function picker(): FilePicker | undefined {
  const choose = (window as Window & { showSaveFilePicker?: FilePicker }).showSaveFilePicker
  return choose?.bind(window)
}
/** Call during the click, before any asynchronous photo read, for user activation. */
export function chooseZipDestination(): Promise<FileWriter | undefined> {
  const choose = picker()
  if (!choose) return Promise.resolve(undefined)
  return choose({
    suggestedName: 'PhotoBunker-photos.zip',
    types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }],
  }).then(handle => handle.createWritable())
}

const temporaryDownloads = new Set<string>()
export function releaseTemporaryDownloads() {
  for (const url of temporaryDownloads) URL.revokeObjectURL(url)
  temporaryDownloads.clear()
}
function browserDownload(file: Blob, name: string) {
  const url = URL.createObjectURL(file)
  temporaryDownloads.add(url)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.style.display = 'none'
  document.body.append(link)
  try { link.click() }
  finally {
    link.remove()
    window.setTimeout(() => {
      if (temporaryDownloads.delete(url)) URL.revokeObjectURL(url)
    }, 10_000)
  }
}
/**
 * Completed means the File System Access writer was closed or a browser
 * download was dispatched; the browser fallback cannot confirm disk storage.
 */
export async function downloadBrowser(run: ExportRun, destination?: Promise<FileWriter | undefined>):
  Promise<'written' | 'dispatched'> {
  let writer: FileWriter | undefined
  try {
    // Await the user-activated picker inside the cleanup boundary; if the
    // account changed while it was open, abort the writer rather than leak it.
    if (run.mode === 'zip') writer = await destination
    checkExport(run)
    const items = [...new Map(run.selected.map(p => [p.id, p])).values()]
    if (run.mode === 'single' && items.length !== 1) throw new Error('browser.selection_required')
    if (!items.length || items.length > MAX_FILES ||
      items.some(p => !run.collection.assignments.some(task => task.id === p.assignmentId)))
      throw new Error('browser.selection_required')
    if (run.mode === 'single') {
      const file = await approvedFile(run, items[0]!)
      checkExport(run)
      browserDownload(file.blob, file.name)
      run.onProgress(1, 1)
      return 'dispatched'
    }
    checkExport(run)
    if (!writer && items.length > MAX_FALLBACK_FILES) throw new Error('browser.zip_limit')
    const maximum = writer ? MAX_STREAM_BYTES : MAX_FALLBACK_BYTES
    const buffers: BlobPart[] = []
    let totalBytes = 0
    const sink = async (chunk: Uint8Array<ArrayBuffer>) => {
      checkExport(run)
      if (chunk.byteLength + totalBytes > maximum) throw new Error('browser.zip_limit')
      totalBytes += chunk.byteLength
      if (writer) await writer.write(chunk)
      else buffers.push(chunk)
      checkExport(run)
    }
    const zip = new ZipWriter(sink, run.signal)
    const paths = new Set<string>()
    for (let i = 0; i < items.length; i++) {
      checkExport(run)
      const item = items[i]!
      const task = run.collection.assignments.find(t => t.id === item.assignmentId)!
      const file = await approvedFile(run, item)
      if (file.blob.size > maximum - totalBytes) throw new Error('browser.zip_limit')
      const folder = safePart(task.name, task.id) + '-' + task.id.slice(0, 8)
      const name = distinctPath(folder + '/' + file.name, paths)
      await zip.add(name, file.blob)
      // Detect revocation/expiry that occurred while the ZIP was being written.
      await verify(run, item)
      checkExport(run)
      run.onProgress(i + 1, items.length)
    }
    await zip.finish()
    checkExport(run)
    if (writer) {
      await writer.close()
      writer = undefined
      return 'written'
    }
    browserDownload(new Blob(buffers, { type: 'application/zip' }), 'PhotoBunker-photos.zip')
    return 'dispatched'
  } catch (error) {
    if (writer) await writer.abort().catch(() => {})
    throw error
  }
}
