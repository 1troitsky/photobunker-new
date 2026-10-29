import { account } from '../identity/store'
import { photoReadAllowed, prepareContext } from './store'
import { lockGeneration } from './state'
import { request } from './api'
import { canonical } from './protocol'
import * as encrypted from './photos'
import * as local from '../local/photos'
import * as db from './database'
import { prepare } from '../local/camera'
import { listPhotoVersions, removePhotoVersions } from '../studio/versions'
import * as versions from './versions'
import { accessLibraryId } from '../server/api'
import { refreshLibrary } from '../local/library'
import type { Photo } from '../local/photos'
import type { MigrationSource } from './photos'
export type Candidate = { source: MigrationSource; photo: Photo }
export type Verified = {
  targetId: string
  statement: { source: MigrationSource }
  cleaned: boolean
}
function guard(owner: string | undefined, generation: number) {
  if (
    !owner ||
    owner !== account.value?.id ||
    !photoReadAllowed() ||
    generation !== lockGeneration.value
  )
    throw new Error('crypto.locked')
}
export async function list() {
  const owner = account.value?.id,
    generation = lockGeneration.value
  guard(owner, generation)
  const server = await request<{ sources: Candidate[]; verified: Verified[] }>(
      '/migration',
    ),
    rows: Candidate[] = [...server.sources]
  const ids = new Set(rows.map((r) => r.source.id))
  for (const photo of await local.listPhotos()) {
    if (
      ids.has(photo.id) ||
      photo.encrypted ||
      photo.deleteRequested ||
      photo.uiVersionOf ||
      photo.uploadOnly ||
      photo.deliveryOnly ||
      (photo.expiresAt !== undefined && photo.expiresAt <= Date.now()) ||
      (photo.accountId && photo.accountId !== owner) ||
      (photo.remoteLibraryId &&
        photo.remoteLibraryId !== accessLibraryId.value &&
        photo.accountId !== owner)
    )
      continue
    if (photo.access && photo.access.role !== 'owner') continue
    rows.push({
      photo,
      source: {
        kind: 'local',
        id: photo.id,
        revision: photo.remoteRevision ?? 1,
        reviewRevision: photo.reviewRevision ?? 1,
        libraryId: null,
      },
    })
  }
  guard(owner, generation)
  return { sources: rows, verified: server.verified }
}
async function original(candidate: Candidate) {
  return candidate.source.kind === 'local'
    ? (await local.readPhoto(candidate.source.id, true)).blob
    : request<Blob>(
        '/migration/content',
        'POST',
        { source: canonical(candidate.source), kind: 'original' },
        'blob',
      )
}
function equal(left: ArrayBuffer, right: ArrayBuffer) {
  const a = new Uint8Array(left),
    b = new Uint8Array(right)
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}
export async function copy(candidate: Candidate) {
  const owner = account.value?.id,
    generation = lockGeneration.value
  guard(owner, generation)
  const target = await request<{
    id: string
    committed: boolean
    assignmentId: string | null
    expiresAt: number | null
  }>('/migration/target', 'POST', { source: canonical(candidate.source) })
  const sourceBlob = await original(candidate)
  guard(owner, generation)
  if (!target.committed) {
    await prepareContext(target.assignmentId ?? undefined)
    const existing = await encrypted.job(target.id)
    if (!existing) {
      const capture = await prepare(
        new Blob([sourceBlob], { type: candidate.photo.mime }),
        candidate.photo.method,
      )
      const photo: Photo = {
        ...candidate.photo,
        id: target.id,
        legacyImported: true,
        accountId: owner,
        workspaceAssignmentId: target.assignmentId ?? undefined,
        uiAssignmentId: target.assignmentId ?? undefined,
        remoteRevision: undefined,
        remoteLibraryId: undefined,
        uploadRequested: true,
        expiresAt: Math.min(
          candidate.photo.expiresAt ?? Infinity,
          target.expiresAt ?? Infinity,
          Date.now() + 1209600000,
        ),
        retentionSeconds: 1209600,
        captureContext: candidate.photo.captureContext ?? {
          presetName: candidate.photo.profile?.name ?? 'Standard',
          standard: !candidate.photo.profile,
          author: { kind: 'unknown' },
        },
      }
      await encrypted.save(photo, capture, candidate.source)
    }
    await encrypted.upload(target.id)
  }
  const restored = await encrypted.read(target.id)
  if (!equal(await sourceBlob.arrayBuffer(), await restored.blob.arrayBuffer()))
    throw new Error('crypto.migration_bytes')
  const snapshot = await encrypted.captureSnapshot(
    await encrypted.remote(target.id),
  )
  // Compare all supplied private fields, not only the image. Re-read the old
  // source after verification to detect edits before enabling cleanup.
  for (const field of [
    'title',
    'note',
    'favorite',
    'category',
    'shot',
    'tags',
    'metadata',
    'profile',
    'captureContext',
  ] as const) {
    if (
      candidate.photo[field] !== undefined &&
      canonical(candidate.photo[field]) !== canonical(snapshot[field])
    )
      throw new Error('crypto.migration_metadata')
  }
  const previousVersions = await listPhotoVersions(candidate.photo)
  let copiedVersions = await versions.list(restored.photo)
  for (const version of previousVersions) {
    if (!copiedVersions.some((v) => v.id === version.id)) {
      await versions.save(
        restored.photo,
        version.blob,
        version.width,
        version.height,
        version.edits,
        version.id,
        version.createdAt,
      )
      copiedVersions = await versions.list(restored.photo)
    }
    const result = copiedVersions.find((v) => v.id === version.id)
    if (
      !result ||
      result.width !== version.width ||
      result.height !== version.height ||
      result.createdAt !== version.createdAt ||
      canonical(result.edits) !== canonical(version.edits) ||
      !equal(await result.blob.arrayBuffer(), await version.blob.arrayBuffer())
    )
      throw new Error('crypto.migration_version')
  }
  if (candidate.source.kind === 'local') {
    const current = await local.readMetadata(candidate.source.id)
    if (!current || canonical(current) !== canonical(candidate.photo))
      throw new Error('crypto.migration_changed')
    await db.put(`migration:${owner}:${target.id}`, {
      source: candidate.source,
      targetId: target.id,
    })
  } else {
    const current = (
      await request<{ sources: Candidate[] }>('/migration')
    ).sources.find(
      (r) =>
        r.source.kind === candidate.source.kind &&
        r.source.id === candidate.source.id,
    )
    if (!current || canonical(current) !== canonical(candidate))
      throw new Error('crypto.migration_changed')
  }
  guard(owner, generation)
  await encrypted.attestMigration(candidate.source, target.id)
  await refreshLibrary()
  return target.id
}
export async function cleanup(verified: Verified) {
  const owner = account.value?.id,
    generation = lockGeneration.value
  guard(owner, generation)
  const s = verified.statement.source
  if (s.kind !== 'local') {
    const current = (await list()).sources.find(
      (r) => r.source.kind === s.kind && r.source.id === s.id,
    )
    if (!current || canonical(current.source) !== canonical(s))
      throw new Error('crypto.migration_changed')
    await copy(current)
    const result = await request<{ deletion: string }>(
      `/migration/${verified.targetId}`,
      'DELETE',
      { confirmed: true },
    )
    if (result.deletion !== 'verified')
      throw new Error('crypto.cleanup_pending')
    return
  }
  const candidate = (await list()).sources.find(
    (r) => r.source.kind === 'local' && r.source.id === s.id,
  )
  if (!candidate) {
    await db.remove(`migration:${owner}:${verified.targetId}`)
    await request(`/migration/${verified.targetId}`, 'DELETE', {
      confirmed: true,
    })
    return
  }
  await copy(candidate)
  guard(owner, generation)
  await removePhotoVersions(candidate.photo)
  await local.deletePhoto(s.id)
  await db.remove(`migration:${owner}:${verified.targetId}`)
  await request(`/migration/${verified.targetId}`, 'DELETE', {
    confirmed: true,
  })
}
