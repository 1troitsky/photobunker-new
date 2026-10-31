import { observe as clock, rememberClock, trustedNow as now } from './time'
export { observe as clock } from './time'
import { IdentityError } from '../identity/api'
import { account } from '../identity/store'
import type { Photo, Capture, PhotoChanges } from '../local/photos'
import { ensureName, localName, isNameId } from '../local/photo-names'
import { restrictedThumbnail } from '../workspace/thumbnail'
import { pendingCount, queueError, queueBusy } from '../workspace/state'
import {
  cachedContext,
  keyState,
  photoReadAllowed,
  prepareContext,
  checkLifetime,
} from './store'
import { lockGeneration } from './state'
import { cryptoCall } from './client'
import * as db from './database'
import { request } from './api'
import {
  ready,
  canonical,
  hash,
  b64,
  unb64,
  statementBytes,
  recipients,
  checkCapture,
  checkPacket,
  checkRoot,
  verify,
  verifyP256,
  type Packet,
  type ObjectKind,
  type Context,
  type EncryptedObject,
  type SignedPlan,
  type DeviceCertificate,
  type KeyDocument,
  type Envelope,
} from './protocol'
export type MigrationSource = {
  kind: 'local' | 'workspace' | 'legacy'
  id: string
  revision: number
  reviewRevision: number
  libraryId: string | null
}
export type Submission = {
  migration?: MigrationSource
  initial?: {
    statement: Submission
    signature: string
    certificate: DeviceCertificate
  }
  version: 1
  id: string
  creatorId: string
  deviceId: string
  vaultId: string
  assignmentId: string | null
  epoch: number
  planHash: string
  anchor: string
  retentionSeconds: number
  expiresAt: number
  packetHashes: Record<string, string>
}
type StoredObject = {
  packet: Packet
  bytes: ArrayBuffer
  pending?: EncryptedObject['pending']
}
type Sidecar = {
  object: StoredObject
  event: Record<string, unknown>
  signature: string
}
export type Job = {
  cardMetadata?: StoredObject
  cardGps?: StoredObject
  edit?: Sidecar
  editSource?: string
  draft?: StoredObject
  draftBaseRevision?: number
  gps?: Sidecar
  accountId: string
  id: string
  assignmentId?: string
  needsName?: boolean
  nameAssignmentId?: string | null
  nameCode?: string
  expiresAt: number
  submission: Submission
  signature: string
  objects: Record<string, StoredObject>
  received: boolean
  revision: number
  reviewRevision: number
  deleted?: boolean
}
export type Remote = {
  nameId?: string | null
  id: string
  vaultId: string
  creatorId: string
  assignmentId: string | null
  expiresAt: number
  revision: number
  reviewRevision: number
  reviewState: Photo['reviewState']
  submission: Submission
  signature: string
  captureCertificate: DeviceCertificate
  captureKey: KeyDocument
  captureMetadata: { packet: Packet; event: null; signature: null } | null
  objects: Record<
    string,
    {
      packet: Packet
      event: Record<string, unknown> | null
      signature: string | null
    }
  >
  access: NonNullable<Photo['workspaceAccess']>
}
const key = (id: string) => `job:${account.value?.id}:${id}`
const memo = new Map<string, Remote>()

