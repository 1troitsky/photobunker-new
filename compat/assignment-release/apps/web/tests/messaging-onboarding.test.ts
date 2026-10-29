import { describe, expect, it, vi } from 'vitest'
import type { MatrixClient } from 'matrix-js-sdk'
import { canUseMessagingDevice, initializeMessagingIdentity } from '../src/messages/onboarding'
function fixture(published: boolean, local: boolean) {
  const crypto = {
    userHasCrossSigningKeys: vi.fn(async () => published),
    getCrossSigningStatus: vi.fn(async () => ({ privateKeysCachedLocally: {
      masterKey: local, selfSigningKey: local, userSigningKey: local,
    } })),
    bootstrapCrossSigning: vi.fn(async () => {}),
  }
  return { crypto, client: { getCrypto: () => crypto } as unknown as MatrixClient }
}
describe('first-message setup', () => {
  it('requires an owner signature and verified signing identity, independent of private backup keys', () => {
    expect(canUseMessagingDevice({ signedByOwner: true, crossSigningVerified: true })).toBe(true)
    expect(canUseMessagingDevice({ signedByOwner: false, crossSigningVerified: true })).toBe(false)
    expect(canUseMessagingDevice({ signedByOwner: true, crossSigningVerified: false })).toBe(false)
    expect(canUseMessagingDevice(null)).toBe(false)
  })
  it('initializes a new identity with the SDK without requiring history backup', async () => {
    const { client, crypto } = fixture(false, false)
    expect(await initializeMessagingIdentity(client, () => {})).toBe(true)
    expect(crypto.bootstrapCrossSigning).toHaveBeenCalledOnce()
    expect(crypto.bootstrapCrossSigning.mock.calls[0]).not.toContainEqual(expect.objectContaining({ setupNewCrossSigning: true }))
  })
  it('leaves an established identity unchanged on a device without its private keys', async () => {
    const { client, crypto } = fixture(true, false)
    expect(await initializeMessagingIdentity(client, () => {})).toBe(false)
    expect(crypto.bootstrapCrossSigning).not.toHaveBeenCalled()
  })
  it('reuses a trusted device without prompting for secret-storage credentials', async () => {
    const { client, crypto } = fixture(true, true)
    expect(await initializeMessagingIdentity(client, () => {})).toBe(true)
    expect(crypto.bootstrapCrossSigning).not.toHaveBeenCalled()
  })
  it('stops first-use setup when the account changes during the server lookup', async () => {
    const { client, crypto } = fixture(false, false)
    await expect(initializeMessagingIdentity(client, () => { throw new Error('cancelled') })).rejects.toThrow('cancelled')
    expect(crypto.bootstrapCrossSigning).not.toHaveBeenCalled()
  })
})
