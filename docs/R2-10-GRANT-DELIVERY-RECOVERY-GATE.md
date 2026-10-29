# PR #41 — durable recipient share recovery and verification gate

Implementation-only repair, **not a verified release**.

## Fixed in this slice

- The original invitation outbox deleted the only locally encrypted grant secret after an ordinary signed grant rejection (403/409/etc.). That is not a safe recovery policy. Signed operation ACK or rejection now only removes/marks the relevant operation; the encrypted grant secret is preserved. Credential retirement remains a separately authorized, scoped lifecycle step.
- A successful thumbnail-key upload used to delete its only delivery record, so clicking Share again could construct a different encrypted envelope / new operation ID and trigger a permanent 409. The new acknowledged state retains the immutable signed submission and keeps the operation identity for duplicate requests. The worker never resubmits acknowledged rows.
- Dexie schema v3 adds the **unique** compound accountId+deviceId+grantId+photoId+generation index, preventing two tabs from generating distinct pending ciphertext shares for the same recipient capability. v1/v2 stores are not dropped.
- The PB2 assignment participants screen now distinguishes **server ACK** from pending/retry/conflict, not simply "queued."
- A targeted fake IndexedDB test validates unique constraints, generation/account isolation, and durable signed submission persistence after close/reopen.

## Release gate

The recipient thumbnail read feature flag remains hardcoded **false**. A signed invite does not enable media access. Before authorizing reads, must independently test exactly two actual PB2 accounts, wrong-root/device signature, missing/wrong/expired media, concurrent share and revoke, native mobile browser, page visibility, clock rollback, ACK loss, 403/409 and device rotation. Recovery semantics after loss of the sole device require product treatment; never claim account-independent recovery of local grant secrets.

**NOT RUN:** PHP/Pint/PHPUnit, pnpm/vitest/vue-tsc/build/Playwright until CI confirms actual execution. No claim of full PB1 migration parity or production readiness.

## Automated quality feedback

Read-only GitHub Actions PR validation now includes locked pnpm installation, architecture, lint, typecheck, Vitest, bundle and PHP 8.4 Composer, PHP syntax, PHPUnit. No deployment credentials, no live database mutations and no enabling recipient reads. Workflow presence is NOT proof of PASS; any CI errors require fixing in the same Draft PR.
