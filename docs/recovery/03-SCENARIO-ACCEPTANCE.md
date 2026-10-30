# Сквозные сценарии PB2: измеримая приёмка

На срезе 2026-10-30 **реальные backend/камера/S3/E2EE сквозные сценарии по-прежнему NOT RUN / NOT VERIFIED**; гостевые браузерные smoke и unit-тесты успешно запускались. Наличие теста в дереве не является PASS. Реальные UI/файлы/DB/безопасность проверяются отдельно и только на одном PB2 runtime. Матрица требований: [01](01-FUNCTIONAL-INVENTORY.md).

## Первые результаты G1: Chromium без серверного backend

Run [#41120434608](https://github.com/1troitsky/photobunker-new/actions/runs/41120434608) (PR #42, `e280d399`) действительно установил Chromium на Ubuntu 24.04, собрал PWA, выполнил Playwright: **10 passed / 5 failed / 6 intentionally skipped**. Это НЕ полноценный G1 PASS. Причины 5 ошибок:
1. Три теста локальной storage диагностики ожидали capability probe на гостевом Profile. Новый ProfileScreen прятал `StorageDiagnostics` под проверкой аккаунта. Исправление: capability probe публично доступен, но проверка server time остаётся только с аутентификацией.
2. Старый Browser E2E ждал **фиктивные** фотографии R2-02 и UI-класс `.browser-sidebar .folder-row`. Native PB2 Browser не должен показывать fake photos; E2E обновлён на fail-closed anonymous gallery/browser + create/recover links.
3. Старый mobile settings E2E ждал legacy кнопки RU/Light; native PB2 использует `<select>`. Проверка заменена реальным выбором RU/light, доступностью на 320px и сохранением после reload.

Исправление сохранено коммитом `baec69c5` в PR #42. Новый run [#41121277070](https://github.com/1troitsky/photobunker-new/actions/runs/41121277070) на момент записи **QUEUED / NOT VERIFIED**; отсутствие реального backend продолжает явно пропускать production camera, assignment, S3, 2-account security tests. Подлинные S03–S19 принимаются отдельно на HTTPS staging/Garage, не по этим smoke checks.

## Новое доказательство UI smoke (не G1 live PASS)

[Run #41124216234](https://github.com/1troitsky/photobunker-new/actions/runs/41124216234) на commit `9a596b15f1f492a980af849e1f727ee9840b928f` завершился SUCCESS: 35/35 PHPUnit, 101/101 Vitest, frontend architecture/lint/typecheck/build, **15/15 доступных Chromium smoke PASS**, ещё 6 тестов **SKIPPED** без реального HTTPS backend. Фикс расширения сетки профиля на 320px проверен повторным Chromium run. Не подменять эту проверку реальной работой с фото. [План стенда](06-G1-STAGING-READINESS.md).

## Единый формат evidence

Для каждого сценария хранить: SHA ветки, дату/устройство/браузер, подготовку аккаунта(ов), lockfile/runtime версии, шаги и полученные сообщения/HTTP статусы, локальные и серверные ciphertext/digest проверки, screenshots/video без приватных данных, тест run/log, FAIL/RETRY/PASS, review Codex и owner UX acceptance. Никаких recovery keys, PIN, GPS, DEK или чувствительных метаданных в артефактах.

## Acceptance matrix

| ID | Preconditions | Сквозной путь / позитивный результат | Негативный путь (обязательно) | Где искать реализацию | Gate |
| --- | --- | --- | --- | --- | --- |
| **S00** | Public HTTPS PB2 build | Открыть Welcome, Camera, Photos, Browser, Profile и обратно без нового origin, без белого экрана | Нет API/Matrix → shell открывается; VITE_ASSIGNMENT_RELEASE_ORIGIN не влияет | router.ts, AppShell, main.ts | G0 |
| **S01** | Empty clean browser | Create anonymous account, save recovery key, reload, close/open PWA, confirm identity restored | Неверный ключ, незавершённая регистрация, закрытый IndexedDB | features/identity | G1 |
| **S02** | Same account, two real devices | Pair second trusted device, revoke it, verify session/read denies and no stale grants | Offline revoked device, replay challenge, lost ACK | features/identity + IdentityController | G1/G5 |
| **S03** | Camera permission granted | Capture personal mode3, verified durable ciphertext, gallery opens offline after restart | Permission denied, device busy, low memory, quota reached, OS gallery trace | camera, local-storage | G1 |
| **S04** | Photo unsynced and network offline | Open editor, draw/text, save new encrypted rendition, reload, see edit before cloud ACK | Crash between encrypted write/DB transaction, double edit, account switch | editor, vault, photo-sync | G1 |
| **S05** | S04 committed offline + no network | Reconnect, upload **original snapshot first**, check checksum/receipt, then edit CAS, no duplicate/overwrite | Lost ACK, S3 503, retry 409, stale late original receipt, orphan object | vault.deliver, syncEdit, PhotoEditController | G1 |
| **S06** | Existing mode2 and mode3 photos | Edit mode2 -> original retained, mode3 -> old master replaced only after durable new one, reload/expiry safe | Interrupted deletion, missing OPFS fallback, backend readback mismatch | editor, vault, PhotoEditController | G1 |
| **S07** | Photo with TTL near expiry | Expire while app hidden, reopen → blocked, safe GC locally/server S3; old URLs no longer read | Wall-clock rollback, delayed ACK, page cache, double scheduler job | vault, trusted-time, PhotoSync | G1/G5 |
| **S08** | Two locally created photos | Gallery search/title/GPS, open Card, browse folders and user-triggered ZIP | Declined GPS, malformed JPEG, file too large, account switch mid-export | gallery, photo-card, photo-browser | G1/G4 |
| **S09** | Owner account | Create assignment, edit, duplicate, status transitions, delete/archive, reload | Lost server ACK, CAS conflict, invalid dates, unauthorized transition | assignments | G2 |
| **S10** | Assignment with selected preset | Create/edit preset (ratio/resolution/metadata/GPS), use from assignment, capture, frozen version survives edit of preset | Delete referenced preset, required GPS absent, unsupported camera size | studio PB1 reference; camera/assignments PB2 target | G2 |
| **S11** | Assignment required tags + description | Before shooting capture/source metadata enforces categories/description min length, notes remain encrypted | Forbidden tags, empty description, malicious bypass API | studio/model PB1; PB2 new domain policies | G2 |
| **S12** | Assignment with targetCount | Save photos offline; show local/pending vs server-confirmed count, progress percent without hard capture cap | Lost/double ACK, multi-device count, targetCount 1 and 9999 | assignments, photo sync | G2 |
| **S13** | Accounts A and B, optional Team | A creates team, invites B; B accepts; roles visible to both, grants unrelated by default | Revoke invite/member; B cannot read photo without separate grant | collaboration + CollaborationController | G3 |
| **S14** | A owns photo and in-progress assignment, B invited | A grants thumbnail, B accepts with out-of-band pinned owner key, server confirms ciphertext delivery; B decrypts only permitted thumbnail | Wrong root/device signature, rebind, replay, stolen code, missing key, 403, 409, 410, revoke/expiry | photo-grants + PhotoRecipientController | G3 |
| **S15** | S14 verified, owner revokes B | Revoke blocks new manifest/ciphertext/download and cached unauthorized access; no original/metadata leaks | Lost revoke ACK, multi-tab cached content, device revoked | RecipientGrantAccess, photo-grants | G3 |
| **S16** | 2 assignments, mixed roles | Create protected Browser collection; B sees only allowed assignment thumbnails, list updates on revoke | Browser URL tamper, partial revoke, title/GPS/metadata leak, unauthorized ZIP | PB1 photo-browser; new protected Browser | G4 |
| **S17** | Owner photo with public-share policy | Create card-only link for safe flattened photo, optionally permit original/download scopes explicitly | Expired/revoked link, wrong share secret, unsafe original, metadata overexposure | PB1 card-shares; PB2 card target | G4 |
| **S18** | PIN enabled, device offline | App lock prompt and relock; local-delete preflight preserves cloud recoverability | PIN retry/cooldown, quota, unsynced data, wrong PIN, other device survives | PB1 app PIN reference; PB2 new feature | G5 |
| **S19** | Emergency PIN configured, no connection | Emergency immediately denies local access, journals signed remote revoke/delete intent, later ACK verified | Crash in middle, repeated emergency PIN, lost ACK, account recovery ambiguity | PB1 emergency reference; PB2 new feature | G5 |
| **S20** | RU/EN + mobile/desktop | Nav/dock/header, launch preference, new profiles and settings, screen reader and touch | Long labels, keyboard obscures text, reduced-motion/system theme | ui-preview + account | G6 |
| **S21** | Recovered cloud data + user consent | Restore authorized keys and encrypted photo access, user sees accurate backup/usage info | Missing key, revoked device, expired ciphertext, only local unsynced copy | Identity, storage, policy | G5 |
| **S22** | Production build/artifacts available | No PB1 Matrix/bootstrap code in loaded PB2 bundle, no plaintext local photo media or recovery tokens in logs | Offline initial start, wrong environment origin, tampered S3 object | architecture/release checks, local-storage | G0–G5 |

## Приёмка versus тест наличия кода

Каждому тесту нужны **(1) unit/domain proof**, **(2) adapter/contract proof**, **(3) реальный E2E по UI и API** там, где это необходимо, и **(4) ручная UX приёмка** для ключевых экранов. Не переводить строку таблицы в `Verified` из-за зелёного Vitest при выключенном recipient flag. Не включать флаг `recipient_thumbnail_reads_enabled` до S14/S15 с независимым review. Для S18–S19 нужна отдельная безопасность destructive PIN.

## Порядок проверки после восстановления runner

0. Сначала запустить G0 и сохранить фактические логи каждого failed шага.
1. S00/S01/S03/S04/S05/S06/S07/S08 — один аккаунт и разрешённое локальное фото.
2. S09–S12 — полные задания/пресеты.
3. S13–S16 — два аккаунта и server-authoritative ACL.
4. S17–S22 — публичные scoped shares, recovery/security, UI и релизный hardening.