function guard(id: string, generation: number) {
  if (
    !checkLifetime() ||
    account.value?.id !== id ||
    lockGeneration.value !== generation ||
    !photoReadAllowed()
  )
    throw new Error('crypto.locked')
}
function readGuard() {
  const id = account.value?.id
  if (!checkLifetime() || !id || !photoReadAllowed())
    throw new Error('crypto.locked')
  return { id, generation: lockGeneration.value }
}
export async function sign(key: CryptoKey, purpose: string, statement: unknown) {
  return b64(
    new Uint8Array(
      await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        statementBytes(purpose, statement) as Uint8Array<ArrayBuffer>,
      ),
    ),
  )
}
function privateBlob(value: unknown) {
  return new Blob([JSON.stringify(value)], { type: 'application/json' })
}
export async function job(id: string) {
  return db.get<Job>(key(id))
}
export async function jobs() {
  return account.value ? db.list<Job>(`job:${account.value.id}:`) : []
}
export async function encrypt(
  blob: Blob,
  context: Context,
  plan: SignedPlan,
  pending = true,
  ownOnly = false,
  creator = account.value!.id,
): Promise<StoredObject> {
  const prepared = await cachedContext(plan.statement.assignmentId ?? undefined)
  const own = keyState.value.document
  if (!own || prepared.plan.statement.epoch !== plan.statement.epoch)
    throw new Error('crypto.context_changed')
  const encrypted = await cryptoCall<EncryptedObject>('encrypt', {
    blob,
    context,
    plan,
    ownerFingerprint: prepared.ownerFingerprint,
    recipients: ownOnly
      ? [{ accountId: account.value!.id, publicKey: own.record.recipientKey }]
      : recipients(plan, creator, context.kind),
    pending: pending
      ? { accountId: account.value!.id, publicKey: own.record.pendingKey }
      : undefined,
  })
  const statement = {
    ...encrypted.statement,
    accountId: account.value!.id,
    deviceId: prepared.device.certificate.statement.deviceId,
    certificateHash: hash(canonical(prepared.device.certificate)),
    initialHash: '',
  }
  const packet: Packet = {
    statement,
    signature: await sign(prepared.device.key, 'object-manifest', statement),
    certificate: prepared.device.certificate,
    plan,
    envelopes: encrypted.envelopes,
  }
  return {
    packet,
    bytes: await encrypted.blob.arrayBuffer(),
    pending: encrypted.pending,
  }
}
export async function save(
  photo: Photo,
  capture: Capture,
  migration?: MigrationSource,
): Promise<Photo> {
  const owner = account.value?.id
  if (!owner || photo.accountId !== owner)
    throw new Error('crypto.account_changed')
  await ready()
  const prepared = await cachedContext(photo.workspaceAssignmentId),
    plan = prepared.plan
  if (!migration) checkCapture(plan, owner)
  const seconds = Math.min(
    photo.retentionSeconds ?? 1209600,
    plan.statement.retentionSeconds,
  )
  if (seconds && seconds < 3600) throw new Error('crypto.retention')
  const expiresAt = seconds
    ? Math.min(
        photo.expiresAt ?? Infinity,
        (migration ? Date.now() : photo.createdAt) + seconds * 1000,
        prepared.anchor.issuedAt + seconds * 1000,
      )
    : (photo.expiresAt ?? Number.MAX_SAFE_INTEGER)
  const clean: Photo = {
    ...photo,
    encrypted: true,
    workspaceVaultId: plan.statement.vaultId,
    uploadRequested: !!seconds,
    expiresAt,
    retentionSeconds: seconds,
    retentionAnchor: prepared.anchor.id,
  }
  const limited: Photo = {
    id: photo.id,
    accountId: owner,
    encrypted: true,
    createdAt: photo.createdAt,
    width: 80,
    height: 80,
    bytes: 0,
    mime: 'image/jpeg',
    method: photo.method,
    title: '',
    note: '',
    favorite: false,
    shortId: photo.shortId,
    captureContext: photo.captureContext,
    expiresAt,
  }
  const blobs: Record<string, Blob> = {
    original: capture.blob,
    preview: capture.thumbnail,
    thumbnail: await restrictedThumbnail(capture.thumbnail),
    metadata: privateBlob(clean),
    'restricted-metadata': privateBlob(limited),
  }
  const objects: Record<string, StoredObject> = {}
  for (const kind of Object.keys(blobs).sort()) {
    objects[kind] = await encrypt(
      blobs[kind]!,
      {
        vault_id: plan.statement.vaultId,
        asset_id: photo.id,
        object_id: crypto.randomUUID(),
        kind: kind as ObjectKind,
        object_revision: 1,
        encryption_epoch: plan.statement.epoch,
      },
      plan,
    )
  }
  const submission: Submission = {
    ...(migration ? { migration } : {}),
    version: 1,
    id: photo.id,
    creatorId: owner,
    deviceId: prepared.device.certificate.statement.deviceId,
    vaultId: plan.statement.vaultId,
    assignmentId: photo.workspaceAssignmentId ?? null,
    epoch: plan.statement.epoch,
    planHash: hash(canonical(plan)),
    anchor: prepared.anchor.id,
    retentionSeconds: seconds,
    expiresAt,
    packetHashes: Object.fromEntries(
      Object.entries(objects).map(([kind, value]) => [
        kind,
        hash(canonical(value.packet)),
      ]),
    ),
  }
  const signature = await sign(prepared.device.key, 'submission', submission)
  if (owner !== account.value?.id) throw new Error('crypto.account_changed')
  await db.put(key(photo.id), {
    accountId: owner,
    id: photo.id,
    assignmentId: photo.workspaceAssignmentId,
    needsName: photo.needsName,
    nameAssignmentId: photo.nameAssignmentId ?? null,
    nameCode: photo.shortId,
    expiresAt,
    submission,
    signature,
    objects,
    received: false,
    revision: 1,
    reviewRevision: 1,
  } satisfies Job)
  recentCaptures.set(photo.id, clean)
  setTimeout(() => recentCaptures.delete(photo.id), 120000)
  window.dispatchEvent(new Event('photobunker-outbox'))
  return clean
}
async function trustedOwner(packet: Packet) {
  const id = account.value!.id,
    owner = packet.plan.authority.record
  if (owner.accountId === id) {
    if (owner.authorityKey !== keyState.value.document?.record.authorityKey)
      throw new Error('crypto.key_changed')
  } else {
    const pin = await db.get<{ fingerprint: string; rootKey: string }>(
      `pin:${id}:${owner.accountId}`,
    )
    if (
      !pin ||
      pin.fingerprint !== hash(unb64(owner.authorityKey, 32)) ||
      pin.rootKey !== packet.plan.authority.rootKey
    )
      throw new Error('Сначала проверьте ключ владельца в защите задания.')
  }
  return hash(unb64(owner.authorityKey, 32))
}
async function decrypt(object: StoredObject, expected: Partial<Context>) {
  const { id, generation } = readGuard()
  await ready()
  const packet = object.packet,
    ownerFingerprint = await trustedOwner(packet)
  const ownEnvelope = packet.envelopes.some((e) => e.accountId === id)
  if (!ownEnvelope) throw new Error('crypto.denied')
  const blob = await cryptoCall<Blob>('decrypt', {
    packet,
    blob: new Blob([object.bytes]),
    expected,
    ownerFingerprint,
    pending: undefined,
  })
  guard(id, generation)
  return blob
}
export async function index() {
  const { id, generation } = readGuard()
  const response = await request<{
    photos: Remote[]
    receipts: Remote[]
    deleted: string[]
    serverTime: number
  }>('/photos')
  await rememberClock(id, response.serverTime)
  for (const deleted of response.deleted) {
    await tombstone(deleted)
    await db.remove(key(deleted))
    await (
      await import('./versions')
    ).removeFor({ id: deleted, accountId: id, encrypted: true } as Photo)
  }
  memo.clear()
  const photos: Photo[] = []
  for (const remote of response.photos) {
    await verifyRemote(remote)
    memo.set(remote.id, remote)
    const own = (kind: string) =>
      remote.objects[kind]?.packet.envelopes.some((e) => e.accountId === id)
    if (!own('metadata') && !own('restricted-metadata')) continue
    if (!own('metadata'))
      remote.access = {
        ...remote.access,
        read: false,
        edit: false,
        share: false,
        shareExternal: false,
      }
    photos.push(await metadata(remote))
  }
  for (const pending of await jobs()) {
    if (pending.deleted || pending.received || pending.expiresAt <= now())
      continue
    const object = pending.objects.metadata?.packet.envelopes.some(
      (e) => e.accountId === id,
    )
      ? pending.objects.metadata
      : pending.objects['restricted-metadata']
    if (!object?.packet.envelopes.some((e) => e.accountId === id)) continue
    const photo = JSON.parse(
      await (
        await decrypt(object, {
          asset_id: pending.id,
          kind: object.packet.statement.descriptor.kind,
        })
      ).text(),
    ) as Photo
    const name = pending.needsName ? await localName(pending.id).catch(() => undefined) : undefined
    photos.push({
      ...photo,
      ...(name ? { shortId: name, title: photo.title || name } : {}),
      encrypted: true,
      uploadRequested: !!pending.submission.retentionSeconds,
      remoteRevision: undefined,
    })
  }
  const receipts = []
  for (const remote of response.receipts) {
    await verifyRemote(remote)
    memo.set(remote.id, remote)
    const comments = await feedback(remote)
    receipts.push({
      id: remote.id,
      assignmentId: remote.assignmentId ?? '',
      expiresAt: remote.expiresAt,
      state: 'received',
      reviewState: remote.reviewState,
      reviewRevision: remote.reviewRevision,
      ...comments,
    })
  }
  guard(id, generation)
  return { photos, receipts, deleted: response.deleted }
}
async function verifyRemote(value: Remote) {
  const { id, generation } = readGuard(),
    s = value.submission,
    cert = value.captureCertificate,
    key = value.captureKey
  await checkRoot(key)
  if (
    s.version !== 1 ||
    s.id !== value.id ||
    s.vaultId !== value.vaultId ||
    s.assignmentId !== value.assignmentId ||
    s.creatorId !== value.creatorId ||
    s.creatorId !== cert.statement.accountId ||
    s.deviceId !== cert.statement.deviceId ||
    key.record.accountId !== s.creatorId ||
    key.record.authorityKey !== cert.statement.authorityKey ||
    value.expiresAt > s.expiresAt ||
    value.expiresAt <= now() ||
    value.revision < 1
  )
    return Promise.reject(new Error('crypto.invalid_manifest'))
  verify(
    'capture-device',
    cert.statement,
    cert.signature,
    key.record.authorityKey,
  )
  await verifyP256('submission', s, value.signature, cert.statement.signingKey)
  const high = await db.get<{
      revision: number
      submissionHash: string
      expiresAt?: number
      deleted?: boolean
      objects?: Record<string, { revision: number; statementHash: string }>
    }>(`revision:${id}:${value.id}`),
    original = await job(value.id)
  if (high?.deleted) throw new Error('crypto.deleted')
  if (original && canonical(original.submission) !== canonical(s))
    throw new Error('crypto.initial_changed')
  if (
    high &&
    (value.revision < high.revision ||
      (high.expiresAt !== undefined && value.expiresAt > high.expiresAt) ||
      high.submissionHash !== hash(canonical(s)))
  )
    throw new Error('crypto.rollback')
  const allObjects: Remote['objects'] = {
    ...value.objects,
    ...(value.captureMetadata
      ? { 'capture-metadata': value.captureMetadata }
      : {}),
  }
  const observed = { ...high?.objects }
  for (const [objectKind, object] of Object.entries(allObjects)) {
    const kind =
      objectKind === 'capture-metadata'
        ? object.packet.statement.descriptor.kind
        : objectKind
    const p = object.packet,
      d = p.statement.descriptor
    if (objectKind !== 'capture-metadata') {
      const previous = observed[kind],
        statementHash = hash(canonical(p.statement))
      if (
        previous &&
        (previous.revision > d.object_revision ||
          (previous.revision === d.object_revision &&
            previous.statementHash !== statementHash))
      )
        throw new Error('crypto.rollback')
      observed[kind] = { revision: d.object_revision, statementHash }
    }
    await trustedOwner(p)
    await checkPacket(p, {
      asset_id: value.id,
      vault_id: value.vaultId,
      kind: kind as ObjectKind,
    })
    const expected = recipients(p.plan, value.creatorId, d.kind).map((r) => ({
        accountId: r.accountId,
        fingerprint: hash(unb64(r.publicKey, 32)),
      })),
      actual = p.envelopes.map((e) => ({
        accountId: e.accountId,
        fingerprint: e.fingerprint,
      }))
    if (canonical(actual) !== canonical(expected))
      throw new Error('crypto.invalid_recipients')
    if (object.event) {
      const e = object.event,
        member = p.plan.statement.members.find(
          (m) => m.accountId === p.statement.accountId,
        ),
        manage = member?.role === 'owner' || member?.role === 'curator'
      if (
        (kind === 'gps' && p.statement.accountId !== s.creatorId) ||
        (['metadata', 'restricted-metadata'].includes(kind) &&
          !(
            member?.scope === 'all' &&
            (manage ||
              (member?.role === 'contributor' &&
                p.statement.accountId === s.creatorId &&
                p.plan.statement.changesAllowed))
          )) ||
        (kind === 'review' && (!manage || member?.scope !== 'all')) ||
        (kind === 'response' &&
          (p.statement.accountId !== s.creatorId ||
            typeof e.replyTo !== 'string' ||
            e.reviewState !== undefined))
      )
        throw new Error('crypto.invalid_producer')
      if (
        e.photoId !== value.id ||
        e.kind !== kind ||
        e.parent !== hash(canonical(s)) ||
        e.packetHash !== hash(canonical(p)) ||
        typeof e.expectedRevision !== 'number' ||
        e.expectedRevision >= value.revision ||
        p.statement.initialHash !== hash(canonical(s)) ||
        !object.signature
      )
        throw new Error('crypto.invalid_event')
      await verifyP256(
        'photo-event',
        e,
        object.signature,
        p.certificate.statement.signingKey,
      )
    } else if (
      (!p.initial && p.statement.initialHash !== '') ||
      p.statement.accountId !== s.creatorId ||
      p.statement.deviceId !== s.deviceId ||
      hash(canonical(p)) !== s.packetHashes[kind]
    )
      throw new Error('crypto.invalid_initial')
  }
  guard(id, generation)
  await db.put(`revision:${id}:${value.id}`, {
    revision: value.revision,
    submissionHash: hash(canonical(s)),
    expiresAt: value.expiresAt,
    objects: observed,
  })
}
export async function remote(id: string) {
  const value = await request<Remote>(`/photos/${id}`)
  await verifyRemote(value)
  memo.set(id, value)
  return value
}
async function remoteObject(remote: Remote, kind: string) {
  const object = remote.objects[kind]
  if (!object || remote.expiresAt <= now()) throw new Error('crypto.expired')
  const bytes = await request<Blob>(
    `/photos/${remote.id}/objects/${object.packet.statement.descriptor.object_id}`,
    'GET',
    undefined,
    'blob',
  )
  return decrypt(
    { packet: object.packet, bytes: await bytes.arrayBuffer() },
    { asset_id: remote.id, vault_id: remote.vaultId, kind: kind as ObjectKind },
  )
}
function decodePhoto(value: unknown, id: string): Photo {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('crypto.invalid_metadata')
  const p = value as Photo
  if (
    p.id !== id ||
    !Number.isSafeInteger(p.createdAt) ||
    p.createdAt < 0 ||
    !Number.isSafeInteger(p.width) ||
    !Number.isSafeInteger(p.height) ||
    p.width < 1 ||
    p.height < 1 ||
    p.width * p.height > 128000000 ||
    !Number.isSafeInteger(p.bytes) ||
    p.bytes < 0 ||
    p.bytes > 67108864 ||
    ![
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/avif',
      'image/heic',
      'image/heif',
    ].includes(p.mime) ||
    !['image-capture', 'video-frame', 'demo'].includes(p.method) ||
    typeof p.title !== 'string' ||
    p.title.length > 120 ||
    typeof p.note !== 'string' ||
    p.note.length > 2000 ||
    typeof p.favorite !== 'boolean' ||
    (p.category !== undefined && typeof p.category !== 'string') ||
    (p.tags !== undefined &&
      (!Array.isArray(p.tags) ||
        p.tags.length > 20 ||
        p.tags.some((t) => typeof t !== 'string' || t.length > 40)))
  )
    throw new Error('crypto.invalid_metadata')
  return p
}
async function metadata(remote: Remote): Promise<Photo> {
  const { id, generation } = readGuard(),
    kind = remote.access.read ? 'metadata' : 'restricted-metadata',
    capture = remote.captureMetadata
  if (!capture || capture.packet.statement.descriptor.kind !== kind)
    throw new Error('crypto.capture_metadata_missing')
  const captured = decodePhoto(
    JSON.parse(
      await (
        await remoteObject(
          { ...remote, objects: { ...remote.objects, [kind]: capture } },
          kind,
        )
      ).text(),
    ),
    remote.id,
  )
  const latest =
    remote.objects[kind]?.packet.statement.descriptor.object_id ===
    capture.packet.statement.descriptor.object_id
      ? captured
      : decodePhoto(
          JSON.parse(await (await remoteObject(remote, kind)).text()),
          remote.id,
        )
  const resolved = isNameId(remote.nameId) ? remote.nameId : undefined
  const value: Photo = {
    ...captured,
    ...(resolved ? { shortId: resolved } : {}),
    title: latest.title || resolved || '',
    note: latest.note,
    favorite: latest.favorite,
    category: latest.category,
    tags: latest.tags,
  }
  let metadata = captured.metadata
  if (remote.access.read && latest.metadata) {
    const m = latest.metadata
    metadata = {
      ...captured.metadata,
      date: m.date,
      time: m.time,
      location: m.location,
      locationStatus: m.locationStatus,
      locationEditedAt: m.locationEditedAt,
    }
  }
  if (remote.access.read && remote.objects.gps) {
    const gps = JSON.parse(await (await remoteObject(remote, 'gps')).text())
    if (!metadata?.locationEditedAt && metadata?.location?.source !== 'manual')
      metadata = {
        ...metadata,
        location: gps.location,
        locationStatus: gps.locationStatus,
      }
  }
  if (metadata?.location) {
    const l = metadata.location
    if (
      !Number.isFinite(l.latitude) ||
      l.latitude < -90 ||
      l.latitude > 90 ||
      !Number.isFinite(l.longitude) ||
      l.longitude < -180 ||
      l.longitude > 180 ||
      !['manual', 'gps'].includes(l.source ?? 'gps')
    )
      throw new Error('crypto.invalid_location')
  }
  if (!value.legacyImported && value.captureContext)
    value.captureContext = {
      ...value.captureContext,
      author: { kind: 'account', publicId: remote.captureKey.record.publicId },
    }
  const comments = await feedback(remote)
  guard(id, generation)
  return {
    ...value,
    ...comments,
    metadata,
    encrypted: true,
    accountId: id,
    creatorId: remote.captureKey.record.publicId,
    uiAssignmentId: remote.assignmentId ?? undefined,
    workspaceAssignmentId: remote.assignmentId ?? undefined,
    workspaceVaultId: remote.vaultId,
    workspaceAccess: remote.access,
    access: {
      role: remote.access.role as NonNullable<Photo['access']>['role'],
      readOwnPhotos: remote.access.thumbnail,
      manageProfiles: false,
    },
    thumbnailOnly: !remote.access.read,
    uploadOnly: !remote.access.thumbnail,
    expiresAt: remote.expiresAt,
    remoteRevision: remote.revision,
    reviewState:
      (remote.objects.review?.event?.reviewState as Photo['reviewState']) ??
      'pending',
    reviewRevision: remote.reviewRevision,
    uploadRequested: false,
    deleteRequested: false,
    metadataDirty: false,
    uiVersionOf: undefined,
  }
}

