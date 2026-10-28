# 07. Quality gates, testing, acceptance и выпуск

**Принцип:** качество не равно количеству тестов, PR или зелёному dev. Основа — production-навигация, безопасные данные и сквозные сценарии, воспроизводимые независимой проверкой. [История провала](https://github.com/1troitsky/photobunker/blob/main/docs/AUDIT-20261028.md).

## 1. Автоматические гейты — обязательны для каждого relevant PR

1. Lint/format/typecheck, reproducible lockfile, static analysis.
2. Import-boundaries и dependency cycles with **negative fixtures** that fail build when violated. UI cannot import raw SDK/storage. Prohibited Matrix/LiveKit/legacy plain-storage code in new bundle.
3. Domain unit tests: storage modes 1/2/3, assignment status/roles, ACL, TTL, NAME-ID, metadata projections, local state machine.
4. Adapter/contract tests: Laravel JSON schema/errors, S3 encrypted bytes/checksum/quota, browser storage, key formats and migrations, idempotency/CAS.
5. Fault injection: offline, lost ACK, partial upload, quota exceeded, crash mid-encrypt/write/replace, expired/revoked access, stale requests, concurrent edit, account/device switch, partial deletion; background retry and idempotency.
6. **Production build** in CI, serve built artifacts (not Vite dev), run Playwright/other browser E2E against it with test Laravel + storage stack. Include camera permission mocks/device fixtures, and run real-device test before Accepted.
7. Accessibility, responsive, RU/EN, content security policy, dependency/license/security scan, no secret logs.
8. For APIs/storage mutations: backend authz tests, multi-user permission matrix, no plaintext metadata leakage and cleanup verification.

## 2. Definition of Done: separate proof levels

- `Backlog`: defined, may have open owner decisions.
- `Ready`: complete acceptance, decisions closed, dependencies integrated.
- `Review`: single Draft PR handed over; evidence may still be missing.
- `Integrated`: reviewed diff + verified build/target test/production E2E for scope, changed code merged by authorized Codex. No known P0 breach.
- `Accepted`: owner performed scenario **on real deployed phone/desktop**, result recorded; includes honest caveats.
- `Released`: candidate passes **release gate** and rollback/backup drill, versioned and deployed. Accepted for individual Issue ≠ entire product release.

**NOT RUN** is an explicit state. Mock/snapshot tests do not prove camera hardware, OS gallery behavior, secure erase, E2EE recovery, or device-specific PWA.

## 3. End-to-end release matrix

| Scenario | Minimum proof |
| --- | --- |
| Identity | Account create/sign-in, safe recovery, 2 devices, logout, account switch, no stale decrypted UI |
| Camera | Actual iPhone/Android browser permission, take 3 photos, airplane mode, reload, view local gallery, system gallery unchanged |
| Crypto | No plaintext after save in IDB/OPFS/cache/logs; decrypt on authorized device; corrupt/invalid data denied |
| Storage policy | Modes 2 and 3, mode 1 UI disabled and server rejects unauthorized selection; edit replacement no persistent orphan; storage-full rollback |
| Sync/S3 | Offline queue, durable retry after browser restart, lost ACK replay exactly once, quota, tombstone prevents resurrection, read-back/restore |
| Assignments | 2 accounts, invitation/role transitions, status workflow, snapshot retention mode, denied actor, stale revision |
| Editor | Reopen after restart, undo active session, text/shape/draw, privacy flatten, original preservation/replace as required |
| Photo Card | Card-only link cannot disclose image/original/GPS/notes; TTL/revoke, metadata scope, downloads permission |
| Photo Browser | Grid/List/Tree; 1–20 assignments as specified, same membership and per-photo ACL, no bearer leakage, ZIP only permitted |
| PIN | App lock, delete preflight, emergency offline/online, crash mid-wipe, key removal, truthful cloud confirmation |
| PWA | Fresh install, reload/offline, low-storage, background/resume, safe-area, 320px mobile, desktop, RU/EN |
| Operations | Backup/restore encrypted blob + key access, monitoring no plaintext, retention sweeps/cleanup, rollback |

## 4. Release fail/stop policy

**No-Go:** camera disabled in prod, fail-open ACL, plaintext persistent photo, auto-save to system gallery, loss of unique unsynced copy, missing key recovery for promised device, wrong storage policy, unbounded or undeletable orphan assets, broken local erase/emergency flow, red/unexecuted critical CI, inaccessible core screen, irreversible migration without backup.

No-Go means do not label `production-ready`. Feature can be explicitly excluded by scope if it does not affect promised invariant (e.g. Matrix excluded entirely).

## 5. Report / PR evidence

- task ID and code SHA/merge-base;
- exact commands/environment/results, production artifact hash if built;
- one happy and at least one failure path trace;
- storage before/after (photo assets, orphan count, byte usage) for photo PR;
- security/ACL/metadata impact and migrations;
- screenshots/recordings when available, device/browser versions;
- **NOT RUN**, known issues and rollback;
- conclusion: READY FOR REVIEW, INTEGRATED or ACCEPTED **with actor and evidence**.

No author can self-approve security-sensitive changes; Codex independently tests in running environment, owner accepts device experience.
