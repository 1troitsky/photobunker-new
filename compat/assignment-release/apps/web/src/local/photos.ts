import { localVisible, metadataEditable } from '../collaboration/access'
import type { Access, ReviewState } from '../collaboration/model'
// Temporary, explicitly unencrypted local app. Never reuse this database for
// the future E2EE outbox. Release builds require an explicit prototype opt-in.
export const localPrototype =
  import.meta.env.DEV || import.meta.env.VITE_LOCAL_PROTOTYPE === 'true'
export const DATABASE = 'photobunker-local-prototype-v1'
const stores = ['photos', 'originals', 'thumbnails']

export type Capture = {
  blob: Blob
  thumbnail: Blob
  width: number
  height: number
  method: 'image-capture' | 'video-frame' | 'demo'
}
import type { PhotoMetadata, Profile } from '../profiles/model'
import { captureRetention, isExpired } from '../delivery/clock'
import { takeName } from './photo-names'
export type CaptureContext = {
  presetName: string
  presetVersion?: number
  standard: boolean
  teamId?: string
  teamName?: string
  author: { kind: 'device' | 'unknown' } | { kind: 'account'; publicId: string }
}
export type Photo = {
  encrypted?: boolean
  legacyImported?: boolean
  accountId?: string
  workspaceAssignmentId?: string
  workspaceVaultId?: string
  workspaceAccess?: {
    role: string
    read: boolean
    thumbnail: boolean
    edit: boolean
    delete: boolean
    share: boolean
    shareExternal: boolean
  }
  thumbnailOnly?: boolean
  captureContext?: CaptureContext
  uiOnly?: boolean
  uiAssignmentId?: string
  uiTaskRevision?: number
  uiRules?: {
    descriptionRequired: boolean
    minLength: number
    particularCategory?: boolean
  }
  uiVersionOf?: string
  initialCapture?: boolean
  spaceId?: string
  creatorId?: string
  assignmentId?: string
  replacesId?: string
  uploadOnly?: boolean
  deliveryOnly?: boolean
  access?: Access
  reviewState?: ReviewState
  reviewRevision?: number
  reviewComment?: string
  responseComment?: string
  id: string
  createdAt: number
  width: number
  height: number
  bytes: number
  mime: string
  method: Capture['method']
  title: string
  note: string
  favorite: boolean
  remoteRevision?: number
  remoteLibraryId?: string
  uploadRequested?: boolean
  profile?: Profile
  shortId?: string
  needsName?: boolean
  nameAssignmentId?: string | null
  metadata?: PhotoMetadata
  category?: string
  shot?: string
  tags?: string[]
  expiresAt?: number
  retentionSeconds?: number
  retentionAnchor?: string
  metadataDirty?: boolean
  deleteRequested?: boolean
  uploadAttempts?: number
  nextAttemptAt?: number
  uploadError?:
    'network' | 'quota' | 'permission' | 'conflict' | 'clock' | 'storage'
}
export type PhotoChanges = Pick<Photo, 'title' | 'note' | 'favorite'> &
  Partial<
    Pick<
      Photo,
      | 'category'
      | 'tags'
      | 'metadata'
      | 'remoteRevision'
      | 'remoteLibraryId'
      | 'uploadRequested'
      | 'expiresAt'
      | 'metadataDirty'
    >
  >

async function open(): Promise<IDBDatabase> {
  if (!localPrototype)
    throw new DOMException('Local prototype disabled', 'NotSupportedError')
  if (!globalThis.indexedDB)
    throw new DOMException('Storage unavailable', 'SecurityError')
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    let blocked = false
    request.onupgradeneeded = () =>
      stores.forEach((name) => request.result.createObjectStore(name))
    request.onerror = () => reject(request.error)
    request.onblocked = () => {
      blocked = true
      reject(new DOMException('Close other app tabs', 'InvalidStateError'))
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => db.close()
      if (blocked) db.close()
      else resolve(db)
    }
  })
}

