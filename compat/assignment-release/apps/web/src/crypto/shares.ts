import { b64, unb64, canonical, hash, ready, uuid, utf8 } from './protocol'
export type ShareManifest = {
  version: 1
  id: string
  scope: 'view' | 'download'
  versionId: string | null
  expiresAt: number
  iv: string
  ciphertextHash: string
  ciphertextBytes: number
}
export type ShareInfo = {
  id: string
  scope: 'view' | 'download'
  versionId: string | null
  expiresAt: number
  revoked: boolean
}
const aad = (m: ShareManifest) =>
  utf8.encode(
    'photobunker/share/v1\0' +
      canonical({
        version: m.version,
        id: m.id,
        scope: m.scope,
        versionId: m.versionId,
        expiresAt: m.expiresAt,
      }),
  )
export async function encryptShare(
  blob: Blob,
  scope: ShareManifest['scope'],
  versionId: string | null,
  expiresAt: number,
) {
  await ready()
  if (
    !blob.size ||
    blob.size > 64 * 1024 * 1024 ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Date.now()
  )
    throw new Error('share.invalid')
  const raw = crypto.getRandomValues(new Uint8Array(32)),
    iv = crypto.getRandomValues(new Uint8Array(12)),
    secret = b64(raw)
  try {
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [
        'encrypt',
      ]),
      manifest: ShareManifest = {
        version: 1,
        id: crypto.randomUUID(),
        scope,
        versionId,
        expiresAt,
        iv: b64(iv),
        ciphertextHash: '',
        ciphertextBytes: 0,
      }
    const clear = new Uint8Array(await blob.arrayBuffer())
    try {
      const bytes = new Uint8Array(
        await crypto.subtle.encrypt(
          {
            name: 'AES-GCM',
            iv,
            additionalData: aad(manifest) as Uint8Array<ArrayBuffer>,
            tagLength: 128,
          },
          key,
          clear,
        ),
      )
      manifest.ciphertextHash = hash(bytes)
      manifest.ciphertextBytes = bytes.length
      return { manifest, secret, blob: new Blob([bytes]) }
    } finally {
      clear.fill(0)
    }
  } finally {
    raw.fill(0)
  }
}
export async function decryptShare(
  blob: Blob,
  m: ShareManifest,
  secret: string,
) {
  await ready()
  if (
    m.version !== 1 ||
    !uuid(m.id) ||
    !['view', 'download'].includes(m.scope) ||
    (m.versionId !== null && !uuid(m.versionId)) ||
    !Number.isSafeInteger(m.expiresAt) ||
    m.expiresAt <= Date.now() ||
    blob.size !== m.ciphertextBytes ||
    blob.size > 64 * 1024 * 1024 + 16
  )
    throw new Error('share.invalid')
  const raw = unb64(secret, 32),
    bytes = new Uint8Array(await blob.arrayBuffer())
  try {
    if (hash(bytes) !== m.ciphertextHash) throw new Error('share.invalid')
    const key = await crypto.subtle.importKey(
        'raw',
        raw as Uint8Array<ArrayBuffer>,
        'AES-GCM',
        false,
        ['decrypt'],
      ),
      clear = new Uint8Array(
        await crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: unb64(m.iv, 12) as Uint8Array<ArrayBuffer>,
            additionalData: aad(m) as Uint8Array<ArrayBuffer>,
            tagLength: 128,
          },
          key,
          bytes,
        ),
      )
    try {
      return new Blob([clear], { type: 'image/jpeg' })
    } finally {
      clear.fill(0)
    }
  } finally {
    raw.fill(0)
  }
}