/**
 * Metadata-only local read for the private card. Reads the EXISTING encrypted
 * photo job (never image/original bytes) and requires current E2EE read gate.
 * On receipt we retain only the small encrypted metadata objects for offline
 * local display; no parallel photo/card records or plaintext storage.
 */
export async function readLocalCardMetadata(id: string): Promise<Photo | undefined> {
  const { id: owner, generation } = readGuard()
  const value = await job(id)
  if (!value || value.accountId !== owner || value.submission.creatorId !== owner ||
      value.deleted || value.expiresAt <= now()) return undefined
  const full = !!value.objects.metadata?.packet.envelopes.some(e => e.accountId === owner)
  const kind: 'metadata' | 'restricted-metadata' = full ? 'metadata' : 'restricted-metadata'
  const object = full
    ? value.draft ?? value.cardMetadata ?? value.objects.metadata
    : value.objects[kind]
  const grant = pendingGrant(value, full)
  if (!grant.thumbnail || !object?.bytes.byteLength ||
      !object.packet.envelopes.some(e => e.accountId === owner)) return undefined
  const data = decodePhoto(JSON.parse(await (
    await decrypt(object, { asset_id: id, kind })
  ).text()), id)
  let photo: Photo = data
  if (full && value.draft?.bytes.byteLength) {
    const draft = decodePhoto(JSON.parse(await (
      await decrypt(value.draft, { asset_id: id, kind: 'metadata' })
    ).text()), id)
    photo = { ...photo, ...draft }
  }
  const gpsObject = value.gps?.object ?? value.cardGps
  if (full && gpsObject?.bytes.byteLength) {
    // Pending late GPS is E2EE as well. Only full metadata readers may see it.
    const gps = JSON.parse(await (
      await decrypt(gpsObject, { asset_id: id, kind: 'gps' })
    ).text()) as Photo['metadata']
    if (gps?.location && !photo.metadata?.locationEditedAt &&
        photo.metadata?.location?.source !== 'manual') {
      photo = { ...photo, metadata: {
        ...photo.metadata, location: gps.location,
        locationStatus: gps.locationStatus,
      } }
    }
  }
  const name = value.needsName
    ? await localName(id).catch(() => undefined) ?? value.nameCode : undefined
  guard(owner, generation)
  return {
    ...photo,
    ...(name ? { shortId: name, title: photo.title || name } : {}),
    encrypted: true,
    accountId: owner,
    workspaceAssignmentId: value.assignmentId,
    workspaceAccess: grant,
    thumbnailOnly: !grant.read,
    uploadOnly: !grant.thumbnail,
    expiresAt: value.expiresAt,
    remoteRevision: value.received ? value.revision : undefined,
  }
}

