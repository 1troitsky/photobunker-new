// Real libsodium, including multi-frame authenticated encryption. No mocked cipher.
import { beforeAll, describe, expect, it } from 'vitest'
import sodium from 'libsodium-wrappers'
import { Blob as NodeBlob, Buffer } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { encryptObject, decryptObject } from '../src/crypto/codec'
import {
  ready,
  b64,
  canonical,
  hash,
  parseCanonical,
  CHUNK,
  type Context,
  type ObjectStatement,
  type KeyDocument,
} from '../src/crypto/protocol'
import {
  createKeys,
  unlockKeys,
  rotateKeys,
  clearKeys,
} from '../src/crypto/key-material'
beforeAll(async () => {
  Object.defineProperty(globalThis, 'Blob', {
    value: NodeBlob,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  })
  await ready()
})
const context = (): Context => ({
  vault_id: crypto.randomUUID(),
  asset_id: crypto.randomUUID(),
  object_id: crypto.randomUUID(),
  kind: 'original',
  object_revision: 1,
  encryption_epoch: 1,
})
async function fixture(size = 123) {
  const pair = sodium.crypto_box_keypair(),
    accountId = crypto.randomUUID(),
    data = Uint8Array.from({ length: size }, (_, i) => i % 251),
    encrypted = await encryptObject(
      new Blob([data]),
      context(),
      [{ accountId, publicKey: b64(pair.publicKey) }],
      1,
      hash('plan'),
    )
  const statement: ObjectStatement = {
    ...encrypted.statement,
    accountId,
    deviceId: crypto.randomUUID(),
    certificateHash: hash('certificate'),
    initialHash: '',
  }
  return { pair, data, encrypted, statement }
}
describe('photo object authenticated framing', () => {
  for (const size of [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, CHUNK * 2 + 13])
    it(`round-trips ${size} bytes with FINAL`, async () => {
      const f = await fixture(size),
        decoded = await decryptObject(
          f.encrypted.blob,
          f.statement,
          f.encrypted.envelopes[0]!,
          f.pair.publicKey,
          f.pair.privateKey,
        )
      expect(
        Buffer.from(await decoded.arrayBuffer()).equals(Buffer.from(f.data)),
      ).toBe(true)
    })
  it('uses independent keys and reveals no plaintext to another recipient', async () => {
    const f = await fixture(),
      other = sodium.crypto_box_keypair()
    await expect(
      decryptObject(
        f.encrypted.blob,
        f.statement,
        f.encrypted.envelopes[0]!,
        other.publicKey,
        other.privateKey,
      ),
    ).rejects.toThrow()
    const second = await encryptObject(
      new Blob([f.data]),
      f.statement.descriptor,
      [{ accountId: f.statement.accountId, publicKey: b64(f.pair.publicKey) }],
      1,
      hash('plan'),
    )
    expect(second.statement.ciphertextHash).not.toBe(f.statement.ciphertextHash)
  })
  it('rejects truncation, appended bytes, corruption and a changed context', async () => {
    const f = await fixture(CHUNK + 13),
      bytes = new Uint8Array(await f.encrypted.blob.arrayBuffer())
    for (const mutate of [
      () => bytes.slice(0, -1),
      () => Uint8Array.from([...bytes, 0]),
      () => {
        const copy = bytes.slice()
        copy[copy.length - 1] ^= 1
        return copy
      },
    ]) {
      const value = mutate()
      await expect(
        decryptObject(
          new Blob([value]),
          { ...f.statement, ciphertextBytes: String(value.length) },
          f.encrypted.envelopes[0]!,
          f.pair.publicKey,
          f.pair.privateKey,
        ),
      ).rejects.toThrow()
    }
    await expect(
      decryptObject(
        f.encrypted.blob,
        {
          ...f.statement,
          descriptor: {
            ...f.statement.descriptor,
            asset_id: crypto.randomUUID(),
          },
        },
        f.encrypted.envelopes[0]!,
        f.pair.publicKey,
        f.pair.privateKey,
      ),
    ).rejects.toThrow()
  })
  it('rejects swapped envelopes and recipient epochs', async () => {
    const f = await fixture(),
      other = await fixture()
    await expect(
      decryptObject(
        f.encrypted.blob,
        f.statement,
        other.encrypted.envelopes[0]!,
        f.pair.publicKey,
        f.pair.privateKey,
      ),
    ).rejects.toThrow()
    await expect(
      decryptObject(
        f.encrypted.blob,
        { ...f.statement, recipientEpoch: 2 },
        f.encrypted.envelopes[0]!,
        f.pair.publicKey,
        f.pair.privateKey,
      ),
    ).rejects.toThrow()
  })
  it('rejects duplicate, noncanonical and oversized JSON', () => {
    expect(() => parseCanonical('{"a":1,"a":1}')).toThrow()
    expect(() => parseCanonical('{ "a":1}')).toThrow()
    expect(() => parseCanonical(canonical({ a: 'large' }), 2)).toThrow()
  })
})
describe('independent photo recovery', () => {
  it('opens only with the matching PB4 and preserves histories on rotation', () => {
    const f = createKeys(crypto.randomUUID(), 'PB-TEST'),
      document = { record: f.record } as KeyDocument,
      original = f.keys.seeds.recipients[0]
    const opened = unlockKeys(f.kit, f.bundle, document)
    expect(opened.seeds.recipients[0]).toBe(original)
    const rotated = rotateKeys(opened, document)
    expect(opened.revision).toBe(1)
    expect(opened.seeds.recipients).toHaveLength(1)
    expect(rotated.keys.seeds.recipients).toHaveLength(2)
    expect(rotated.keys.seeds.pending[0]).toBe(opened.seeds.pending[0])
    expect(() =>
      unlockKeys(f.kit, rotated.bundle, {
        record: rotated.record,
      } as KeyDocument),
    ).toThrow()
    expect(() =>
      unlockKeys(
        f.kit.slice(0, -1) + (f.kit.endsWith('A') ? 'B' : 'A'),
        f.bundle,
        document,
      ),
    ).toThrow()
    const restored = unlockKeys(rotated.kit, rotated.bundle, {
      record: rotated.record,
    } as KeyDocument)
    expect(restored.seeds.recipients[0]).toBe(original)
    clearKeys(f.keys)
    clearKeys(opened)
    clearKeys(rotated.keys)
    clearKeys(restored)
  })
})

