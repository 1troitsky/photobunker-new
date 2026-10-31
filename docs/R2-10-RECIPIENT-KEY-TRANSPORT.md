# P0 recipient DEK transport — isolated crypto primitive

**Status: Implementation slice only; sharing remains DISABLED.**

Existing PB2 photo assets are encrypted with fresh AES-GCM DEKs, wrapped by the *owner* AKEK. Team membership never confers photo reads. The existing ECDSA account signing key is not an ECDH recipient transport key.

This slice adds an out-of-band 256-bit invitation code and a recipient DEK wrapper. HKDF-SHA-256 derives an AES-GCM transport key; authenticated context binds grant ID/generation, assignment, owner/recipient accounts, photo ID, asset ID/kind/revision, expiry and ciphertext digest. Wire formats require canonical base64url, strict fields, and reject wrong account/asset/context or expiry. Only encrypted DEK envelopes and a SHA256 code hash should be persisted on server; code and raw DEK must never enter URLs/logs. The recipient needs the code through a private out-of-band channel.

**Not yet integrated:** authoritative signed Assignment grant invitation/acceptance/revoke, server checks on every object/manifests/review path, owner's key rewrap capability without exporting non-extractable keys to UI, recipient decryption of **owner-scoped** manifest AAD, device-account-scoped recipient caches, rekey after grants change, real two-device E2E. Already obtained offline ciphertext cannot be remotely erased. P0 STOP remains; no new photo read endpoint is enabled.

Tests authored for crypto roundtrip, substitutions, corruption and expiry. Test execution is documented separately; never infer release readiness.

## Invitation key separation

The **out-of-band code** is used only to HKDF/AES-GCM seal/unseal a separately generated 32-byte **per-grant transport secret**, with authenticated grant/assignment/owner/recipient fields. Server stores the sealed secret and SHA256(code), but neither plaintext. The owner must durably store its transport secret in an owner-key-encrypted cache, and recipient must decrypt and durably store its own encrypted copy **before** signing `accept`; those persistence and client use-cases are not implemented yet. Per-asset recipient DEK envelopes use the transport secret and must bind accepted grant generation plus photo/asset exact context. No recipient photo ACL is active.


## 2026-10-30 – Durable delivery and pinned owner provenance

The owner share path now persists an **unchanged, signed, encrypted** thumbnail-key statement before any network transmission. IndexedDB schema v2 adds a separate account/device-scoped outbox; retry and an ambiguous HTTP response send the same operation ID, statement, root proof and device signature. No raw asset DEK, grant invitation code, unwrapped grant transport secret or pixels enter the outbox. 4xx authorization/revocation conflicts stop automatic retries; 401/network/5xx remain retryable. Pending/retry/conflict are shown separately; "queued" is never represented as server ACK. The server still returns owner-only photo reads and the recipient feature flag is OFF.

A v2 invitation uses an out-of-band 256-bit code to encrypt **both** the separately generated grant secret and the author's long-lived account signing SPKI. The accepted recipient decrypts and stores both under a device/account-scoped AES-GCM envelope; no untrusted manifest key can overwrite this pin. Legacy v1 invitations remain readable as archival data, but cannot establish a pinned identity and therefore are **not** permitted for recipient thumbnail decryption (create a fresh v2 invitation).

On each share the owner signs the exact encrypted-asset statement twice: with the active device signing key and a separate long-lived account root key over \`deviceId\\nSPKI\\nstatement\`. The server verifies both signatures against live account + enrolled device records and rechecks device revocation on every read. Recipient verifies the server-returned account root against the OOB-protected pin, verifies the root endorsement of the device and then its detached asset statement signature before decrypting any DEK. This prevents a server that simply substitutes a public device key in a manifest from fabricating an owner's signature. Server remains authoritative for grant/revocation/TTL; owner is responsible for privately delivering the invitation code.

This is an **implemented Draft crypto path, NOT independent security verification**. Must test real two-device browser sessions, malicious/corrupted server responses, truncated signed envelopes, independently signed account/device proofs, async account-switch, lost ACK replay, concurrent tabs, contact block/revoke and expiry. Re-keying / rotating long-lived owner keys and legacy invite migration remain deliberately explicit tasks; recipient read flag remains default disabled. Do not merge or release.