export async function read(id: string) {
  const { id: owner, generation } = readGuard()
  const pending = await job(id)
  if (pending && !pending.received) {
    if (pending.expiresAt <= now() || pending.deleted)
      throw new Error('crypto.expired')
    const full = pending.objects.original!.packet.envelopes.some(
      (e) => e.accountId === owner,
    )
    const kind = full ? 'metadata' : 'restricted-metadata',
      object = full && pending.draft ? pending.draft : pending.objects[kind]!
    const photo = JSON.parse(
      await (
        await decrypt(object, { asset_id: id, kind: kind as ObjectKind })
      ).text(),
    ) as Photo
    const blob = await decrypt(
      pending.objects[full ? 'original' : 'thumbnail']!,
      { asset_id: id, kind: full ? 'original' : 'thumbnail' },
    )
    const name = pending.needsName ? await localName(id).catch(() => undefined) : undefined
    guard(owner, generation)
    return {
      photo: {
        ...photo,
        ...(name ? { shortId: name, title: photo.title || name } : {}),
        encrypted: true,
        thumbnailOnly: !full,
        workspaceAccess: pendingGrant(pending, full),
      },
      blob: new Blob([blob], { type: photo.mime }),
    }
  }
  const value = await remote(id)
  let photo = await metadata(value)
  if (pending?.draft && value.access.edit) {
    const draft = JSON.parse(
      await (
        await decrypt(pending.draft, { asset_id: id, kind: 'metadata' })
      ).text(),
    ) as Photo
    photo = {
      ...photo,
      ...draft,
      workspaceAccess: value.access,
      remoteRevision: pending.draftBaseRevision,
      metadataDirty: true,
      expiresAt: Math.min(
        photo.expiresAt ?? Infinity,
        draft.expiresAt ?? Infinity,
      ),
    }
  }
  const blob = await remoteObject(
    value,
    value.access.read ? 'original' : 'thumbnail',
  )
  if (isNameId(value.nameId)) {
    photo.shortId = value.nameId
    if (!photo.title) photo.title = value.nameId
  }
  guard(owner, generation)
  return { photo, blob: new Blob([blob], { type: photo.mime }) }
}
export async function thumbnail(id: string) {
  const pending = await job(id)
  if (pending && !pending.received) {
    if (pending.deleted || pending.expiresAt <= now())
      throw new Error('crypto.expired')
    const full = pending.objects.preview!.packet.envelopes.some(
        (e) => e.accountId === account.value!.id,
      ),
      kind = full ? 'preview' : 'thumbnail'
    return decrypt(pending.objects[kind]!, { asset_id: id, kind })
  }
  const value = memo.get(id) ?? (await remote(id))
  return remoteObject(value, value.access.read ? 'preview' : 'thumbnail')
}
const rewrapping = new Set<string>()
const sending = new Map<string, Promise<void>>()
export function upload(id: string) {
  if (rewrapping.has(id)) return Promise.reject(new Error('crypto.busy'))
  const running = sending.get(id)
  if (running) return running
  const task = send(id).finally(() => sending.delete(id))
  sending.set(id, task)
  return task
}
async function send(id: string) {
  const owner = account.value?.id
  const value = await job(id)
  if (!value || value.deleted || !owner || value.accountId !== owner) return
  if (value.received) {
    await sendGps(value)
    await sendDraft(value.id)
    return
  }
  if (value.expiresAt <= Date.now()) throw new Error('crypto.expired')
  if (!value.submission.retentionSeconds) return
  // This mapping is server-authorized and separate from immutable encrypted
  // photo metadata. The signed submission and ciphertext never change.
  if (value.needsName) await ensureName(id, value.nameAssignmentId ?? null, value.nameCode)
  const form = new FormData()
  form.set('submission', canonical(value.submission))
  form.set('signature', value.signature)
  form.set(
    'packets',
    canonical(
      Object.fromEntries(
        Object.entries(value.objects).map(([kind, object]) => [
          kind,
          object.packet,
        ]),
      ),
    ),
  )
  for (const [kind, object] of Object.entries(value.objects))
    form.set(
      `files[${kind}]`,
      new Blob([object.bytes], { type: 'application/octet-stream' }),
      'ciphertext',
    )
  await request('/photos', 'POST', form, 'json', owner)
  if (owner !== account.value?.id) throw new Error('crypto.account_changed')
  const acknowledged = await db.update<Job>(key(id), (current) => {
    current.received = true
    for (const object of Object.values(current.objects)) {
      delete object.pending
      // Keep only local E2EE metadata ciphertext for offline Photo Card after
      // reload. Original/preview/thumbnail bytes are still released after ACK.
      if (!['metadata', 'restricted-metadata'].includes(object.packet.statement.descriptor.kind))
        object.bytes = new ArrayBuffer(0)
    }
    return current
  })
  if (acknowledged && !acknowledged.deleted) {
    await sendGps(acknowledged)
    await sendDraft(id)
  }
  window.dispatchEvent(new Event('photobunker-delivery'))
}
export async function deliver() {
  if (queueBusy.value || !account.value || !navigator.onLine) return
  const owner = account.value.id
  queueBusy.value = true
  queueError.value = ''
  try {
    if (photoReadAllowed())
      for (const deleted of (await jobs()).filter((j) => j.deleted))
        await finishDeletion(deleted.id)
    const rows = (await jobs()).filter(
      (j) =>
        (!j.received || j.gps || j.draft) &&
        !j.deleted &&
        j.submission.retentionSeconds,
    )
    pendingCount.value = rows.length
    for (const row of rows) {
      if (account.value?.id !== owner) break
      try {
        await upload(row.id)
        pendingCount.value = Math.max(0, pendingCount.value - 1)
      } catch (error) {
        queueError.value =
          error instanceof IdentityError
            ? error.status === 409
              ? 'keys'
              : error.status === 413
                ? 'quota'
                : [401, 403, 404, 410, 422].includes(error.status)
                  ? 'permission'
                  : 'network'
            : 'network'
        break
      }
    }
  } finally {
    queueBusy.value = false
  }
}

