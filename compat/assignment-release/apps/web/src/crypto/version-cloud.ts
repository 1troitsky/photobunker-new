import type { Photo } from '../local/photos'
import type { PhotoVersion } from '../studio/versions'
import { account } from '../identity/store'
import { photoReadAllowed, prepareContext } from './store'
import { lockGeneration } from './state'
import { request } from './api'
import { remote, encrypt, decryptLocal, sign } from './photos'
import {
  canonical,
  hash,
  ready,
  recipients,
  unb64,
  verifyP256,
  checkPacket,
  type Packet,
} from './protocol'
export type CloudVersion = {
  id: string
  event: {
    version: number
    id: string
    photoId: string
    parent: string
    baseId: string | null
    imageHash: string
    metadataHash: string
  }
  signature: string
  image: Packet
  metadata: Packet
  conflict: boolean
}
export type Upload = {
  row: CloudVersion
  image: ArrayBuffer
  metadata: ArrayBuffer
}
export async function prepare(
  photo: Photo,
  value: PhotoVersion,
): Promise<Upload> {
  const parent = await remote(photo.id),
    context = await prepareContext(parent.assignmentId ?? undefined)
  if (!parent.access.edit) throw new Error('crypto.denied')
  const make = async (
    blob: Blob,
    kind: 'local-version' | 'version-metadata',
  ) => {
    const object = await encrypt(
      blob,
      {
        vault_id: parent.vaultId,
        asset_id: photo.id,
        object_id: crypto.randomUUID(),
        kind,
        object_revision: 1,
        encryption_epoch: context.plan.statement.epoch,
      },
      context.plan,
      false,
      false,
      parent.creatorId,
    )
    object.packet.statement.initialHash = hash(canonical(parent.submission))
    object.packet.signature = await sign(
      context.device.key,
      'object-manifest',
      object.packet.statement,
    )
    return object
  }
  const image = await make(value.blob, 'local-version'),
    metadata = await make(
      new Blob([
        JSON.stringify({
          ...value,
          blob: undefined,
          sync: undefined,
          conflict: undefined,
        }),
      ]),
      'version-metadata',
    )
  const event = {
    version: 1,
    id: value.id,
    photoId: photo.id,
    parent: hash(canonical(parent.submission)),
    baseId: value.baseId ?? null,
    imageHash: hash(canonical(image.packet)),
    metadataHash: hash(canonical(metadata.packet)),
  }
  return {
    row: {
      id: value.id,
      event,
      signature: await sign(context.device.key, 'editor-version', event),
      image: image.packet,
      metadata: metadata.packet,
      conflict: false,
    },
    image: image.bytes,
    metadata: metadata.bytes,
  }
}
export async function publish(photo: Photo, value: Upload) {
  const form = new FormData()
  form.set('event', canonical(value.row.event))
  form.set('signature', value.row.signature)
  form.set(
    'packets',
    canonical({ image: value.row.image, metadata: value.row.metadata }),
  )
  form.set('files[image]', new Blob([value.image]), 'ciphertext')
  form.set('files[metadata]', new Blob([value.metadata]), 'ciphertext')
  return request<{ id: string; conflict: boolean }>(
    `/photos/${photo.id}/versions`,
    'POST',
    form,
  )
}
export async function fetchVersions(photo: Photo, newestOnly = false): Promise<PhotoVersion[]> {
  await ready()
  const owner = account.value?.id,
    generation = lockGeneration.value,
    parent = await remote(photo.id),
    response = await request<{ versions: CloudVersion[] }>(
      `/photos/${photo.id}/versions`,
    ),
    result: PhotoVersion[] = []
  // Server returns versions by ascending immutable ordinal. An export only
  // needs the latest published flattened image; do not decrypt every sibling.
  for (const row of newestOnly ? response.versions.slice(-1) : response.versions) {
    const e = row.event,
      p = row.image,
      member = p.plan.statement.members.find(
        (m) => m.accountId === p.statement.accountId,
      ),
      manage = member?.role === 'owner' || member?.role === 'curator'
    if (
      e.version !== 1 ||
      e.id !== row.id ||
      e.photoId !== photo.id ||
      e.parent !== hash(canonical(parent.submission)) ||
      e.imageHash !== hash(canonical(p)) ||
      e.metadataHash !== hash(canonical(row.metadata)) ||
      !(
        member?.scope === 'all' &&
        (manage ||
          (member?.role === 'contributor' &&
            member.accountId === parent.creatorId &&
            p.plan.statement.changesAllowed))
      )
    )
      throw new Error('crypto.invalid_version')
    await verifyP256(
      'editor-version',
      e,
      row.signature,
      p.certificate.statement.signingKey,
    )
    const open = async (
      packet: Packet,
      kind: 'local-version' | 'version-metadata',
    ) => {
      await checkPacket(packet, {
        asset_id: photo.id,
        vault_id: parent.vaultId,
        kind,
        object_revision: 1,
      })
      const expected = recipients(packet.plan, parent.creatorId, kind).map(
        (r) => ({
          accountId: r.accountId,
          fingerprint: hash(unb64(r.publicKey, 32)),
        }),
      )
      if (
        packet.statement.initialHash !== e.parent ||
        packet.statement.accountId !== p.statement.accountId ||
        canonical(
          packet.envelopes.map(({ accountId, fingerprint }) => ({
            accountId,
            fingerprint,
          })),
        ) !== canonical(expected)
      )
        throw new Error('crypto.invalid_version')
      const blob = await request<Blob>(
        `/photos/${photo.id}/objects/${packet.statement.descriptor.object_id}`,
        'GET',
        undefined,
        'blob',
      )
      return decryptLocal(
        { packet, bytes: await blob.arrayBuffer() },
        { asset_id: photo.id, vault_id: parent.vaultId, kind },
      )
    }
    const meta = JSON.parse(
      await (await open(row.metadata, 'version-metadata')).text(),
    ) as PhotoVersion
    if (
      meta.id !== row.id ||
      meta.parentId !== photo.id ||
      (meta.baseId ?? null) !== e.baseId ||
      !Number.isSafeInteger(meta.width) ||
      !Number.isSafeInteger(meta.height) ||
      meta.width < 1 ||
      meta.height < 1 ||
      meta.width * meta.height > 50_000_000
    )
      throw new Error('crypto.invalid_version')
    const image = await open(p, 'local-version')
    result.push({
      ...meta,
      blob: new Blob([image], { type: 'image/jpeg' }),
      expiresAt: Math.min(meta.expiresAt ?? Infinity, parent.expiresAt),
      sync: 'synced',
      conflict: row.conflict,
    })
  }
  if (
    account.value?.id !== owner ||
    lockGeneration.value !== generation ||
    !photoReadAllowed()
  )
    throw new Error('crypto.locked')
  return result
}
