# G5 — PIN, local deletion and emergency access: safety implementation boundary

Status: **READ-ONLY SAFETY PREFLIGHT IMPLEMENTED (DRAFT); PIN LOCK / LOCAL ERASE / EMERGENCY WIPE NOT IMPLEMENTED**.

## Threat model and non-negotiable rules

PB2 Identity retains live account/device keys and decrypted transient object URLs, while independent vault, camera, gallery, editor, sync and photo-grant modules expose application capabilities. Copying PB1 `app/lock.ts` or rendering a PIN overlay would not block an existing key grant or another tab: **a visual PIN screen is not an access barrier**.

The G5 implementation must instead place a central, synchronous, fail-closed authorization gate at Identity key issuance and every storage/photo/metadata read, signing and ciphertext grant operation. Key grants must be revoked on lock, account switch, page hide according to chosen policy, expiry, and cross-tab lock broadcast. Decrypted object URLs and in-flight operations must be invalidated; clipboard/export cannot be retroactively erased.

A PIN verifier must be stored independently from recovery-key and photo DEKs, with hardened derivation, secure storage, cooldown/rollback handling, cross-tab atomic failures, distinct App Lock/Delete/Emergency records and recoverability procedure. PIN is an additional local protection control, not a replacement for PB2 Recovery Key.

## Read-only safety inventory

The `inspectDeviceDataSafety` use case reads the scoped vault photo headers, live local sync states, pending outbox and trusted-time status. It never calls reconcile, erases assets, revokes keys, signs deletion, mutates server state or claims verified cloud restore. The result is **always `permitted:false`**. It cannot prove whether another device can restore full encrypted data, whether current server assets are complete or whether only unsynced originals exist in orphan journals.

Unconfirmed local photos, in-progress/retry outbox, offline/untrusted time and unverified recovery are blockers. Even an empty vault is not proof that deleting Identity/Device state is safe: there may be unsynced grants or pending encrypted records outside the photo inventory.

## Destructive state machine (future, not executable)

1. **Requested** → independent owner authentication, separate intent, PIN verification, signed device-scoped operation ID.
2. **Preflight** → enumerate ALL PB2 encrypted feature stores / journals / pending sync, confirm cloud completeness and **actual restored decrypt on second trusted device** for recoverable items; disclose irrevocable unsynced assets.
3. **Prepared** → durable encrypted intent and tombstone/deletion plan, idempotent and crash-safe. No remote ACK inference.
4. **Local locked** → atomically cut all local key grants, revoke ephemeral previews, stop background sync; pending remote operations remain explicitly pending.
5. **Server revoke pending** → retry immutable signed request until independently confirmed, no false deletion success. Offline mode never fabricates ACK.
6. **Completed** → distinguish verified server completion from local-only irreversible loss, audit without PIN, recovery keys or photo metadata.

Emergency input must not be implemented as a shortcut that deletes OPFS/IndexedDB without a recoverability contract or that removes the only copy of photos.

## Independent acceptance required

- Authenticated/guest/offline and account-switch preflight, malformed/out-of-date rows, expired/photo outbox conflicts and journal orphans.
- Browser clock rollback, quota, iOS Safari/PWA storage eviction, second-tab active photo read and lock broadcast.
- Wrong PIN attempts/cooldown, device pairing/revocation, recovery with lost PIN and valid Recovery Key.
- Crash between key revocation and server ACK, signed replay, block/race with cleanup, no orphan resurrection.
- E2EE two-account photo read after owner device lock/revoke and after explicit recipient grant revoke.

Do not merge or enable destructive controls until those security reviews and device scenarios pass.

## 2026-10-31: G5 App Lock integration (Draft, not security-accepted)

The stacked implementation branch adds an **opt-in 6–8 digit App PIN**, an independent IndexedDB verifier with random salt and PBKDF2-SHA256 (310,000 iterations), bounded failed-attempt cooldown, wall-clock rollback rejection, device/account scope, cross-tab lock broadcast, and lock-on-background. A PIN can be configured from `/profile/data-safety`, then immediately locks from the same screen; unlocking only occurs through a local verifier. A locked shell unmounts protected Vue routes.