export async function update(
  id: string,
  changes: PhotoChanges,
  revision?: number,
) {
  const pending = await job(id)
  if (pending && !pending.received) {
    const current = (await read(id)).photo
    if (!current.workspaceAccess?.edit) throw new Error('crypto.denied')
    if (
      changes.expiresAt !== undefined &&
      changes.expiresAt > pending.expiresAt
    )
      throw new Error('crypto.retention')
    const photo = { ...current, ...changes },
      prepared = await cachedContext(pending.assignmentId),
      draft = await encryptLocal(
        privateBlob(photo),
        id,
        'metadata',
        prepared.plan,
      )
    await db.update<Job>(key(id), (value) => {
      if (value.deleted) throw new Error('crypto.deleted')
      value.draft = draft
      value.draftBaseRevision = value.revision
      return value
    })
    window.dispatchEvent(new Event('photobunker-outbox'))
    return { ...photo, metadataDirty: true }
  }
  const value = await remote(id)
  if (!value.access.edit) throw new Error('crypto.denied')
  const current = await metadata(value)
  if (changes.expiresAt !== undefined && changes.expiresAt > value.expiresAt)
    throw new Error('crypto.retention')
  const updated = { ...current, ...changes }
  await append(value, 'metadata', updated, revision)
  return { ...updated, remoteRevision: (revision ?? value.revision) + 1 }
}
function pendingGrant(value: Job, full: boolean) {
  const plan = value.objects.original!.packet.plan,
    member = plan.statement.members.find(
      (m) => m.accountId === value.accountId,
    ),
    role = member?.role ?? 'viewer',
    manage = role === 'owner' || role === 'curator'
  return {
    role,
    read: full,
    thumbnail:
      full ||
      !!value.objects.thumbnail?.packet.envelopes.some(
        (e) => e.accountId === value.accountId,
      ),
    edit:
      full &&
      (manage || (role === 'contributor' && plan.statement.changesAllowed)),
    delete:
      manage || (role === 'contributor' && plan.statement.deletionAllowed),
    share: full && (manage || plan.statement.sharingAllowed),
    shareExternal:
      full &&
      (manage ||
        (plan.statement.sharingAllowed && !plan.statement.participantsOnly)),
  }
}
async function sendDraft(id: string) {
  let value = await job(id)
  if (!value?.draft || !photoReadAllowed()) return
  if (!value.edit) {
    const draft = value.draft,
      photo = JSON.parse(
        await (await decrypt(draft, { asset_id: id, kind: 'metadata' })).text(),
      ) as Photo,
      current = await remote(id)
    if (
      !current.access.edit ||
      current.revision !== (value.draftBaseRevision ?? 1)
    )
      throw new IdentityError(409)
    const edit = await createEvent(
        current,
        'metadata',
        photo,
        current.revision,
      ),
      source = draft.packet.statement.descriptor.object_id
    await db.update<Job>(key(id), (latest) => {
      if (!latest.edit) {
        latest.edit = edit
        latest.editSource = source
      }
      return latest
    })
    value = await job(id)
  }
  if (!value?.edit) return
  const edit = value.edit,
    source = value.editSource,
    result = await sendSidecar(id, edit)
  await db.update<Job>(key(id), (latest) => {
    if (latest.edit?.event.id === edit.event.id) {
      const draft = latest.draft
      if (draft && draft.packet.statement.descriptor.object_id === source) {
        delete draft.pending
        latest.cardMetadata = draft
      }
      if (typeof edit.event.expiresAt === 'number')
        latest.expiresAt = Math.min(latest.expiresAt, edit.event.expiresAt)
      delete latest.edit
      delete latest.editSource
      if (draft?.packet.statement.descriptor.object_id === source) {
        delete latest.draft
        delete latest.draftBaseRevision
      } else latest.draftBaseRevision = result.revision
      latest.revision = result.revision
    }
    return latest
  })
}
async function createEvent(
  value: Remote,
  kind: 'metadata' | 'gps' | 'review' | 'response',
  payload: unknown,
  expectedRevision = value.revision,
  reviewState?: string,
): Promise<Sidecar> {
  await ready()
  const prepared = await prepareContext(value.assignmentId ?? undefined),
    prior =
      value.objects[kind]?.packet.statement.descriptor.object_revision ?? 0
  const context: Context = {
    vault_id: value.vaultId,
    asset_id: value.id,
    object_id: crypto.randomUUID(),
    kind,
    object_revision: prior + 1,
    encryption_epoch: prepared.plan.statement.epoch,
  }
  const encrypted = await cryptoCall<EncryptedObject>('encrypt', {
    blob: privateBlob(payload),
    context,
    plan: prepared.plan,
    ownerFingerprint: prepared.ownerFingerprint,
    recipients: recipients(prepared.plan, value.creatorId, kind),
  })
  const statement = {
    ...encrypted.statement,
    accountId: account.value!.id,
    deviceId: prepared.device.certificate.statement.deviceId,
    certificateHash: hash(canonical(prepared.device.certificate)),
    initialHash: hash(canonical(value.submission)),
  }
  const packet: Packet = {
    statement,
    signature: await sign(prepared.device.key, 'object-manifest', statement),
    certificate: prepared.device.certificate,
    plan: prepared.plan,
    envelopes: encrypted.envelopes,
  }
  const event = {
    version: 1,
    id: crypto.randomUUID(),
    photoId: value.id,
    kind,
    parent: hash(canonical(value.submission)),
    expectedRevision,
    packetHash: hash(canonical(packet)),
    ...(reviewState ? { reviewState } : {}),
    ...(['review', 'response'].includes(kind)
      ? { expectedReviewRevision: value.reviewRevision }
      : {}),
    ...(kind === 'response'
      ? { replyTo: hash(canonical(value.objects.review!.packet)) }
      : {}),
    ...(kind === 'metadata' &&
    payload &&
    typeof payload === 'object' &&
    'expiresAt' in payload &&
    typeof payload.expiresAt === 'number'
      ? { expiresAt: Math.min(payload.expiresAt, value.expiresAt) }
      : {}),
  }
  return {
    object: { packet, bytes: await encrypted.blob.arrayBuffer() },
    event,
    signature: await sign(prepared.device.key, 'photo-event', event),
  }
}
async function sendSidecar(id: string, sidecar: Sidecar) {
  const form = new FormData()
  form.set('packet', canonical(sidecar.object.packet))
  form.set('event', canonical(sidecar.event))
  form.set('signature', sidecar.signature)
  form.set(
    'file',
    new Blob([sidecar.object.bytes], { type: 'application/octet-stream' }),
    'ciphertext',
  )
  return request<{ revision: number }>(`/photos/${id}/objects`, 'POST', form)
}
export async function append(
  value: Remote,
  kind: 'metadata' | 'gps' | 'review' | 'response',
  payload: unknown,
  expectedRevision = value.revision,
  reviewState?: string,
) {
  const event = await createEvent(
    value,
    kind,
    payload,
    expectedRevision,
    reviewState,
  )
  const result = await sendSidecar(value.id, event)
  if (kind === 'metadata') {
    delete event.object.pending
    await db.update<Job>(key(value.id), (latest) => {
      if (!latest.received || latest.deleted) return latest
      latest.cardMetadata = event.object
      latest.revision = result.revision
      if (typeof event.event.expiresAt === 'number')
        latest.expiresAt = Math.min(latest.expiresAt, event.event.expiresAt)
      return latest
    })
  }
  memo.delete(value.id)
}

