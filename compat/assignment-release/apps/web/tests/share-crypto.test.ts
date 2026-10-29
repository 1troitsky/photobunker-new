import { beforeAll, expect, it } from 'vitest'
import { webcrypto } from 'node:crypto'
import { Blob as NodeBlob } from 'node:buffer'
import { encryptShare, decryptShare } from '../src/crypto/shares'
import { b64, ready } from '../src/crypto/protocol'
beforeAll(async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'Blob', {
    value: NodeBlob,
    configurable: true,
  })
  await ready()
})
it('roundtrips an isolated export and generates independent keys and IVs', async () => {
  const blob = new Blob(['synthetic JPEG export']),
    a = await encryptShare(blob, 'view', null, Date.now() + 60000),
    b = await encryptShare(blob, 'view', null, Date.now() + 60000)
  expect(await (await decryptShare(a.blob, a.manifest, a.secret)).text()).toBe(
    'synthetic JPEG export',
  )
  expect(a.secret).not.toBe(b.secret)
  expect(a.manifest.iv).not.toBe(b.manifest.iv)
  expect(JSON.stringify(a.manifest)).not.toContain(a.secret)
})
it('authenticates link ID, scope, version and expiry and rejects a wrong key', async () => {
  const a = await encryptShare(
    new Blob(['synthetic pixels']),
    'download',
    null,
    Date.now() + 60000,
  )
  for (const change of [
    { id: crypto.randomUUID() },
    { scope: 'view' as const },
    { versionId: crypto.randomUUID() },
    { expiresAt: a.manifest.expiresAt + 1 },
  ])
    await expect(
      decryptShare(a.blob, { ...a.manifest, ...change }, a.secret),
    ).rejects.toThrow()
  await expect(
    decryptShare(
      a.blob,
      a.manifest,
      b64(crypto.getRandomValues(new Uint8Array(32))),
    ),
  ).rejects.toThrow()
})
it('rejects corruption, truncation, appended bytes and malformed fragment', async () => {
  const a = await encryptShare(
      new Blob(['synthetic pixels']),
      'view',
      null,
      Date.now() + 60000,
    ),
    bytes = new Uint8Array(await a.blob.arrayBuffer())
  bytes[0]! ^= 1
  for (const blob of [
    new Blob([bytes]),
    a.blob.slice(1),
    new Blob([a.blob, 'extra']),
  ])
    await expect(decryptShare(blob, a.manifest, a.secret)).rejects.toThrow()
  await expect(decryptShare(a.blob, a.manifest, 'not-a-key')).rejects.toThrow()
})
it('refuses expired links and empty exports', async () => {
  const a = await encryptShare(
    new Blob(['synthetic']),
    'view',
    null,
    Date.now() + 60000,
  )
  await expect(
    decryptShare(
      a.blob,
      { ...a.manifest, expiresAt: Date.now() - 1 },
      a.secret,
    ),
  ).rejects.toThrow()
  await expect(
    encryptShare(new Blob([]), 'view', null, Date.now() + 60000),
  ).rejects.toThrow()
})
