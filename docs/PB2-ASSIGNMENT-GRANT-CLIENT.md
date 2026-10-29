# PB2 recipient invitation client — staged

Client design adds a separate `photo-grants` feature with narrow public use cases. Its local Dexie database stores only an account+device-scoped AES-GCM encrypted grant transport secret, itself protected by an account-wrapped DEK, and signed immutable outbox operations (no raw secret or invitation code in IndexedDB). Code shown once to owner. Recipient must verify out-of-band code and decrypt accepted recipient-specific sealed grant secret **before** enqueueing signed accept. The background outbox only submits canonical JSON with device signature; API requests use existing identity CSRF/generation protections.

**P0 still STOP.** A grant has no photo-read permissions. Existing /photos/v1 remains owner-only. Recipient photo AAD decryption, owner DEK rewrap, grant ACL and revocation of cloud content are not implemented or asserted. Do not claim end-to-end photo sharing or completion of #39. Tests authored, execution pending.