export async function remove(id: string) {
  readGuard()
  const pending = await job(id)
  if (pending && !pending.received) {
    if (
      !pendingGrant(
        pending,
        pending.objects.original!.packet.envelopes.some(
          (e) => e.accountId === account.value!.id,
        ),
      ).delete
    )
      throw new Error('crypto.denied')
    await db.update<Job>(key(id), (value) => {
      value.deleted = true
      delete value.draft
      delete value.edit
      delete value.gps
      for (const object of Object.values(value.objects)) {
        object.bytes = new ArrayBuffer(0)
        delete object.pending
      }
      return value
    })
    if (sending.has(id)) await sending.get(id)!.catch(() => {})
    await finishDeletion(id)
    return
  }
  await request(`/photos/${id}`, 'DELETE')
  await tombstone(id)
  await db.remove(key(id))
  memo.delete(id)
  await (
    await import('./versions')
  ).removeFor({ id, accountId: account.value!.id, encrypted: true } as Photo)
}
async function tombstone(id: string) {
  const name = `revision:${account.value!.id}:${id}`,
    old = await db.get<Record<string, unknown>>(name)
  await db.put(name, { ...old, deleted: true })
  memo.delete(id)
}
async function finishDeletion(id: string) {
  const pending = await job(id)
  if (pending)
    await request(`/pending/${id}`, 'DELETE', {
      vaultId: pending.submission.vaultId,
      assignmentId: pending.submission.assignmentId,
      expiresAt: pending.expiresAt,
    })
  else {
    try {
      await request(`/photos/${id}`, 'DELETE')
    } catch (error) {
      if (
        !(error instanceof IdentityError && [404, 410].includes(error.status))
      )
        throw error
    }
  }
  await tombstone(id)
  await db.remove(key(id))
  memo.delete(id)
  await (
    await import('./versions')
  ).removeFor({ id, accountId: account.value!.id, encrypted: true } as Photo)
}

