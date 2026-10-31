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