async function transact<T>(
  names: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => () => T,
): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction
    try {
      try {
        tx = db.transaction(names, mode, { durability: 'strict' })
      } catch (error) {
        if (!(error instanceof TypeError)) throw error
        tx = db.transaction(names, mode)
      }
    } catch (error) {
      db.close()
      reject(error)
      return
    }
    let result: () => T
    tx.oncomplete = () => {
      db.close()
      try {
        resolve(result())
      } catch (error) {
        reject(error)
      }
    }
    tx.onabort = () => {
      db.close()
      reject(tx.error ?? new DOMException('Aborted', 'AbortError'))
    }
    tx.onerror = (event) => {
      // Explicitly abort even if an engine/another listener cancels the default
      // error action. A failed request must never leave capture waiting forever.
      const error = (event.target as IDBRequest).error ?? new DOMException('Storage failed', 'UnknownError')
      try { tx.abort() } catch { db.close() }
      reject(error)
    }
    try {
      result = work(tx)
    } catch (error) {
      try {
        tx.abort()
      } catch {
        db.close()
      }
      reject(error)
    }
  })
}

export function listPhotos(): Promise<Photo[]> {
  return transact(['photos'], 'readonly', (tx) => {
    const request = tx.objectStore('photos').getAll()
    return () =>
      (request.result as Photo[]).sort(
        (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id),
      )
  })
}

export async function savePhoto(
  capture: Capture,
  details?: {
    id?: string
    accountId?: string
    nameAssignmentId?: string | null
    note?: string
    workspaceAssignmentId?: string
    uploadOnly?: boolean
    captureContext?: CaptureContext
    uiOnly?: boolean
    uiAssignmentId?: string
    uiTaskRevision?: number
    uiRules?: {
      descriptionRequired: boolean
      minLength: number
      particularCategory?: boolean
    }
    initialCapture?: boolean
    profile?: Profile
    metadata: PhotoMetadata
    category: string
    shot: string
    createdAt: number
    libraryId: string
    assignmentId?: string
    replacesId?: string
    retention?: ReturnType<typeof captureRetention>
  },
): Promise<Photo> {
  if (
    !capture.blob.size ||
    capture.blob.size > 64 * 1024 * 1024 ||
    capture.thumbnail.size > 2 * 1024 * 1024 ||
    !capture.width ||
    !capture.height
  )
    throw new DOMException('Invalid image size', 'DataError')
  const id = details?.id ?? crypto.randomUUID()
  // The UUID and reserved NAME-ID are persisted before image encryption.
  // A consumed number is never recycled if a capture fails part-way.
  const name = details?.accountId ? await takeName(id, details.nameAssignmentId ?? null) : undefined
  const photo: Photo = {
    id,
    createdAt: Date.now(),
    width: capture.width,
    height: capture.height,
    bytes: capture.blob.size,
    mime: capture.blob.type,
    method: capture.method,
    title: name ?? '',
    note: '',
    favorite: false,
  }
  if (details)
    Object.assign(photo, {
      accountId: details.accountId,
      note: details.note?.trim().slice(0,2000)??'',
      workspaceAssignmentId: details.workspaceAssignmentId,
      captureContext: details.captureContext,
      uiOnly: details.uiOnly,
      uiAssignmentId: details.uiAssignmentId,
      uiTaskRevision: details.uiTaskRevision,
      uiRules: details.uiRules,
      initialCapture: details.initialCapture,
      profile: details.profile,
      spaceId: details.profile?.spaceId,
      creatorId: details.libraryId,
      access: details.profile?.access,
      uploadOnly:
        details.uploadOnly ||
        (details.profile?.access?.role === 'contributor' &&
          !details.profile.access.readOwnPhotos),
      assignmentId: details.assignmentId,
      replacesId: details.replacesId,
      metadata: details.metadata,
      category: details.category,
      shot: details.shot,
      createdAt: details.createdAt,
      ...details.retention,
      uploadRequested: !!details.accountId || !details.uiOnly,
      shortId: name,
      needsName: !!details.accountId,
      nameAssignmentId: details.nameAssignmentId ?? null,
      remoteLibraryId: details.libraryId || undefined,
    })
  if (details?.accountId) {
    const security = await import('../crypto/store')
    if (!security.protectionReady.value || !security.protectionEnabled.value) throw new Error('crypto.setup_required')
    return (await import('../crypto/photos')).save(photo, capture)
  }
  // Persist byte buffers: WebKit can fail a Blob write without completing its
  // transaction. Existing Blob records remain readable; image bytes are never
  // decoded or rewritten.
  const original = { bytes: await capture.blob.arrayBuffer(), type: capture.blob.type }
  const thumbnail = { bytes: await capture.thumbnail.arrayBuffer(), type: capture.thumbnail.type }
  if (original.bytes.byteLength !== capture.blob.size || thumbnail.bytes.byteLength !== capture.thumbnail.size)
    throw new DOMException('Incomplete image', 'DataError')
  return transact(stores, 'readwrite', (tx) => {
    tx.objectStore('photos').add(photo, photo.id)
    tx.objectStore('originals').add(original, photo.id)
    tx.objectStore('thumbnails').add(thumbnail, photo.id)
    return () => photo
  })
}