if (typeof window !== 'undefined')
  window.addEventListener('photobunker-photo-security', () => {
    memo.clear()
  })

export async function rewrapPending(id: string) {
  const { id: owner, generation } = readGuard()
  const currentClock = await request<{ issuedAt: number }>('/clock', 'POST')
  clock(currentClock.issuedAt)
  if (sending.has(id)) await sending.get(id)!.catch(() => {})
  rewrapping.add(id)
  try {
    const value = await job(id)
    if (
      !value ||
      value.received ||
      value.deleted ||
      value.accountId !== owner ||
      value.expiresAt <= now()
    )
      throw new Error('crypto.not_pending')
    const prepared = await prepareContext(value.assignmentId),
      plan = prepared.plan
    if (plan.statement.epoch < value.submission.epoch)
      throw new Error('crypto.rollback')
    if (
      plan.statement.epoch === value.submission.epoch &&
      canonical(prepared.device.certificate) ===
        canonical(value.objects.original!.packet.certificate)
    )
      return
    let gps: Blob | undefined
    if (value.gps?.object.pending) {
      const object = value.gps.object
      gps = await cryptoCall<Blob>('decrypt', {
        packet: object.packet,
        blob: new Blob([object.bytes]),
        expected: { asset_id: id, kind: 'gps' },
        pending: object.pending,
        ownerFingerprint: prepared.ownerFingerprint,
      })
    }
    const lineage = value.submission.initial ?? {
      statement: value.submission,
      signature: value.signature,
      certificate: value.objects.original!.packet.certificate,
    }
    for (const [kind, object] of Object.entries(value.objects)) {
      if (!object.pending) throw new Error('crypto.no_pending_key')
      const wrapped = await cryptoCall<{
        envelopes: Envelope[]
        pending: Envelope
      }>('rewrap', {
        packet: object.packet,
        pending: object.pending,
        plan: prepared.plan,
        ownerFingerprint: prepared.ownerFingerprint,
        recipients: recipients(prepared.plan, owner, kind as ObjectKind),
      })
      const old = object.packet,
        initial = old.initial ?? {
          statement: old.statement,
          signature: old.signature,
          certificate: old.certificate,
          plan: old.plan,
        }
      const statement = {
        ...old.statement,
        recipientEpoch: plan.statement.epoch,
        wrappingRevision: old.statement.wrappingRevision + 1,
        envelopesHash: hash(canonical(wrapped.envelopes)),
        planHash: hash(canonical(plan)),
        accountId: owner,
        deviceId: prepared.device.certificate.statement.deviceId,
        certificateHash: hash(canonical(prepared.device.certificate)),
        initialHash: hash(canonical(initial)),
      }
      object.packet = {
        initial,
        statement,
        signature: await sign(
          prepared.device.key,
          'object-manifest',
          statement,
        ),
        certificate: prepared.device.certificate,
        plan,
        envelopes: wrapped.envelopes,
      }
      object.pending = wrapped.pending
    }
    value.submission = {
      ...value.submission,
      initial: lineage,
      epoch: plan.statement.epoch,
      deviceId: prepared.device.certificate.statement.deviceId,
      planHash: hash(canonical(plan)),
      packetHashes: Object.fromEntries(
        Object.entries(value.objects).map(([kind, o]) => [
          kind,
          hash(canonical(o.packet)),
        ]),
      ),
    }
    value.signature = await sign(
      prepared.device.key,
      'submission',
      value.submission,
    )
    if (gps) {
      const context: Context = {
          vault_id: plan.statement.vaultId,
          asset_id: id,
          object_id: crypto.randomUUID(),
          kind: 'gps',
          object_revision: 1,
          encryption_epoch: plan.statement.epoch,
        },
        object = await encrypt(gps, context, plan, true),
        statement = {
          ...object.packet.statement,
          initialHash: hash(canonical(value.submission)),
        }
      object.packet.statement = statement
      object.packet.signature = await sign(
        prepared.device.key,
        'object-manifest',
        statement,
      )
      const event = {
        version: 1,
        id: crypto.randomUUID(),
        photoId: id,
        kind: 'gps',
        parent: hash(canonical(value.submission)),
        expectedRevision: value.revision,
        packetHash: hash(canonical(object.packet)),
      }
      value.gps = {
        object,
        event,
        signature: await sign(prepared.device.key, 'photo-event', event),
      }
    }
    guard(owner, generation)
    await db.put(key(id), value)
  } finally {
    rewrapping.delete(id)
  }
}

export async function encryptLocal(
  blob: Blob,
  parent: string,
  kind: ObjectKind,
  plan: SignedPlan,
) {
  readGuard()
  return encrypt(
    blob,
    {
      vault_id: plan.statement.vaultId,
      asset_id: parent,
      object_id: crypto.randomUUID(),
      kind,
      object_revision: 1,
      encryption_epoch: plan.statement.epoch,
    },
    plan,
    false,
    true,
  )
}
export const decryptLocal = decrypt

