# 07. Quality gates, testing, acceptance и выпуск

**Принцип:** качество не равно количеству тестов, PR или зелёному dev. С 2026-11-06 один агент реализует и проверяет небольшие вертикальные шаги, а владелец принимает UX на реальном устройстве. [14 Process](14-INDEPENDENT-DEVELOPMENT-PIPELINE.md). Основа — production-навигация, безопасные данные и сквозные сценарии. [История провала](https://github.com/1troitsky/photobunker/blob/main/docs/AUDIT-20261028.md).

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

- `Backlog / Ready` — вспомогательные Project states; фактическую очередь определяют владелец, `ts_and_ux.md` и `docs/16-*`.
- `Implementation Ready` (факт, не автоматический Project status): требования определены, owner decisions приняты, зависимости доступны в main **или stacked ветках**; нет опасного неподтверждённого предположения.
- `Implemented (Draft)`: законченная scoped реализация и один Draft PR, полный own diff и матрица фактических проверок/NOT RUN. **Не** значит Verified/Integrated/Accepted.
- `Confirmed`: агент реально проверил текущий SHA на требуемом окружении и приложил команды/evidence; это не owner acceptance.
- `Integrated`: проверенный PR действительно слит в `main` в порядке зависимостей, и downstream diff/CI актуализированы.
- `Accepted`: владелец проверил сценарий **на реальном deployed phone/desktop** и принял UX; результат записан.
- `Released`: кандидат прошёл **полный** release/security/backup/recovery/rollback gate, versioned и deployed. Accepted по одному Issue ≠ весь продукт релиз.

**NOT RUN** is an explicit state. Mock/snapshot tests do not prove camera hardware, OS gallery behavior, secure erase, E2EE recovery, or device-specific PWA.

## 3. End-to-end release matrix

| Scenario | Minimum proof |
| --- | --- |
| Identity | **R2-03:** anonymous key-only create/restore, first device without confirmation deadlock, signed challenge, 2 devices pairing/Recovery Key, partial bootstrap reload/retry, permanent-loss UX, account switch without stale decrypted UI |
| Camera | Actual iPhone/Android browser permission, take 3 photos, airplane mode, reload, view local gallery, system gallery unchanged |
| Crypto | Dexie/IndexedDB sensitive fields encrypted, OPFS encrypted blob with encrypted IDB fallback; no plaintext after save in cache/logs; readback on authorized device, corrupt/invalid data denied; actual Safari capability/persist denied |
| Storage policy | Modes 2 and 3, mode 1 UI disabled and server rejects unauthorized selection; edit replacement no persistent orphan; storage-full rollback |
| Sync/S3 | Offline queue, durable retry after browser restart, lost ACK replay exactly once, quota, tombstone prevents resurrection, read-back/restore |
| Assignments | 2 accounts, invitation/role transitions, status workflow, snapshot retention mode, denied actor, stale revision |
| Editor | Reopen after restart, undo active session, text/shape/draw, privacy flatten, original preservation/replace as required |
| Photo Card | Card-only link cannot disclose image/original/GPS/notes; TTL/revoke, metadata scope, downloads permission |
| Photo Browser | Grid/List/Tree; 1–20 assignments as specified, same membership and per-photo ACL, no bearer leakage, ZIP only permitted |
| PIN | App lock, delete preflight, emergency offline/online, crash mid-wipe, key removal, truthful cloud confirmation |
| PWA | Fresh install, reload/offline, low-storage, background/resume, safe-area, 320px mobile, desktop, RU/EN |
| Operations | Garage encrypted objects + key recovery, **24h–45d expiry**, indexed scheduler / batch deletion jobs, cascade purge originals/edits/WebP thumbnail/metadata/shares, **last trusted server time + clock rollback fail closed**, local cleanup after resume, rollback |

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

Агент выполняет один выбранный quick task, честно фиксирует `PASS/FAIL/NOT RUN`, обновляет status docs и отправляет commit до следующего шага. **UI/UX redress разрешён до Accepted:** visual redesign не должен требовать изменений domain/application/infrastructure, если функциональные требования не меняются. Владелец принимает реальное device experience.
