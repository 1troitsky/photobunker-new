# PhotoBunker PB2 — simpler cross-account photo sharing

Status: design contract for **Draft PR #42**. Not a claim of functional or security acceptance.
No new protocol, cryptographic primitive, database, transport, or queue is authorized by this note.

## Scope and purpose

Restore PB1's assignment-based photo sharing on the PB2 key-only, E2EE architecture.
Current behavior already includes individually encrypted assets, encrypted assignment
grants, an outbox, per-recipient thumbnail envelopes, and a fail-closed feature flag.
The remaining task is **integration and verification**, not another rewrite.

## Smallest stable flow

1. **Invite:** owner chooses an assignment, an existing contact, and a role.
   A single-use out-of-band invitation code protects one randomly generated,
   assignment-grant transport secret; the recipient explicitly accepts and
   stores the secret encrypted in their own account-scoped local vault.
   The invitation by itself grants no photograph access.
2. **Capture:** each photo has a new per-asset DEK (existing PhotoVault).
   The locally frozen assignment policy and encrypted photo are written
   optimistically, then synchronized by the existing durable outbox.
3. **Share:** only after upload confirmation, owner explicitly selects a
   photo and allowed asset scope. The client wraps **that asset's existing DEK**
   for the accepted recipient grant using the grant's transport secret.
   Publish the existing signed, immutable recipient-key statement. Retry with
   the *same* operation ID, ciphertext, generation, and signature.
4. **Read:** Laravel must check the current recipient session, accepted grant,
   current role, contact/block status, current assignment membership and
   authorization, the immutable photo-to-assignment binding, asset scope,
   expiry, revoke/generation, owner-device proof and signed key statement.
   The client verifies its out-of-band pinned owner identity, AAD, cipher hash,
   expiry and decrypts in memory. Missing or uncertain state must deny.
5. **Revoke/expire:** server denies new reads immediately; queued shares for
   old generations do not become visible again. Retire local cached secrets
   and expired ciphertext via existing cleanup. Previously downloaded
   plaintext can never be remotely recalled; state this clearly in UX.

## Reduce moving parts, not protections

- **One grant lifecycle:** pending / accepted / revoked / declined; generation
  increments on regrant. Never make a second implicit grant from Team membership.
- **One photo upload outbox:** use existing photo sync. One signed recipient
  share queue for per-asset envelope publication; no parallel upload protocol.
- **One server ACL decision** invoked by all recipient list, manifest and
  ciphertext routes, and by publication eligibility. The current
  `RecipientGrantAccess` is the starting point. Remove duplicated contact
  and block queries only after moving them with tests proving identical
  deny semantics; publish, list and reads must not drift.
- **One key per asset, wrapped per recipient:** never share a global account key
  or decrypt files on the server. Do not invent an assignment-wide photo DEK.
- **One source of truth for progress and availability:** server-finalized
  receipts for confirmed, local outbox for pending; neither implies recipient
  accessibility.
- **Keep the thumbnail-only boundary.** Do not expand to original/master
  scope until explicit product permissions, E2EE provenance and server
  authorization are independently verified.
- **Never simplify away** the ownership binding, TTL, revocation, cryptographic
  provenance, immutable operation identity or crash-safe local persistence.

## Concrete known risk boundaries

- `photo_sync.recipient_thumbnail_reads_enabled=false` MUST remain the
  production default until two-account security and UX acceptance passes.
- Owner-device publication uses an account-root signature plus enrolled device
  signing SPKI. Both are validated when granting access; server-supplied
  public keys without out-of-band owner pinning are insufficient.
- Rejected, expired or revoked grants must fail closed at **list, manifest,
  ciphertext and per-chunk stream reads**, not only the initial UI button.
- Current separate `PhotoRecipientController::publish` relationship checks and
  `RecipientGrantAccess::resolved` relationship checks duplicate policy.
  Consolidate into a single reusable server authorization function **without
  changing its allow/deny behavior**.
- Existing assignment flags for browsing/edit/delete describe intended policy;
  they are not evidence of enforced server roles. UI must not claim that
  these controls already authorize access.

## Acceptance (finite, outcome-based)

A real owner account and a real recipient account must be able to:

- invite / accept with pinned owner identity; deny wrong code and replay;
- take a photo offline, reconnect, get a real upload receipt, explicitly share
  exactly the permitted encrypted rendition, and read it on the recipient device;
- reject access on wrong account, wrong assignment, unaccepted grant, blocked
  contact, revoked grant, generation mismatch, altered signature, swapped
  envelope, changed image hash, expired photo, and deleted photo;
- keep a pending share after restart and avoid double-publishing on lost ACK;
- show understandable pending/synced/denied status without ever suggesting
  unauthorized decryption has succeeded.

No release until at least one actual same-origin HTTPS, two-account browser
journey and independent security review pass. Keep Draft PR and leave `main`
unchanged; Codex can integrate the resulting change set after verification.