function storedBlob(value: Blob | { bytes: ArrayBuffer; type: string }): Blob {
  return value instanceof Blob ? value : new Blob([value.bytes], { type: value.type })
}

export function readPhoto(
  id: string,
  queue = false,
): Promise<{ photo: Photo; blob: Blob }> {
  return transact(['photos', 'originals'], 'readonly', (tx) => {
    const photo = tx.objectStore('photos').get(id)
    const blob = tx.objectStore('originals').get(id)
    return () => {
      if (
        !photo.result ||
        !blob.result ||
        photo.result.deleteRequested ||
        (!queue && !localVisible(photo.result)) ||
        isExpired(photo.result)
      )
        throw new DOMException('Photo not found', 'NotFoundError')
      return { photo: photo.result as Photo, blob: storedBlob(blob.result) }
    }
  })
}

export function readThumbnail(id: string, queue = false): Promise<Blob> {
  return transact(['photos', 'thumbnails'], 'readonly', (tx) => {
    const meta = tx.objectStore('photos').get(id)
    const request = tx.objectStore('thumbnails').get(id)
    return () => {
      if (
        !request.result ||
        meta.result?.deleteRequested ||
        (meta.result &&
          ((!queue && !localVisible(meta.result)) || isExpired(meta.result)))
      )
        throw new DOMException('Photo not found', 'NotFoundError')
      return storedBlob(request.result)
    }
  })
}

export function readMetadata(id: string): Promise<Photo | undefined> {
  return transact(['photos'], 'readonly', (tx) => {
    const request = tx.objectStore('photos').get(id)
    return () => request.result as Photo | undefined
  })
}

export async function updatePhoto(
  id: string,
  changes: PhotoChanges,
): Promise<Photo> {
  const current = await readMetadata(id)
  if (
    !current ||
    current.deleteRequested ||
    current.access?.role === 'viewer' ||
    isExpired(current)
  )
    throw new DOMException('Photo not found', 'NotFoundError')
  return patchPhoto(id, changes)
}

export function patchPhoto(
  id: string,
  changes: Partial<Photo>,
  expected?: Partial<Photo>,
): Promise<Photo> {
  return transact(['photos'], 'readwrite', (tx) => {
    const store = tx.objectStore('photos')
    const request = store.get(id)
    let updated: Photo | undefined
    request.onsuccess = () => {
      if (!request.result) {
        tx.abort()
        return
      }
      const current = request.result as Photo
      if (
        current.deleteRequested &&
        Object.keys(changes).some(
          (key) =>
            !['nextAttemptAt', 'uploadError', 'uploadAttempts'].includes(key),
        )
      ) {
        updated = current
        return
      }
      if (
        expected &&
        Object.entries(expected).some(
          ([key, value]) =>
            JSON.stringify(current[key as keyof Photo]) !==
            JSON.stringify(value),
        )
      ) {
        updated = current
        return
      }
      if (
        changes.expiresAt !== undefined &&
        current.expiresAt !== undefined &&
        changes.expiresAt > current.expiresAt
      ) {
        tx.abort()
        return
      }
      if (
        current.profile &&
        !metadataEditable(current) &&
        (['title', 'note', 'category'] as const).some(
          (field) =>
            current[field] &&
            changes[field] !== undefined &&
            current[field] !== changes[field]?.trim(),
        )
      ) {
        tx.abort()
        return
      }
      if (
        current.profile &&
        !metadataEditable(current) &&
        current.tags?.length &&
        changes.tags &&
        JSON.stringify(current.tags) !== JSON.stringify(changes.tags)
      ) {
        tx.abort()
        return
      }
      updated = {
        ...(request.result as Photo),
        ...changes,
        title: (changes.title ?? current.title).trim().slice(0, 120),
        note: (changes.note ?? current.note).trim().slice(0, 2000),
      }
      store.put(updated, id)
    }
    return () => updated!
  })
}

