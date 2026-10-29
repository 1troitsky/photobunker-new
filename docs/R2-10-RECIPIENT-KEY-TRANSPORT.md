# P0 recipient DEK transport — isolated crypto primitive

**Status: Implementation slice only; sharing remains DISABLED.**

Existing PB2 photo assets are encrypted with fresh AES-GCM DEKs, wrapped by the *owner* AKEK. Team membership never confers photo reads. The existing ECDSA account signing key is not an ECDH recipient transport key.

This slice adds an out-of-band 256-bit invitation code and a recipient DEK wrapper. HKDF-SHA-256 derives an AES-GCM transport key; authenticated context binds grant ID/generation, assignment, owner/recipient accounts, photo ID, asset ID/kind/revision, expiry and ciphertext digest. Wire formats require canonical base64url, strict fields, and reject wrong account/asset/context or expiry. Only encrypted DEK envelopes and a SHA256 code hash should be persisted on server; code and raw DEK must never enter URLs/logs. The recipient needs the code through a private out-of-band channel.

**Not yet integrated:** authoritative signed Assignment grant invitation/acceptance/revoke, server checks on every object/manifests/review path, owner's key rewrap capability without exporting non-extractable keys to UI, recipient decryption of **owner-scoped** manifest AAD, device-account-scoped recipient caches, rekey after grants change, real two-device E2E. Already obtained offline ciphertext cannot be remotely erased. P0 STOP remains; no new photo read endpoint is enabled.

Tests authored for crypto roundtrip, substitutions, corruption and expiry. Test execution is documented separately; never infer release readiness.

## Invitation key separation

The **out-of-band code** is used only to HKDF/AES-GCM seal/unseal a separately generated 32-byte **per-grant transport secret**, with authenticated grant/assignment/owner/recipient fields. Server stores the sealed secret and SHA256(code), but neither plaintext. The owner must durably store its transport secret in an owner-key-encrypted cache, and recipient must decrypt and durably store its own encrypted copy **before** signing `accept`; those persistence and client use-cases are not implemented yet. Per-asset recipient DEK envelopes use the transport secret and must bind accepted grant generation plus photo/asset exact context. No recipient photo ACL is active.