Identity enforces the lock at new `acquireStorageKeys` grants and grant `check()`, owner DEK rewraps, device/root signing, relevant account mutations and photo/assignment/collaboration HTTP. Lock invalidates request generation, aborts pending requests, revokes registered decrypted object URLs and notifies active view cleanup handlers. Thus **existing vault instances become invalid**, even after a later unlock; each new access must acquire fresh grants.

**This is not hardware-backed cryptographic key erasure.** The existing device-envelope CryptoKeys still exist in browser storage and within the active in-memory Identity state while locked. JavaScript-side PIN gating cannot guarantee resistance against hostile extensions, modified client code, full local device compromise, concurrent WebCrypto work outside these capability guards or offline verifier extraction. The active session and all feature APIs require separate independent security review. There is no claim of remote wiping cached data or PIN-protected account recovery.

For lost PIN, the lock view offers a non-destructive path to Recovery Key login, which creates a fresh trusted device subject to server recovery policy. Existing local ciphertext is not actively erased by this path; **unsynced items may not be recoverable on the new device**. Password/PIN is never placed in a URL, log, remote API or local plaintext record.

The **Local-delete PIN** and **Emergency PIN** remain genuinely unavailable, not simulated. A separate hardware/device threat assessment and durable signed deletion intents with offline delivery are mandatory before implementing them.

### Additional verification gates

- Run fresh locked account / reload / offline PWA / lock-on-background / wrong PIN cooldown / clock rollback on physical iOS Safari and Android.
- Verify *every* crypto, signed request and media storage access after lock; specifically simultaneous tabs, queued background sync and in-flight owner/recipient E2EE decrypt.
- Prove lock instantly clears current previews and stale asset grants even during an IndexedDB write or WebCrypto call; verify no unsynced asset is deleted.
- Threat-review low-entropy PIN verifier, atomic cross-tab attempt records and ability to bypass JS-side controls by tampering with web bundles/IndexedDB.
- If any bypass or plaintext residue is found, leave G5 App Lock **disabled for production** until hardening is complete.

## 2026-10-31: independent destructive-PIN preparation and cross-store risk visibility

The next stacked G5 slice adds two **independent, device/account scoped** verifier records, `local-delete` and `emergency`. They are not derived from App Lock and never share a verifier, salt or stored credential. Each uses an eight-digit PIN, fresh 128-bit salt, PBKDF2-SHA256 350,000 rounds, serial IndexedDB read-write attempt updates, bounded cooldown after repeated failures, wall-clock rollback rejection, and a scoped Identity/App Lock check. Neither verifier returns a durable privilege token; successful verification only resolves the immediate call, **never erases any data**.

The settings screen offers an explicit *credential preparation* step, and states clearly that both **delete and emergency actions are unavailable**. This is not a production emergency wipe button or a remotely durable signed emergency intent.

The risk inventory now inspects, without mutation:
- locally persisted photo ciphertext records and unfinished photo staging journals;
- photo outbox entries, including conflicts and retries;
- assignment, collaboration and grant queues (including recipient thumbnail shares);
- encrypted grant secret count.
It is scoped to current Identity account and device, detects account switching after async reads, and contributes each pending category to a fail-closed report. It cannot prove other devices' restore capabilities; a healthy outbox is not evidence that the last copy can be erased. **No deletion authority is returned by this feature.**

### Explicitly deferred until API + independent review

1. A new server-signed and idempotent `device-revoke-intent` protocol with its own database record, sequence/nonce and replay protection. Reuse neither insecure general-purpose login nor a browser-local acknowledgment.
2. Complete inventory of feature journals, offline pending operations, recovery envelopes, account-side metadata and device-origin OPFS copies before defining the exact erase target.
3. A durable state machine `requested → locally locked → remote pending → server acknowledged → local cleanup completed` with crash replay and a signed server ACK; offline mode remains **pending**.
4. Two-stage user authorization and separate consent for destroying *unsynced* local ciphertext. No UI can claim backups are recoverable without a different trusted device actually decrypting them.
5. Atomic key-grant revocation and OPFS/IndexedDB deletion for **this device only**, preserving other trusted devices and remote ciphertext until independently authorized. This requires explicit negative tests and owner acceptance.

This package delivers preparation plus inventory, **not a completed Local Delete/Emergency implementation**. Never enable UI destructive actions based solely on an eight-digit verifier or a `permitted:false` inventory.