export async function attestMigration(source: MigrationSource, id: string) {
  const { id: owner, generation } = readGuard(),
    value = await remote(id),
    prepared = await cachedContext(value.assignmentId ?? undefined)
  const statement = {
    version: 1,
    source,
    targetId: id,
    submissionHash: hash(canonical(value.submission)),
    method: 'client-readback',
  }
  const signature = await sign(
    prepared.device.key,
    'migration-check',
    statement,
  )
  guard(owner, generation)
  await request(`/migration/${id}/verified`, 'POST', {
    statement: canonical(statement),
    signature,
    certificate: canonical(prepared.device.certificate),
  })
}
export const getMetadata = metadata

const recentCaptures = new Map<string, Photo>()
export function recentCapture(id: string) {
  const value = recentCaptures.get(id)
  return value &&
    value.accountId === account.value?.id &&
    value.createdAt + 120000 > Date.now()
    ? value
    : undefined
}
export async function recordGps(id: string, metadata: Photo['metadata']) {
  const photo = recentCapture(id),
    value = await job(id)
  if (!photo || !value || value.deleted || !metadata)
    throw new Error('crypto.capture_expired')
  const prepared = await cachedContext(value.assignmentId),
    context: Context = {
      vault_id: prepared.plan.statement.vaultId,
      asset_id: id,
      object_id: crypto.randomUUID(),
      kind: 'gps',
      object_revision: 1,
      encryption_epoch: prepared.plan.statement.epoch,
    }
  const encrypted = await encrypt(
      privateBlob(metadata),
      context,
      prepared.plan,
      true,
    ),
    statement = {
      ...encrypted.packet.statement,
      initialHash: hash(canonical(value.submission)),
    }
  encrypted.packet.statement = statement
  encrypted.packet.signature = await sign(
    prepared.device.key,
    'object-manifest',
    statement,
  )
  const event = {
    version: 1,
    id: crypto.randomUUID(),
    photoId: id,
    kind: 'gps',
    parent: hash(canonical(value.submission)),
    expectedRevision: value.revision,
    packetHash: hash(canonical(encrypted.packet)),
  }
  const sidecar = {
    object: encrypted,
    event,
    signature: await sign(prepared.device.key, 'photo-event', event),
  }
  await db.update<Job>(key(id), (current) => {
    if (current.deleted) throw new Error('crypto.capture_expired')
    current.gps = sidecar
    return current
  })
  recentCaptures.set(id, { ...photo, metadata })
  window.dispatchEvent(new Event('photobunker-outbox'))
}
async function sendGps(value: Job) {
  if (!value.gps) return
  const sidecar = value.gps,
    form = new FormData()
  form.set('packet', canonical(sidecar.object.packet))
  form.set('event', canonical(sidecar.event))
  form.set('signature', sidecar.signature)
  form.set(
    'file',
    new Blob([sidecar.object.bytes], { type: 'application/octet-stream' }),
    'ciphertext',
  )
  try {
    const result = await request<{ revision: number }>(
      `/photos/${value.id}/objects`,
      'POST',
      form,
    )
    await db.update<Job>(key(value.id), (current) => {
      const gps = current.gps
      if (gps && gps.event.id === sidecar.event.id) {
        delete gps.object.pending
        current.cardGps = gps.object
        delete current.gps
        if (current.draftBaseRevision === current.revision)
          current.draftBaseRevision = result.revision
        current.revision = result.revision
      }
      return current
    })
  } catch (error) {
    if (error instanceof IdentityError && error.status === 409) {
      const receipt = await request<{
        revision: number
        submissionHash: string
      }>(`/receipts/${value.id}`)
      if (receipt.submissionHash !== hash(canonical(value.submission)))
        throw error
      const prepared = await cachedContext(value.assignmentId),
        current = await job(value.id)
      if (current && current.gps && current.gps.event.id === sidecar.event.id) {
        current.gps.event.expectedRevision = receipt.revision
        current.gps.signature = await sign(
          prepared.device.key,
          'photo-event',
          current.gps.event,
        )
        await db.put(key(value.id), current)
      }
    }
    throw error
  }
}
export async function review(
  id: string,
  state: string,
  comment: string,
  revision: number,
) {
  const value = await remote(id)
  if (value.reviewRevision !== revision) throw new IdentityError(409)
  if (
    !['owner', 'curator'].includes(value.access.role) ||
    !value.access.edit ||
    !value.assignmentId
  )
    throw new Error('crypto.denied')
  if (state !== 'accepted' && !comment.trim())
    throw new Error('crypto.comment_required')
  await append(
    value,
    'review',
    { reviewComment: comment.trim().slice(0, 2000) },
    value.revision,
    state,
  )
}
export async function respond(id: string, comment: string, revision: number) {
  const value = await remote(id)
  if (value.reviewRevision !== revision) throw new IdentityError(409)
  if (
    value.creatorId !== account.value?.id ||
    !['correction', 'reshoot'].includes(value.reviewState ?? '') ||
    !comment.trim() ||
    !value.objects.review
  )
    throw new Error('crypto.denied')
  await append(
    value,
    'response',
    { responseComment: comment.trim().slice(0, 2000) },
    value.revision,
  )
}
async function feedback(
  value: Remote,
): Promise<Pick<Photo, 'reviewComment' | 'responseComment'>> {
  let reviewComment = '',
    responseComment = ''
  if (value.objects.review) {
    const content = JSON.parse(
      await (await remoteObject(value, 'review')).text(),
    )
    reviewComment =
      typeof content.reviewComment === 'string'
        ? content.reviewComment.slice(0, 2000)
        : ''
    if (
      value.objects.response?.event?.replyTo ===
      hash(canonical(value.objects.review.packet))
    ) {
      const response = JSON.parse(
        await (await remoteObject(value, 'response')).text(),
      )
      responseComment =
        typeof response.responseComment === 'string'
          ? response.responseComment.slice(0, 2000)
          : ''
    }
  }
  return { reviewComment, responseComment }
}

export function rememberCaptureMetadata(
  id: string,
  metadata: Photo['metadata'],
) {
  const photo = recentCapture(id)
  if (photo) recentCaptures.set(id, { ...photo, metadata })
}

export async function discardDraft(id: string) {
  if (sending.has(id)) await sending.get(id)!.catch(() => {})
  readGuard()
  await db.update<Job>(key(id), (value) => {
    delete value.draft
    delete value.draftBaseRevision
    delete value.edit
    delete value.editSource
    return value
  })
}

export async function captureSnapshot(value: Remote) {
  const object = value.captureMetadata
  if (!object) throw new Error('crypto.capture_metadata_missing')
  const kind = object.packet.statement.descriptor.kind
  return decodePhoto(
    JSON.parse(
      await (
        await remoteObject(
          { ...value, objects: { ...value.objects, [kind]: object } },
          kind,
        )
      ).text(),
    ),
    value.id,
  )
}
