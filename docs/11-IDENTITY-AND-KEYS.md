# 11. Anonymous key-only Identity, trusted devices and key recovery

**Status: normative technical baseline for R2-03/R2-04, 28.10.2026.** PhotoBunker v1 has no email, phone number, username/password login, password reset or identity-provider dependency. The application creates a private pseudonymous account controlled by one high-entropy **Account Recovery Key**. Losing that key and every enrolled trusted device means permanent loss of the account and encrypted data. No support or server-side bypass exists.

This is a privacy-oriented pseudonymous identity, not a promise of network anonymity: hosting and network operators can still observe ordinary connection metadata unless a separate anonymity layer is added later.

## 1. Stable account identity without personal identifiers

`Account` has a server-generated opaque `accountId` and an account authentication public key. `Profile`, `Device` and `Session` are separate records. A display name/handle is optional profile data and is never a login credential.

Photo, Assignment, Team, Card and Browser refer to `accountId` and capabilities through the public Identity/Authorization API. Billing or Messenger may be separate future modules, but they cannot become startup dependencies and must not reuse photo encryption keys. Messenger/Matrix/RTC are outside the current release.

The one user-visible recovery key encodes a version, non-secret account locator, at least 256 random secret bits and a checksum in a human-safe form. The concrete PB2 encoding, primitives and wire contracts are fixed by the approved Issue #4 **Codex security review — protocol v2**, recorded below. Independent implementation security review and executable test vectors remain mandatory before merge. The raw secret is never sent to the server, logged, placed in URLs, analytics, localStorage or persistent browser caches.

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


## 7. R2-03 binding protocol v2 — Codex security review

This section supersedes PB1/PB4 and generic v1 wording elsewhere in this document. Normative: [Issue #4](https://github.com/1troitsky/photobunker-new/issues/4). Legacy sources are read-only; no backwards compatibility or legacy migration in R2-03.

1. **Recovery Key**: exact ASCII `PB2.<locator>.<secret>.<check>`. Each component uses *canonical unpadded base64url* (reject padding, aliases, extra fields, trailing characters). `locator` 16 random bytes; `secret` 32 random bytes; `check` first 8 bytes of SHA-256 of UTF-8 `photobunker/recovery-key/v2\0` followed by raw locator and secret. Checksum corrects typos only, **not authentication**. Example deterministic test vector (locator `00…0f`, secret `00…1f`):
   `PB2.AAECAwQFBgcICQoLDA0ODw.AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8.DfSeedbBq6Y`.
2. **Bootstrap**: before any `POST /identity/v2/prepare`, browser proves durable IDB storage, structured-cloned *non-extractable* P-256 device signing key and AES key, encryption/decryption and cleanup. Client-generated UUID `operationId` plus random reservation proof is stored locally (not the raw Recovery Key). Server atomically reserves random opaque UUID `accountId`; exact retry gives the same ID, conflicting proof returns 409. Client seals and locally verifies packages before `register` proof; server atomically stores Account + recovery envelope + first Device, without other-device approval. After lost response, resume with the exact pending keys/operation, reconcile `prepare` and device `login`, never silently replace key material.
3. **Signing**: account ECDSA P-256/SHA-256 public SPKI on server; private PKCS#8 *only inside client-encrypted account package*. Separate device P-256 signing key is non-extractable, IDB structured-cloned only after probe. Package contains exact fixed fields `v,accountId,accountSpki,accountPkcs8,akek,signingKeyId,wrappingKeyId,revision` (v=2, AKEK 32 bytes). AKEK wraps fresh 32-byte per-asset DEKs; it never encrypts photo bytes directly.
4. **Envelopes**: HKDF-SHA-256 from raw secret, salt = raw locator and info `photobunker/recovery-envelope/v2:<accountId>`. AES-256-GCM, fresh random 12-byte IV, 128-bit tag. AAD is canonical ASCII JSON with exact `version,alg,accountId,locator,keyId,purpose,revision` for recovery, and `version,alg,accountId,deviceId,keyId,purpose,revision` for device. Wire envelope has **exact** keys `v,alg,accountId,locator|deviceId,keyId,purpose,revision,iv,ciphertext`. Invalid revision, unrecognized/extra fields, noncanonical base64url, tampered ciphertext or wrong purpose fail closed.
5. **Challenges**: server generates 32 random bytes, UUID, purpose, exact validated ASCII JSON payload SHA-256 digest, expiry ≤120 seconds, one-time consumption in DB transaction. Client independently reconstructs `photobunker.identity.v2\n<purpose>\n<challengeId>\n<nonceB64>\n<expiresAt>\n<sha256(payload)>` and signs exact UTF-8 framing. WebCrypto ECDSA signatures are 64-byte P1363 (`r||s`), server converts to ASN.1 DER before OpenSSL verification. Purpose/device/revision binding, replay, expired challenge, revoked device and wrong signature reject. Session is an encrypted, HttpOnly/Secure/SameSite=Strict host-only cookie, max 24 hours; rotation of session ID at proof, renewal requires device proof. Same-origin CSRF, origin check and rate limits required.
6. **Recovery**: GET by non-secret locator returns ciphertext account envelope + server public key and revision; client decrypts, verifies account public/private key agreement, generates a *fresh* device key/envelope, signs recovery enrollment with recovered account key and new-device key. No private key, recovery secret, AKEK or DEK is transmitted. Account switch/logout rejects stale callbacks and removes runtime plaintext/object URLs, without deleting another account’s ciphertext.
7. **Rotation**: signed account + current device proof, `expectedRevision` CAS; new random locator and AEAD envelope published atomically, old locator invalid only after commit. Idempotent reconciliation checks original `operationId` and envelope digest, never replays a consumed challenge. User must save and confirm new key before attempting rotation; after ambiguous network outcome do not claim success.
8. **Pairing**: new device ephemeral P-256 ECDH and signing key, 5-minute one-time request. Trusted, distinct existing device shows/computes fingerprint and explicitly approves only after out-of-band comparison. HKDF-SHA-256 derived from ECDH shared bytes; AES-GCM transfers the encrypted account package with AAD binding accountId/pairingId/newDeviceId. Server relays public keys/ciphertext only. After decrypt, new device signs a separate enrollment challenge. Self approval and replay denied.
9. **Server boundary**: `apps/api` is a new minimal Laravel backend (R2-03 only); `/identity/v2/*` must be reverse-proxied same-origin over HTTPS and DB migrations installed by Codex. No Garage/S3, Photo storage or Matrix. Only public account authentication keys, ciphertext, device signing public keys, opaque IDs and bounded session metadata are server-visible. Do not log secrets.
10. **Review gate**: Codex must run unit vectors, PHP API tests, browser IDB probe, lost-ACK/reload, multiple accounts/tabs, Safari PWA, signature replay/expiry/revoke, rotation, pairing, production build and threat review. Until actual PASS, this implementation is a **Draft PR under review**, not audited E2EE nor a production release.

Fixed HKDF vector for bytes `locator=00…0f`, `secret=00…1f`, `accountId=00000000-0000-4000-8000-000000000001`: `aee630a52a9361e5e677793df273a4fabd0c60b615e205e2facfaa06278f90a6`.
