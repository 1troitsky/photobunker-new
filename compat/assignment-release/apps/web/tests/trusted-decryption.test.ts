import { expect, it, vi } from 'vitest'
import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk'
import { retrySignedEvent } from '../src/messages/trusted-decryption'
function fixture(signed = true, reason = 'UNSIGNED_SENDER_DEVICE') {
  const attempt = vi.fn().mockResolvedValue(undefined), status = vi.fn().mockResolvedValue({ signedByOwner: signed })
  const crypto = { getDeviceVerificationStatus: status }
  const client = { getCrypto: () => crypto } as unknown as MatrixClient
  const event = { decryptionFailureReason: reason, isBeingDecrypted: () => false, getSender: () => '@qa:local', getWireContent: () => ({ device_id: 'QA' }), isRedacted: () => false, isDecryptionFailure: () => true, attemptDecryption: attempt } as unknown as MatrixEvent
  return { client, event, attempt, status, crypto }
}
it('retries using SDK crypto only after a valid owner signature arrives', async () => {
  const f = fixture(); await retrySignedEvent(f.client, f.event, () => {})
  expect(f.attempt).toHaveBeenCalledExactlyOnceWith(f.crypto, { isRetry: true })
})
it('never retries unsigned devices, identity changes, redactions or stale accounts', async () => {
  const unsigned = fixture(false); await retrySignedEvent(unsigned.client, unsigned.event, () => {}); expect(unsigned.attempt).not.toHaveBeenCalled()
  const changed = fixture(true, 'SENDER_IDENTITY_PREVIOUSLY_VERIFIED'); await retrySignedEvent(changed.client, changed.event, () => {}); expect(changed.status).not.toHaveBeenCalled()
  const redacted = fixture(); redacted.event.isRedacted = () => true; await retrySignedEvent(redacted.client, redacted.event, () => {}); expect(redacted.attempt).not.toHaveBeenCalled()
  const stale = fixture(); await expect(retrySignedEvent(stale.client, stale.event, () => { throw new Error('cancelled') })).rejects.toThrow('cancelled'); expect(stale.attempt).not.toHaveBeenCalled()
})
