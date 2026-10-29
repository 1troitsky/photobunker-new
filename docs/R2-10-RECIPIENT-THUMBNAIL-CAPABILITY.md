# Assignment photo recipient thumbnail capability (server stage)

Status: **implemented behind disabled-by-default server flag**, not Verified, not Released. No server deployment or migration performed.

- Owner uses a *device-signed* canonical statement to publish a single AES-GCM-wrapped thumbnail DEK for a specific accepted grant generation/recipient/assignment/photo/asset/revision/TTL/cipher digest.
- Server validates accepted assignment grant, owner photo ownership, frozen capture binding, active thumbnail/expiry and immutable idempotent operation; stores ciphertext-only recipient key envelope and signer public key in `photo_recipient_keys_v1`.
- A separate recipient endpoint rechecks accepted grant, current contacts/block state, owner readiness, assignment, active photo, frozen binding, active thumbnail, generation and signed key manifest. Explicitly refuses unshared assets, originals and metadata. Every preexisting owner PhotoSync route remains owner-only.
- `photo_sync.recipient_thumbnail_reads_enabled` is **hardcoded false** pending exhaustive PHPUnit/Playwright/crypto/safety review. Endpoint returns 404 to recipients until independent verification and deliberate enablement. Stored signed keys alone confer no read access.
- Future client steps: owner re-wrap current thumbnail DEK using existing owner AKEK without leaking raw into UI; upload signed envelope through scoped API. Recipient must verify the owner's signature and full manifest AAD, validate SHA-256 and ciphertext frames, decrypt using accepted local grant secret, not their own account AKEK, and ensure account/device epoch isolation. Then run two real-account/device/browser tests, revocation/rotation and route fault injection.
- Already-decrypted content cannot be wiped remotely; new reads check current ACL on every request and each streaming chunk. Cached recipient plaintext must be session-only and object URLs revoked at account switch.
- Default-disabled code is not a claim of E2EE photo sharing. P0 STOP remains. **No PHP/TS build, PHPUnit or real device tests run** at this stage.

## Client continuation

Added `withTransientOwnerDEK` (identity internal helper): decrypt only the selected owner AKEK envelope, hold the raw 32-byte key in a short-lived callback, then zero the byte buffer on both success and failure. The photo-grants owner use case `publishRecipientThumbnail` only publishes a signed thumbnail key envelope when a live accepted grant and frozen local photo binding match current server metadata; it does not grant an original or metadata asset. No direct Vue crypto import.

Added `readRecipientThumbnail`: a recipient first checks live accepted grant, obtains the authenticated owner-signed ciphertext manifest from the gated endpoint, verifies detached signature and exact context/generation, unlocks the per-grant transport secret in scoped local storage, decrypts the per-asset DEK in memory, independently verifies ciphertext SHA-256 and the existing owner-scoped frame authentication; returns only a volatile WebP Blob. No OPFS/IndexedDB or system gallery writes. New tests target owner key zeroization, wrong context, owner AAD and corrupted bytes.

**No release:** server recipient-read config remains false; signing key distribution, policy/roles, offline time, code recovery, actual multiple devices, race/revoke/E2E and real builds must be independently reviewed. Signed thumbnail transport is not equivalent to finished cross-account photo sharing.