it('decodes the frozen native PHP libsodium object and recovery bundle', async () => {
  const { readFileSync } = await import('node:fs'),
    fixture = JSON.parse(
      readFileSync(
        new URL('./fixtures/photo-object-v1.json', import.meta.url),
        'utf8',
      ),
    )
  const { unb64 } = await import('../src/crypto/protocol'),
    pair = sodium.crypto_box_seed_keypair(unb64(fixture.seed, 32))
  const blob = await decryptObject(
    new Blob([unb64(fixture.ciphertext) as BlobPart]),
    fixture.statement,
    fixture.envelope,
    pair.publicKey,
    pair.privateKey,
  )
  expect(await blob.text()).toBe(fixture.plaintext)
  const keys = unlockKeys(fixture.recovery.kit, fixture.recovery.bundle, {
    record: fixture.recovery.record,
  } as KeyDocument)
  expect(b64(keys.recipients[0]!.publicKey)).toBe(
    fixture.recovery.record.recipientKey,
  )
  clearKeys(keys)
})

it('rejects lone Unicode surrogates before signing canonical records', () => {
  expect(() => canonical({ value: '\ud800' })).toThrow()
  expect(() => parseCanonical('{"value":"\\udc00"}')).toThrow()
  expect(canonical({ value: '📷' })).toBe('{"value":"📷"}')
})