export function deletePhoto(id: string): Promise<void> {
  return transact(stores, 'readwrite', (tx) => {
    stores.forEach((name) => tx.objectStore(name).delete(id))
    return () => undefined
  })
}

export function clearPhotos(): Promise<void> {
  return transact(stores, 'readwrite', (tx) => {
    stores.forEach((name) => tx.objectStore(name).clear())
    return () => undefined
  })
}

// Keep a small durable deletion request while removing every local image replica.
export function revokePhoto(id: string): Promise<void> {
  return transact(stores, 'readwrite', (tx) => {
    const store = tx.objectStore('photos')
    const request = store.get(id)
    request.onsuccess = () => {
      const photo = request.result as Photo | undefined
      if (!photo) return
      if (!photo.remoteLibraryId) store.delete(id)
      else
        store.put(
          {
            id,
            remoteLibraryId: photo.remoteLibraryId,
            spaceId: photo.spaceId,
            createdAt: photo.createdAt,
            expiresAt: photo.expiresAt,
            width: 0,
            height: 0,
            bytes: 0,
            mime: '',
            method: photo.method,
            title: '',
            note: '',
            favorite: false,
            deleteRequested: true,
          },
          id,
        )
      tx.objectStore('originals').delete(id)
      tx.objectStore('thumbnails').delete(id)
    }
    return () => undefined
  })
}

export function recordDeletion(photo: Photo): Promise<void> {
  return transact(stores, 'readwrite', (tx) => {
    tx.objectStore('photos').put(
      {
        id: photo.id,
        remoteLibraryId: photo.remoteLibraryId,
        spaceId: photo.spaceId,
        createdAt: photo.createdAt,
        width: 0,
        height: 0,
        bytes: 0,
        mime: '',
        method: photo.method,
        title: '',
        note: '',
        favorite: false,
        deleteRequested: true,
      },
      photo.id,
    )
    tx.objectStore('originals').delete(photo.id)
    tx.objectStore('thumbnails').delete(photo.id)
    return () => undefined
  })
}

export function acceptServerMetadata(
  photo: Photo,
  force = false,
): Promise<void> {
  return transact(['photos'], 'readwrite', (tx) => {
    const store = tx.objectStore('photos')
    const request = store.get(photo.id)
    request.onsuccess = () => {
      const current = request.result as Photo | undefined
      if (
        !current ||
        current.deleteRequested ||
        current.remoteLibraryId !== photo.remoteLibraryId
      )
        return
      if (
        !force &&
        (current.metadataDirty ||
          current.uploadRequested ||
          (current.remoteRevision ?? 0) > (photo.remoteRevision ?? 0))
      )
        return
      store.put(
        {
          ...current,
          access: photo.access,
          reviewState: photo.reviewState,
          reviewRevision: photo.reviewRevision,
          reviewComment: photo.reviewComment,
          responseComment: photo.responseComment,
          title: photo.title,
          shortId: photo.shortId || current.shortId,
          note: photo.note,
          category: photo.category,
          tags: photo.tags,
          metadata: photo.metadata,
          favorite: photo.favorite,
          remoteRevision: photo.remoteRevision,
          expiresAt:
            photo.expiresAt === undefined
              ? current.expiresAt
              : Math.min(current.expiresAt ?? Infinity, photo.expiresAt),
          metadataDirty: false,
          uploadError: undefined,
          nextAttemptAt: 0,
        },
        photo.id,
      )
    }
    return () => undefined
  })
}

// A delivery receipt keeps status and any pending GPS sidecar, never image files.
export function removeDeliveredFiles(id: string): Promise<void> {
  return transact(stores, 'readwrite', (tx) => {
    const store = tx.objectStore('photos')
    const request = store.get(id)
    request.onsuccess = () => {
      if (request.result && !request.result.deleteRequested)
        store.put(
          { ...request.result, uploadOnly: true, deliveryOnly: true },
          id,
        )
    }
    tx.objectStore('originals').delete(id)
    tx.objectStore('thumbnails').delete(id)
    return () => undefined
  })
}
