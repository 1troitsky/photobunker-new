import sodium from 'libsodium-wrappers'
import {
  b64,
  unb64,
  canonical,
  hash,
  signed,
  fail,
  utf8,
  text,
  type KeyDocument,
  type KeyRecord,
} from './protocol'
export type SodiumPair = {
  publicKey: Uint8Array
  privateKey: Uint8Array
  keyType: string
}
export type Seeds = {
  authority: string
  read: string
  pending: string[]
  recipients: string[]
}
export type RecoveryBundle = {
  version: 1
  accountId: string
  recoveryId: string
  revision: number
  fingerprint: string
  nonce: string
  ciphertext: string
}
export type OpenKeys = {
  accountId: string
  publicId: string
  recoveryId: string
  revision: number
  secret: Uint8Array
  seeds: Seeds
  authority: SodiumPair
  read: SodiumPair
  pending: SodiumPair[]
  recipients: SodiumPair[]
}
function keyPair(
  seeds: Seeds,
  accountId: string,
  publicId: string,
  recoveryId: string,
  revision: number,
  secret: Uint8Array,
): OpenKeys {
  return {
    accountId,
    publicId,
    recoveryId,
    revision,
    secret,
    seeds,
    authority: sodium.crypto_sign_seed_keypair(unb64(seeds.authority, 32)),
    read: sodium.crypto_sign_seed_keypair(unb64(seeds.read, 32)),
    pending: seeds.pending.map((seed) =>
      sodium.crypto_box_seed_keypair(unb64(seed, 32)),
    ),
    recipients: seeds.recipients.map((seed) =>
      sodium.crypto_box_seed_keypair(unb64(seed, 32)),
    ),
  }
}
const bundleAAD = (
  bundle: Pick<
    RecoveryBundle,
    'version' | 'accountId' | 'recoveryId' | 'revision' | 'fingerprint'
  >,
) => utf8.encode(`photobunker/recovery/v1\0${canonical(bundle)}`)
function wrap(keys: OpenKeys): RecoveryBundle {
  const descriptor = {
      version: 1 as const,
      accountId: keys.accountId,
      recoveryId: keys.recoveryId,
      revision: keys.revision,
      fingerprint: hash(keys.authority.publicKey),
    },
    nonce = sodium.randombytes_buf(24),
    kek = sodium.crypto_kdf_derive_from_key(32, 1, 'PBRecov1', keys.secret),
    clear = utf8.encode(
      canonical({ seeds: keys.seeds, publicId: keys.publicId }),
    )
  try {
    return {
      ...descriptor,
      nonce: b64(nonce),
      ciphertext: b64(
        sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
          clear,
          bundleAAD(descriptor),
          null,
          nonce,
          kek,
        ),
      ),
    }
  } finally {
    sodium.memzero(kek)
    sodium.memzero(clear)
  }
}
export function kitFor(keys: OpenKeys) {
  return `PB4.${keys.accountId}.${keys.recoveryId}.${hash(keys.authority.publicKey)}.${b64(keys.secret)}`
}
export function createKeys(accountId: string, publicId: string) {
  const seeds: Seeds = {
    authority: b64(sodium.randombytes_buf(32)),
    read: b64(sodium.randombytes_buf(32)),
    pending: [b64(sodium.randombytes_buf(32))],
    recipients: [b64(sodium.randombytes_buf(32))],
  }
  const keys = keyPair(
      seeds,
      accountId,
      publicId,
      crypto.randomUUID(),
      1,
      sodium.randombytes_buf(32),
    ),
    bundle = wrap(keys)
  const record: KeyRecord = {
    version: 1,
    accountId,
    publicId,
    authorityKey: b64(keys.authority.publicKey),
    recipientKey: b64(keys.recipients[0]!.publicKey),
    pendingKey: b64(keys.pending.at(-1)!.publicKey),
    readKey: b64(keys.read.publicKey),
    revision: 1,
    previousHash: '',
    recoveryId: keys.recoveryId,
    bundleHash: hash(canonical(bundle)),
  }
  return {
    keys,
    bundle,
    record,
    signature: signed('photo-key', record, keys.authority.privateKey),
    kit: kitFor(keys),
  }
}
export function unlockKeys(
  kit: string,
  bundle: RecoveryBundle,
  doc: KeyDocument,
): OpenKeys {
  const parts = kit.trim().split('.')
  if (
    parts.length !== 5 ||
    parts[0] !== 'PB4' ||
    parts[1] !== bundle.accountId ||
    parts[2] !== bundle.recoveryId ||
    parts[3] !== bundle.fingerprint ||
    bundle.fingerprint !== hash(unb64(doc.record.authorityKey, 32)) ||
    doc.record.bundleHash !== hash(canonical(bundle)) ||
    doc.record.recoveryId !== bundle.recoveryId ||
    doc.record.accountId !== bundle.accountId ||
    bundle.revision !== doc.record.revision
  )
    return fail()
  const secret = unb64(parts[4]!, 32),
    kek = sodium.crypto_kdf_derive_from_key(32, 1, 'PBRecov1', secret),
    { nonce, ciphertext, ...descriptor } = bundle
  let clear: Uint8Array | undefined
  try {
    clear = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      unb64(ciphertext),
      bundleAAD(descriptor),
      unb64(nonce, 24),
      kek,
    )
    if (!clear) return fail()
    const data = JSON.parse(text.decode(clear)) as {
      seeds: Seeds
      publicId: string
    }
    if (
      !data.seeds ||
      !Array.isArray(data.seeds.pending) ||
      !Array.isArray(data.seeds.recipients) ||
      !data.seeds.pending.length ||
      !data.seeds.recipients.length ||
      data.seeds.pending.length > 100 ||
      data.seeds.recipients.length > 100 ||
      data.publicId !== doc.record.publicId
    )
      return fail()
    const keys = keyPair(
      data.seeds,
      bundle.accountId,
      data.publicId,
      bundle.recoveryId,
      bundle.revision,
      secret,
    )
    if (
      b64(keys.authority.publicKey) !== doc.record.authorityKey ||
      b64(keys.read.publicKey) !== doc.record.readKey ||
      b64(keys.pending.at(-1)!.publicKey) !== doc.record.pendingKey ||
      b64(keys.recipients.at(-1)!.publicKey) !== doc.record.recipientKey
    )
      return fail()
    return keys
  } catch {
    sodium.memzero(secret)
    return fail()
  } finally {
    sodium.memzero(kek)
    if (clear) sodium.memzero(clear)
  }
}
export function rotateKeys(keys: OpenKeys, doc: KeyDocument) {
  if (keys.revision !== doc.record.revision) return fail()
  const seeds: Seeds = {
    ...keys.seeds,
    recipients: [...keys.seeds.recipients, b64(sodium.randombytes_buf(32))],
    pending: [...keys.seeds.pending, b64(sodium.randombytes_buf(32))],
    read: b64(sodium.randombytes_buf(32)),
  }
  if (seeds.recipients.length > 100 || seeds.pending.length > 100) return fail()
  const rotated = keyPair(
      seeds,
      keys.accountId,
      keys.publicId,
      crypto.randomUUID(),
      keys.revision + 1,
      sodium.randombytes_buf(32),
    ),
    bundle = wrap(rotated)
  const record: KeyRecord = {
    ...doc.record,
    revision: rotated.revision,
    previousHash: hash(canonical(doc)),
    recipientKey: b64(rotated.recipients.at(-1)!.publicKey),
    readKey: b64(rotated.read.publicKey),
    pendingKey: b64(rotated.pending.at(-1)!.publicKey),
    recoveryId: rotated.recoveryId,
    bundleHash: hash(canonical(bundle)),
  }
  return {
    keys: rotated,
    bundle,
    record,
    signature: signed('photo-key', record, rotated.authority.privateKey),
    kit: kitFor(rotated),
  }
}
export function clearKeys(keys: OpenKeys | undefined) {
  if (!keys) return
  sodium.memzero(keys.secret)
  for (const key of [
    keys.authority,
    keys.read,
    ...keys.pending,
    ...keys.recipients,
  ])
    sodium.memzero(key.privateKey)
  keys.seeds = { authority: '', read: '', pending: [], recipients: [] }
}
