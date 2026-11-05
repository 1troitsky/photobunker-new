# 08. Roadmap и фактическое состояние R2

**Обновлено: 2026-11-06.** Исторические GitHub Issues R2-00…R2-25 сохраняют требования и evidence, но больше не задают сложный ChatGPT/Codex/stacked-PR процесс. Текущую работу ведут владелец и один агент по `ts_and_ux.md` и quick-task очереди `docs/16-*`.

## 1. Как использовать этот roadmap

- Roadmap показывает крупные продуктовые области и их зависимости.
- Фактическое наличие кода не означает owner acceptance.
- Для ближайшей работы использовать `docs/16-OPEN-PROBLEMS-AND-QUICK-TASKS.md`.
- После каждого принятого шага агент обновляет этот документ и `docs/15-*`.
- GitHub Issue/PR допустимы для history/evidence, но статус Issue не является доказательством готовности.

## 2. Статусы

- `SOURCE` — реализация существует в одном из деревьев.
- `PARTIAL` — вертикальный сценарий неполон.
- `OWNER FAILED` — владелец воспроизвёл дефект на реальном устройстве.
- `MISSING` — целевой сценарий отсутствует.
- `BLOCKED` — опасная функция намеренно выключена.
- `ACCEPTED` — только после подтверждения владельца.

## 3. Фактическая карта

| Этап | Область | Состояние на handoff | Следующий критерий |
| --- | --- | --- | --- |
| R2-00 | Foundation/decisions | `PARTIAL` | Один runtime plan, актуальные owner decisions, clean-clone setup. |
| R2-01 | Workspace/build/test foundation | `SOURCE` | Final handoff branch pipeline и воспроизводимый deploy. |
| R2-02 | Shell/5 основных экранов | `OWNER FAILED` | Q1 dock/shell/PWA и глобальные mobile primitives приняты владельцем. |
| R2-03 | Anonymous Identity/Recovery Key | `SOURCE/PARTIAL` | Production migration, 8-digit ID, multi-device/recovery/security acceptance. |
| R2-04 | Encrypted local storage/trusted time | `SOURCE/PARTIAL` | Real Safari eviction/storage-full/clock rollback/crash tests. |
| R2-05 | Garage sync/TTL/cleanup | `SOURCE/PARTIAL` | Актуальный tariff TTL, bounded tombstones, live PG/Garage proof. |
| R2-06 | Production Camera | `OWNER FAILED` | Q4 permissions/GPS/assignment scope/post-capture navigation. |
| R2-07 | Gallery/NAME-ID/GPS | `OWNER FAILED` | Q5 Photo/Card/Editor open path и bounded encrypted thumbnail cache. |
| R2-08 | Assignments | `PARTIAL` | Полные presets/rules/participants, any-assignment capture, owner UX. |
| R2-09 | Teams/Contacts | `OWNER FAILED` | Contact search/card, contact-first membership, cancel/create semantics. |
| R2-10 | Assignment capture/review | `PARTIAL` | Server-enforced policy, isolated assignment Browser, no manual confirmations. |
| R2-11 | Editor modes 2/3 | `OWNER FAILED` | Local low-latency editor, text focus, arrows/stars, durable reopen. |
| R2-12 | Notes | `MISSING/PARTIAL` | Separate Photo/Assignment note contracts and scopes. |
| R2-13 | Photo Card | `OWNER FAILED` | Card separated from private gallery, map/description/scopes. |
| R2-14 | Share/export | `PARTIAL/BLOCKED` | Default direct recipient sharing with server ACL; public scoped Card. |
| R2-15 | Authorized Browser collection | `MISSING` | Server-authorized multi-assignment collection. |
| R2-16 | Browser UX | `OWNER FAILED` | Q3 classic unified files/folders architecture. |
| R2-17 | Downloads | `PARTIAL` | Scoped owner/recipient downloads, safe JPEG/ZIP and expiry. |
| R2-18 | App Lock | `OWNER FAILED` | Q2 fast unified PIN UI, timing settings and cooldown. |
| R2-19 | Local Delete | `SUPERSEDED/BLOCKED` | Отдельный Local Delete PIN удалён owner decision; local wipe входит в Emergency contract. |
| R2-20 | Emergency | `BLOCKED` | Один Emergency PIN, crash-safe local wipe, paid cloud backup proof. |
| R2-21 | UX/settings/localization | `OWNER FAILED` | Global spacing/typography/forms/settings hierarchy/English default. |
| R2-22 | Geo/map | `PARTIAL` | GPS warm-up/permission recovery/coords/status/private map widget. |
| R2-23 | Security/chaos | `PARTIAL` | Final-branch adversarial/offline/revoke/expiry/storage tests. |
| R2-24 | Deploy/backup/rollback | `PARTIAL` | Atomic releases, clean checkout, backup restore and rollback proof. |
| R2-25 | Avatars/recommendations | `PARTIAL` | Avatar crop/compression/storage and owner acceptance. |
| Billing | Tariffs/Web3/backups | `PARTIAL/MISSING` | Plan matrix, 1/6/12 pricing, DePay/NOWPayments adapters, entitlements. |
| Status | Runtime diagnostics | `OWNER FAILED` | Realtime queue/timing/errors/history with private admin diagnostics. |

## 4. Ближайшая последовательность

1. Q1 — Dock/shell/PWA update.
2. Q2 — PIN input.
3. Q3 — Browser architecture replacement.
4. Q4 — Camera/assignment/post-capture navigation.
5. Q5 — Photo/Card/Editor.
6. Затем Contacts/Teams/forms, Profile/Settings/Status, presets/GPS, billing.
7. После рабочих вертикальных путей — PB2 boundary refactor, security/expiry/backup/release gates.

Точные acceptance criteria и problem IDs находятся в `docs/16-*`.

## 5. Неизменяемые product/safety основы

- key-only Identity; email/phone только profile fields;
- encrypted local-first capture до сети;
- no automatic Photos/DCIM export;
- effective TTL фиксируется при capture и ограничивается тарифом;
- server-authoritative ACL/TTL;
- normal PIN и emergency PIN — разные secrets в одном скрытом UI;
- destructive operations остаются `BLOCKED` до recovery/ownership proof;
- legacy и `_old` используются только read-only, без массового слепого переноса.

## 6. История

Старый подробный Roadmap, inventory 101, Draft PR graph и отчёты этапов сохранены в `docs/history/2026-11-04/` и `docs/recovery/`. Они полезны как evidence, но не задают текущий процесс.
