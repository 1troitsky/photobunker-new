import sodium from 'libsodium-wrappers'
import {
  b64,
  unb64,
  canonical,
  hash,
  fail,
  utf8,
  text,
  CHUNK,
  MAX_OBJECT,
  SUITE,
  validateDescriptor,
  parseCanonical,
  type Context,
  type Descriptor,
  type Envelope,
  type Recipient,
  type EncryptedObject,
  type ObjectStatement,
} from './protocol'
const magic = utf8.encode('PBOBJ001')
function u32(value: number) {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value)
  return bytes
}
function join(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
  let offset = 0
  for (const p of parts) {
    result.set(p, offset)
    offset += p.length
  }
  return result
}
function aad(descriptorHash: string, index: number, size: number) {
  return join(
    utf8.encode('photobunker/object/v1\0'),
    unb64(descriptorHash, 32),
    u32(index),
    u32(size),
  )
}
function seal(
  key: Uint8Array,
  descriptor: Descriptor,
  descriptorHash: string,
  recipient: Recipient,
  epoch: number,
): Envelope {
  const fingerprint = hash(unb64(recipient.publicKey, 32))
  const payload = canonical({
    version: 1,
    key: b64(key),
    descriptorHash,
    context: descriptor,
    recipient: fingerprint,
    recipientEpoch: epoch,
  })
  return {
    accountId: recipient.accountId,
    fingerprint,
    sealed: b64(
      sodium.crypto_box_seal(
        utf8.encode(payload),
        unb64(recipient.publicKey, 32),
      ),
    ),
  }
}
export async function encryptObject(
  blob: Blob,
  context: Context,
  recipients: Recipient[],
  epoch: number,
  planHash: string,
  pending?: Recipient,
): Promise<EncryptedObject> {
  const descriptor: Descriptor = {
    ...context,
    format: 'pb-object',
    version: 1,
    suite: SUITE,
    chunk_bytes: CHUNK,
    plaintext_bytes: String(blob.size),
    frame_count: Math.max(1, Math.ceil(blob.size / CHUNK)),
  }
  validateDescriptor(descriptor)
  const descriptorBytes = utf8.encode(canonical(descriptor)),
    descriptorHash = hash(descriptorBytes),
    key = sodium.crypto_secretstream_xchacha20poly1305_keygen()
  const stream = sodium.crypto_secretstream_xchacha20poly1305_init_push(key),
    parts: Uint8Array[] = [],
    digest = sodium.crypto_generichash_init(null, 32)
  const append = (bytes: Uint8Array) => {
    parts.push(bytes)
    sodium.crypto_generichash_update(digest, bytes)
  }
  try {
    append(
      join(magic, u32(descriptorBytes.length), descriptorBytes, stream.header),
    )
    for (let index = 0; index < descriptor.frame_count; index++) {
      const clear = new Uint8Array(
        await blob
          .slice(index * CHUNK, Math.min(blob.size, (index + 1) * CHUNK))
          .arrayBuffer(),
      )
      try {
        const encrypted = sodium.crypto_secretstream_xchacha20poly1305_push(
          stream.state,
          clear,
          aad(descriptorHash, index, clear.length),
          index === descriptor.frame_count - 1
            ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
            : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE,
        )
        append(u32(encrypted.length))
        append(encrypted)
      } finally {
        sodium.memzero(clear)
      }
    }
    const envelopes = recipients.map((recipient) =>
        seal(key, descriptor, descriptorHash, recipient, epoch),
      ),
      ciphertext = new Blob(parts as BlobPart[], {
        type: 'application/octet-stream',
      })
    return {
      blob: ciphertext,
      envelopes,
      pending: pending
        ? seal(key, descriptor, descriptorHash, pending, epoch)
        : undefined,
      statement: {
        version: 1,
        descriptor,
        descriptorHash,
        ciphertextHash: b64(sodium.crypto_generichash_final(digest, 32)),
        ciphertextBytes: String(ciphertext.size),
        recipientEpoch: epoch,
        wrappingRevision: 1,
        envelopesHash: hash(canonical(envelopes)),
        planHash,
      },
    }
  } finally {
    sodium.memzero(key)
  }
}
function openKey(
  envelope: Envelope,
  statement: Pick<
    ObjectStatement,
    'descriptor' | 'descriptorHash' | 'recipientEpoch'
  >,
  publicKey: Uint8Array,
  privateKey: Uint8Array,
) {
  if (envelope.fingerprint !== hash(publicKey)) return fail()
  const opened = sodium.crypto_box_seal_open(
    unb64(envelope.sealed),
    publicKey,
    privateKey,
  )
  if (!opened) return fail()
  try {
    const value = parseCanonical<{
      version: number
      key: string
      descriptorHash: string
      context: Descriptor
      recipient: string
      recipientEpoch: number
    }>(text.decode(opened), 65536)
    if (
      value.version !== 1 ||
      value.descriptorHash !== statement.descriptorHash ||
      canonical(value.context) !== canonical(statement.descriptor) ||
      value.recipient !== envelope.fingerprint ||
      value.recipientEpoch !== statement.recipientEpoch
    )
      return fail()
    return unb64(value.key, 32)
  } finally {
    sodium.memzero(opened)
  }
}
export function rewrap(
  statement: ObjectStatement,
  envelope: Envelope,
  publicKey: Uint8Array,
  privateKey: Uint8Array,
  recipients: Recipient[],
  epoch: number,
  pending?: Recipient,
) {
  const key = openKey(envelope, statement, publicKey, privateKey)
  try {
    return {
      envelopes: recipients.map((recipient) =>
        seal(
          key,
          statement.descriptor,
          statement.descriptorHash,
          recipient,
          epoch,
        ),
      ),
      pending: pending
        ? seal(
            key,
            statement.descriptor,
            statement.descriptorHash,
            pending,
            epoch,
          )
        : undefined,
    }
  } finally {
    sodium.memzero(key)
  }
}
export async function decryptObject(
  blob: Blob,
  statement: ObjectStatement,
  envelope: Envelope,
  publicKey: Uint8Array,
  privateKey: Uint8Array,
): Promise<Blob> {
  validateDescriptor(statement.descriptor)
  if (
    blob.size !== Number(statement.ciphertextBytes) ||
    blob.size > MAX_OBJECT + 65536 ||
    statement.descriptorHash !== hash(canonical(statement.descriptor))
  )
    return fail()
  const key = openKey(envelope, statement, publicKey, privateKey),
    digest = sodium.crypto_generichash_init(null, 32),
    parts: Uint8Array[] = []
  let offset = 0,
    total = 0
  const read = async (size: number) => {
    if (size < 0 || offset + size > blob.size) return fail()
    const bytes = new Uint8Array(
      await blob.slice(offset, offset + size).arrayBuffer(),
    )
    offset += size
    sodium.crypto_generichash_update(digest, bytes)
    return bytes
  }
  try {
    const prefix = await read(12)
    if (!sodium.memcmp(prefix.slice(0, 8), magic)) return fail()
    const length = new DataView(
      prefix.buffer,
      prefix.byteOffset + 8,
      4,
    ).getUint32(0)
    if (length > 65536) return fail()
    const descriptor = parseCanonical<Descriptor>(
      text.decode(await read(length)),
      65536,
    )
    if (canonical(descriptor) !== canonical(statement.descriptor)) return fail()
    const header = await read(
        sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES,
      ),
      stream = sodium.crypto_secretstream_xchacha20poly1305_init_pull(
        header,
        key,
      )
    for (let index = 0; index < descriptor.frame_count; index++) {
      const frameLength = new DataView((await read(4)).buffer).getUint32(0),
        plainLength = Math.min(
          CHUNK,
          Number(descriptor.plaintext_bytes) - total,
        )
      if (
        frameLength !==
        plainLength + sodium.crypto_secretstream_xchacha20poly1305_ABYTES
      )
        return fail()
      const result = sodium.crypto_secretstream_xchacha20poly1305_pull(
        stream,
        await read(frameLength),
        aad(statement.descriptorHash, index, plainLength),
      )
      if (
        !result ||
        result.tag !==
          (index === descriptor.frame_count - 1
            ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
            : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE) ||
        result.message.length !== plainLength
      )
        return fail()
      parts.push(result.message)
      total += plainLength
    }
    if (
      offset !== blob.size ||
      total !== Number(descriptor.plaintext_bytes) ||
      b64(sodium.crypto_generichash_final(digest, 32)) !==
        statement.ciphertextHash
    )
      return fail()
    return new Blob(parts as BlobPart[])
  } finally {
    sodium.memzero(key)
    for (const part of parts) sodium.memzero(part)
  }
}
