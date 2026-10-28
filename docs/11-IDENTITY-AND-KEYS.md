# 11. Anonymous key-only Identity, trusted devices and key recovery

**Status: normative technical baseline for R2-03/R2-04, 28.10.2026.** PhotoBunker v1 has no email, phone number, username/password login, password reset or identity-provider dependency. The application creates a private pseudonymous account controlled by one high-entropy **Account Recovery Key**. Losing that key and every enrolled trusted device means permanent loss of the account and encrypted data. No support or server-side bypass exists.

This is a privacy-oriented pseudonymous identity, not a promise of network anonymity: hosting and network operators can still observe ordinary connection metadata unless a separate anonymity layer is added later.

## 1. Stable account identity without personal identifiers

`Account` has a server-generated opaque `accountId` and an account authentication public key. `Profile`, `Device` and `Session` are separate records. A display name/handle is optional profile data and is never a login credential.

Photo, Assignment, Team, Card and Browser refer to `accountId` and capabilities through the public Identity/Authorization API. Billing or Messenger may be separate future modules, but they cannot become startup dependencies and must not reuse photo encryption keys. Messenger/Matrix/RTC are outside the current release.

The one user-visible recovery key encodes a version, non-secret account locator, at least 256 random secret bits and a checksum in a human-safe form. The exact encoding and cryptographic primitives require Codex review and versioned test vectors before R2-03. The raw secret is never sent to the server, logged, placed in URLs, analytics, localStorage or persistent browser caches.

## 2. Key hierarchy — no single content key for every photo

- **Account signing keypair:** proves account control by signing short-lived server challenges. The server stores only the public key.
- **Account Key Encryption Key (AKEK):** wraps data-encryption keys; it never encrypts photo bytes directly.
- **Per-asset DEK:** every photo asset, edited rendition, thumbnail and independently shared object receives a fresh random AEAD data key. Sensitive metadata uses a separately scoped key/envelope. A compromised asset key must not reveal unrelated assets.
- **Recovery envelope:** the Recovery Key derives a wrapping key that encrypts a versioned account key package containing the private account signing material and AKEK. The server stores ciphertext only.
- **Device envelope:** each trusted device has its own keypair and local envelope for the account key package. Device keys and recovery keys are separate.

Every encrypted envelope includes an algorithm/version, key ID, account ID, asset/photo ID, purpose, revision and required lifetime context as authenticated data. Rotation is versioned: replacing a recovery key or device envelope does not require encrypting all photo bytes again; AKEK rotation re-wraps DEKs rather than reusing one global content key.

Do not invent a custom AEAD or KDF. Algorithms, browser support, envelope serialization, nonces, rotation and test vectors must pass an explicit security review before encrypted storage work becomes Ready.

## 3. Account creation and first trusted device

Bootstrap states: `pending` → `account_keys_created` → `first_device_enrolled` → `ready`; also `needs_recovery`, `revoked`, `failed_retryable`. Every transition uses an idempotency key, proof-of-possession and CAS. A partial state is never treated as ready.

1. The client generates the Recovery Key, account signing keypair, AKEK and first device keypair locally.
2. It builds and locally verifies the encrypted recovery and device envelopes before claiming success.
3. The server atomically creates the opaque account, stores the account public key and encrypted recovery envelope, and enrolls the first device. The first device never waits for approval from another device.
4. The user must save and confirm the single Recovery Key before the bootstrap is considered complete. The application clearly states that there is no email/password reset and no administrative recovery.
5. Lost ACK, reload or retry continues the same bootstrap with the same operation ID and keys. It must never create a second incompatible account silently.
6. The account becomes `ready` only after the client proves it can unlock both recovery and first-device envelopes and the server verifies a signed challenge.

The public shell and Create/Restore screens render without waiting for HTTP. Creating or restoring an account requires a network connection; an already enrolled device may unlock authorized local ciphertext offline.

## 4. Sign in, restoration and a second device

There is no password sign-in. A trusted device authenticates by signing a fresh, short-lived, single-use server challenge, then receives a bounded secure session cookie. CSRF protection, replay resistance, rate limits and abuse controls remain mandatory.

On a new device the user chooses one of two paths:

- **Enter the Account Recovery Key:** its locator retrieves the encrypted recovery envelope; the secret decrypts it locally. The client signs a server challenge and enrolls a new device envelope. The server never receives the secret, derived wrapping key, AKEK or private signing key.
- **Pair with an existing trusted device:** a short-lived one-time challenge and explicit out-of-band confirmation transfer the account key package only as an envelope encrypted to the new device public key.

Failed, replayed, expired or revoked challenges do not damage existing devices. The new device must not approve itself. A user with an active trusted device may rotate/export a new Recovery Key after explicit confirmation; old recovery envelopes are revoked without changing existing photo ciphertext.

If the Recovery Key and all trusted devices are gone, restoration is impossible. The UI must state this before the first photo is captured and must never offer a fake support reset.

## 5. Browser device-key protection and account switching

The PWA cannot promise Secure Enclave protection. The selected implementation should prefer non-extractable WebCrypto device keys persisted by structured clone where supported, protected by strict CSP/Trusted Types and minimal same-origin code. Capability and recovery tests are mandatory. An App Lock PIN is a separate UI gate and must not be represented as the Recovery Key or sole protection of the account key package.

OPFS and IndexedDB are scoped by immutable `accountId` and `deviceId`. Account switch/logout immediately clears runtime plaintext, decrypted surfaces, object URLs and Pinia state; cancels or rejects stale tasks/responses; and stops scoped workers/outboxes. It does not silently delete another account's ciphertext. Returning to an account requires its enrolled device proof or the Recovery Key.

Revoking a device closes sessions and future server reads. Already downloaded offline ciphertext and keys cannot be remotely erased while a device is disconnected; this limitation must be stated honestly and tested.

## 6. Mandatory R2-03 acceptance

- Create account, save/confirm key, first-device enrollment and signed session; failure/reload/lost ACK at every bootstrap phase.
- Restore on a new device with the one Recovery Key and through pairing; wrong/checksum-invalid/replayed/expired/revoked proofs fail closed.
- Regression: first device never shows an impossible “confirm from another device” gate.
- Recovery-key rotation from an existing trusted device and explicit permanent-loss UX when no key/device exists.
- Two accounts in one browser, account switch, stale callbacks, reboot and offline unlock with no cross-account frame or key exposure.
- Per-asset DEKs, versioned envelopes, corruption/tampering tests and key-rotation test vectors.
- No raw Recovery Key, account private key, AKEK or plaintext DEK in logs, URLs, analytics, localStorage, IndexedDB or OPFS.

R2-03 and especially R2-04 cannot be marked Ready until Codex reviews the protocol and executable test vectors. R2-01/R2-02 UI work does not depend on that review.
