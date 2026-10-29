import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk'
import type { CryptoBackend } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend'
const pending = new WeakSet<MatrixEvent>()
// SDK drops these failures from its room-key retry queue. A later device-list
// update can supply the missing signature. Keep the SDK's isolation policy.
export async function retrySignedEvent(client: MatrixClient, event: MatrixEvent, assertCurrent: () => void) {
  if (!['UNSIGNED_SENDER_DEVICE', 'UNKNOWN_SENDER_DEVICE'].includes(event.decryptionFailureReason || '') || event.isBeingDecrypted() || pending.has(event)) return
  pending.add(event)
  try {
    const sender = event.getSender(), device = event.getWireContent().device_id
    if (!sender || typeof device !== 'string') return
    const trust = await client.getCrypto()!.getDeviceVerificationStatus(sender, device)
    assertCurrent()
    if (!trust?.signedByOwner || event.isRedacted() || !event.isDecryptionFailure()) return
    await event.attemptDecryption(client.getCrypto()! as CryptoBackend, { isRetry: true })
  } finally { pending.delete(event) }
}
