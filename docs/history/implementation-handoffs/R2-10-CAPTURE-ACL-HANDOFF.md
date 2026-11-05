# R2-10 — Assignment-bound Capture, ACL and Review: implementation handoff

**Status (2026-10-29): partial safety-gated implementation, not Verified/Integrated/Accepted.**
This file records an intentional P0 gap: **cross-account encrypted assignment capture and
review cannot be marked complete** until the independent E2EE sharing contract is implemented,
tested and accepted. Do not merge this PR merely because its own unit tests are green.

## Implemented in this branch
- Retains personal PhotoSync signed contract `version:1`.
- Introduces signed `version:2` contract with immutable `capture`:
  `assignmentId, assignmentRevision, policyRevision, mode, retentionDays, capturedAt`.
- Photo vault stores captured snapshot in the existing encrypted local photo commit and same
  PhotoSync outbox; photo metadata includes the frozen source and policy. No second queue.
- Server checks trusted policy acceptance ledger and currently active `in_progress` assignment,
  original/master kind vs mode 2/3, server-bounded timestamp, exact TTL and actor account.
- Policy revisions are recorded on Assignment creation/policy edit; migration backfills only
  current policy of any prior rows, **never fabricates missing historical revisions**.
- Camera lists only already-synchronized in-progress **owned** assignments, offers a
  specific assignment selection and freezes mode/TTL/revisions before taking the frame.
- Server review state and revision are **separate** from Assignment status; accepted,
  correction, reshoot, rejected, encrypted comments, response and signed CAS/idempotency.
- Review UI and a new public feature application contract; review mutations use existing
  PhotoSync Dexie outbox with encrypted comment envelope, fixed operation IDs and replay,
  revision conflicts are preserved until an explicit server-choice action.
- When photo ciphertext has actually been deleted, lifecycle also erases encrypted review,
  response and assignment binding rows. An expired photo is inaccessible before cleanup.
- Tests authored (NOT RUN): PHP signed review/expiry/replay/CAS and assignment policy;
  Vitest owner snapshot, immutable policy, outbox encryption/retry/account isolation.

## Security STOP — unresolved cross-account capability
The upstream PB2 ciphertext DEK is wrapped to the **author's AKEK**. Another account
cannot decrypt a protected photo even if its user is a Team member. R2-09's Team key
is not connected to PhotoSync. Its Team member list **must not** be interpreted as a
photo grant, and a server-visible assignment/Team ID is never a bearer permission.

This branch therefore **fails closed** to owner-only assignment capture/read/review.
This is **not a full R2-10 implementation**. Owner-facing reviewers can currently
review their own captured photos only; cross-account contributor/curator review, target
assignment enrolment, and shared encrypted comments are not shipped.

### Required next work inside this same PR before Verified
1. Explicit accepted Assignment grants for owner/curator/contributor/viewer, with a
   server-controlled actor/capability matrix. No implicit Team-wide photo access.
2. A separately versioned recipient E2EE envelope design: a fresh DEK per photo
   asset wrapped for each authorized account (or a separately scoped, rotated Assignment
   content key); no reuse of PB2 AKEK or unscoped Team membership for photos.
   Signed manifests must bind recipient/wrapper revision, photo ID, assignment,
   effective TTL, exact asset kind and metadata scopes; server only stores ciphertext.
3. Atomic create/revoke/leave, signed generation-bound grants and current ACL checks
   on **reserve, retry, upload, finalize, get/list, thumbnail, original, metadata,
   review and response**, including decryption guards on the client. Revoking access
   must prevent new server reads immediately, with honest limitations for cached
   offline ciphertext and explicit key rotation for future material.
4. Production UI for invited contributor/curator: accept grant, decrypt shared
   assignment policy, capture or review according to role, and see only allowed
   photos. Test with two separate PB2 accounts and independent devices.
5. Define accepted, trusted capture window semantics and durable time proofs.
   R2-08 stores no explicit startsAt/endsAt; this branch checks in-progress
   lifecycle but cannot truthfully claim user-scheduled date-window support.
   The browser's signed offline timestamp alone cannot cryptographically prove
   that an old policy was active at shutter time.
6. Correct any fault-injection findings: policy change during offline capture,
   revoked contribution with pending encrypted upload, lost ACK, interleaved
   client/server CAS, collision/replay, deletion and TTL cleanup, account switch,
   failed object store and two-tab concurrency. Confirm gallery/PhotoCard restrictions.
7. Run real Composer/Laravel/PostgreSQL and pnpm/Vue/Vitest/Playwright production
   HTTPS, iOS Safari/Android PWA, storage plaintext inspection and all upstream regressions.

## Data and rollback
- New migration `2026_10_29_000006_create_assignment_capture_v1.php` creates
  the policy history ledger, photo binding/review state and review operation log.
- No existing photo assets/TTL/OPFS blobs are rewritten; existing personal signed
  contract remains unchanged.
- Down migration destroys binding and review history. **Do not run against real
  user data** without a backup/export and a deliberate archival migration plan.
- Photo cleanup removes associated review ciphertext only **after** S3 confirmed
  deletion, keeping tombstone replay protection.

## Codex integration guidance
This is a stacked branch from R2-09 PR #38, which is stacked on R2-08 PR #36.
Review/repair upstream branches first; propagate fixes without rewriting published
history. Test scope via `chatbot/r2-09-teams-contacts...HEAD`, never compare only
against main. The Issue remains functionally incomplete until the P0 gate above
is closed. Owner accepts mobile UX after the full production E2E.
