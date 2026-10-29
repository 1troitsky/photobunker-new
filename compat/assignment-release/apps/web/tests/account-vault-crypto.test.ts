// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
import { createRoot } from '../src/identity/keys'
import { sealRecovery, openRecovery } from '../src/identity/vault-crypto'
import { b64 } from '../src/crypto/protocol'
beforeEach(() => vi.stubGlobal('crypto', webcrypto))
const owner = '11111111-1111-4111-8111-111111111111'
it('recovers independent internal secrets with one account key without exposing them in the envelope', async () => {
  const root = await createRoot(), secrets = {version: 1 as const, photoKey: 'PB4.synthetic-photo-secret', messageKey: 'synthetic-history-secret'}
  const envelope = await sealRecovery(root.kit, owner, 1, secrets)
  expect(JSON.stringify(envelope)).not.toContain('synthetic-photo-secret')
  expect(JSON.stringify(envelope)).not.toContain('synthetic-history-secret')
  expect(await openRecovery(root.kit, owner, envelope)).toEqual(secrets)
  const next = await sealRecovery(root.kit, owner, 1, secrets)
  expect(next.statement.iv).not.toBe(envelope.statement.iv)
})
it('rejects another root, another account, modified ciphertext and a modified revision', async () => {
  const root = await createRoot(), other = await createRoot(), envelope = await sealRecovery(root.kit, owner, 1, {version: 1, photoKey: 'PB4.synthetic'})
  await expect(openRecovery(other.kit, owner, envelope)).rejects.toThrow()
  await expect(openRecovery(root.kit, '22222222-2222-4222-8222-222222222222', envelope)).rejects.toThrow()
  for (const statement of [{...envelope.statement, revision: 2}, {...envelope.statement, ciphertext: b64(new Uint8Array(64))}])
    await expect(openRecovery(root.kit, owner, {...envelope, statement})).rejects.toThrow()
})
