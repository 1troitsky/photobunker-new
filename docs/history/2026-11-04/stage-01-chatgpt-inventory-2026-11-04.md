# Этап 1 — инвентаризация работы ChatGPT

Дата проверки: 2026-11-04
Репозиторий: `1troitsky/photobunker-new`
Статус документа: фактическая Git/GitHub-инвентаризация; это ещё не code review, runtime verification или UX acceptance.

## 1. Источники и свежесть

- Основные локальные требования этапа: `info-04-11-2026.md` и `visual-ux.md`; оба файла прочитаны полностью.
- Правила `AGENTS.md`, актуальные `README.md`, `COLLABORATION.md`, `CHATBOT-AGENTS.md`, Roadmap и процесс stacked PR сверены с `origin/main`.
- Выполнен свежий `git fetch` всех remote branches и tags без изменения `main`.
- Актуальный `origin/main`: `d2b9f58b507fa5cd32f8461d5248c871ad1a816e`, 2026-10-29, merge PR #37.
- Свежие PR, Issues и GitHub Actions получены из GitHub API 2026-11-04.
- Рабочий каталог `/Users/ivan/Documents/WEB/photobunker-new` сам по себе не является Git checkout. Корректный checkout находится в `.codex-review` и на момент инвентаризации чист.
- `_old` рассматривается только как read-only локальная копия legacy. Его содержимое в рамках этапа 1 не изменялось и глубоко не анализировалось.

## 2. Что уже интегрировано в main

| PR | Результат | Статус |
| --- | --- | --- |
| #27 | R2-01: workspace, production build/test foundation | merged |
| #28–#29 | обязательный issue-scoped legacy evidence | merged |
| #30 | R2-02: UI foundation и пять основных экранов | merged |
| #31 | R2-03: anonymous key-only Identity и trusted devices | merged |
| #32 | R2-04: Dexie/OPFS, encrypted local storage, trusted time | merged |
| #33 | R2-06: production camera и encrypted local capture | merged |
| #34 | R2-05: Garage S3 sync, receipts, TTL и orphan GC | merged |
| #35 | R2-07: gallery, NAME-ID, WebP thumbnails, metadata/GPS | merged |
| direct `ada1711` | изоляция Identity/Photo rate limits | в main после #35 |
| #37 | independent implementation pipeline / replaceable UI | merged, текущий tip main |

Для точных head SHA PR #30–#35 в текущей истории GitHub Actions нет сохранённых workflow runs. Факт merge не заменяет повторную независимую проверку на текущем окружении.

Issue #3 (R2-02) при этом всё ещё открыт, хотя PR #30 уже merged. Это несогласованность GitHub-статуса, а не отсутствие кода.

## 3. Фактический граф незалитой работы

```text
main d2b9f58
  └─ #36 R2-08 Assignments
      └─ #38 R2-09 Teams/Contacts
          └─ #39 R2-10 Assignment Capture (изначально partial/P0)
              └─ #40 R2-11 Editor
                  └─ #41 legacy compatibility consolidation (superseded)
                      └─ #42 PB2 native integration (supersedes #41)
                          ├─ #43 101-feature inventory/docs (параллельная ветка)
                          └─ #44 startup preference
                              └─ #45 Browser multiselect
                                  └─ #46 Browser owner workflows
                                      └─ #47 G5 safety readiness
                                          └─ #48 App Lock
                                              └─ #49 delete/emergency PIN preparation
                                                  └─ #50 signed device revocation
                                                      └─ #51 post-ACK credential cleanup
                                                          └─ #52 ownership audit
                                                              └─ #53 second-device verification
```

В tip #53 входят #36, #38–#42 и #44–#52. PR #43 не является предком #53 и должен учитываться отдельно.

## 4. Open Draft PR — фактический scope

Количество коммитов и файлов рассчитано по фактическому `base...HEAD`, а не взято из текста PR.

| PR | Base → Head | Собственный diff | Что находится в исходниках | Проверка |
| --- | --- | ---: | --- | --- |
| #36 | `main` → `r2-08` | 2 commits, 21 files, +1313/-85 | Assignments domain/API/Dexie/UI, migration, PHP/Vitest/E2E tests | authored, NOT RUN; PR body содержит устаревший ранний head |
| #38 | `r2-08` → `r2-09` | 1 commit, 20 files, +1570/-1 | contacts/teams/invitations/roles, encrypted client store, API/migration/tests | authored, NOT RUN |
| #39 | `r2-09` → `r2-10` | 2 commits, 26 files, +1126/-41 | frozen assignment capture, PhotoSync v2, review, bindings/migration/tests | изначально partial/P0; authored, NOT RUN |
| #40 | `r2-10` → `r2-11` | 2 commits, 23 files, +1515/-18 | editor, mode 2/3 replacement, cleanup journal, API/migration/tests | authored, NOT RUN |
| #41 | `main` → legacy consolidation | 65 commits, 607 files, +76437/-243 | ранний PB2 stack плюс массовый compatibility snapshot старого приложения | superseded by #42; exact-head CI failure |
| #42 | `main` → PB2 native integration | 222 commits, 634 files, +79350/-294 | native PB2 integration, assignments, sharing, browser/card, editor, CI/E2E; сохраняет `compat/` | current head CI success; не device/release accepted |
| #43 | #42 → inventory docs | 5 commits, 12 files, +2253 | 101-row inventory, 23 scenarios, restoration plan, owner decisions | docs-only; no exact-head Actions run; не входит в #53 |
| #44 | #42 → startup | 5 commits, 5 files, +74/-2 | device-only startup section preference | tests authored, no Actions run |
| #45 | #44 → multiselect | 3 commits, 3 files, +86/-8 | bounded visible selection and owner ZIP export | tests authored, no Actions run |
| #46 | #45 → browser workflows | 8 commits, 5 files, +161/-40 | Grid/List/Tree, viewer/card navigation, safe JPEG/ZIP export | tests authored, no Actions run |
| #47 | #46 → safety readiness | 7 commits, 7 files, +247 | read-only data-safety inventory and disabled destructive controls | tests authored, no Actions run |
| #48 | #47 → App Lock | 16 commits, 9 files, +401/-8 | device PIN gate, cooldown, cross-tab/background lock | tests authored, no Actions run |
| #49 | #48 → device intents prep | 22 commits, 18 files, +340/-9 | distinct local-delete/emergency PIN verifiers and cross-feature inventory | destructive action disabled; no Actions run |
| #50 | #49 → revocation protocol | 23 commits, 12 files, +520/-1 | signed idempotent server self-revocation and durable client replay | tests authored, no Actions run |
| #51 | #50 → revoked cleanup | 17 commits, 15 files, +348/-10 | post-ACK exact-device PIN cleanup/status; ciphertext retained | tests authored, no Actions run |
| #52 | #51 → ownership audit | 24 commits, 14 files, +380/-16 | nine-store ownership inventory; only targeted trusted clock removable | tests authored, no Actions run |
| #53 | #52 → second-device verification | 34 commits, 14 files, +854 | fresh cloud ciphertext re-download/decrypt and signed per-asset attestation | tests authored, NOT EXECUTED |

## 5. Полный текущий tip

Текущий максимальный implementation tip:

- branch: `chatbot/pb2-g5-second-device-verification`;
- SHA: `4491ee16478a0c3c6180f07379b790060a692e37`;
- против `main`: 381 commits, 672 files, +82674/-301;
- все 381 commit subjects и их последовательность просмотрены;
- дополнительно просмотрены 5 отдельных documentation commits PR #43.

Распределение cumulative diff #53 против main:

| Область | Файлы | Добавления/удаления |
| --- | ---: | ---: |
| `compat/assignment-release` | 473 | +67152/-0 |
| `apps/api` | 46 | +4100/-17 |
| `apps/web` | 131 | +10115/-273 |
| `docs` | 14 | +677/-0 |
| `tests` | 3 | +322/-10 |
| `.github` | 1 | +297/-0 |
| other | 4 | +11/-1 |

Главный структурный риск: около 70% изменённых файлов и более 80% добавленных строк — массовый legacy snapshot в `compat/assignment-release`. Он заявлен как изолированный и не является текущим native runtime, но противоречит целевому принципу «без массового переноса legacy» как минимум на уровне состава будущего merge. Интегрировать #42/#53 без отдельного решения по `compat/` нельзя.

## 6. Проверки и доказательства

### Что действительно подтверждено GitHub Actions

Текущий head PR #42 `7b2e929516052ce8ff7986251436211a59b17bfe`:

- run `41171751458` — success;
- Laravel PHP 8.4 + PHPUnit — success;
- Vue/TypeScript/architecture/unit/production bundle — success;
- disposable PostgreSQL 18 + Garage S3 integration — success;
- job содержит реальный сценарий двух Chromium identities, Laravel/Garage и E2EE decryption — success;
- Chromium production bundle smoke — success.

Это сильное интеграционное доказательство для exact SHA #42, но не для последующих PR #44–#53.

### Что не подтверждено

- Exact heads #36, #38–#40 и #43–#53 не имеют Actions runs.
- Финальный tip #53 не проходил полный pnpm/PHP/DB/Garage/Playwright pipeline.
- Нет owner acceptance и проверки текущего tip на реальных iOS/Android устройствах.
- Нет подтверждения финального HTTPS staging, Colima runtime и полного legacy parity.
- App Lock и G5 deletion/recovery изменения после #42 не прошли независимый security review.
- Local Delete и Emergency Delete намеренно не реализуют широкое удаление; `permitted:false` остаётся safety invariant.

## 7. Issues и несоответствия процесса

- Closed: #2 и #4–#8.
- Open: #1, #3 и #9–#26.
- #36/#38/#39/#40 связаны с Issues #9–#12 через `Closes`.
- #44–#53 не являются нормальными `r2-XX` PR и не закрывают Roadmap Issues. Они реализуют части Browser/PIN/recovery задач отдельными gap-ветками.
- #41 всё ещё открыт, хотя явно superseded by #42.
- #43 — важная матрица требований, но находится вне актуального implementation spine.
- Тексты нескольких PR отражают промежуточные SHA и промежуточные риски; фактические Git ancestry/diff/Actions должны иметь приоритет.

## 8. Что фактически собрано функционально

В native PB2 source присутствуют реализации следующих крупных блоков:

- anonymous PB2 Identity, trusted devices и Recovery Key;
- encrypted local storage, trusted time, camera, Gallery и S3 sync;
- Assignments, Teams/Contacts, assignment-bound capture и review;
- editor modes 2/3;
- private Photo Browser/Card, owner JPEG/ZIP export;
- explicit assignment grants и recipient encrypted-thumbnail sharing;
- server ACL и tested two-browser E2EE slice на SHA #42;
- startup preference;
- App Lock;
- подготовительные Local Delete/Emergency PIN credentials;
- signed device revocation, narrow post-ACK cleanup and ownership inventory;
- second-device recovery attestation.

Не следует считать готовыми только по наличию кода:

- полное соответствие 101 legacy-сценарию;
- Notes и полноценные Photo Card/share/browser scopes из R2-12–R2-17;
- настоящий device-scoped Local Delete и Emergency workflow;
- OPFS orphan enumeration;
- production enablement recipient reads;
- финальный UI/UX, camera/device QA, backup/restore/rollback и release gates.

## 9. Топологический порядок дальнейшей сборки

Фактический порядок кода:

1. `main @ d2b9f58` как проверяемый baseline.
2. #42 как текущий объединённый PB2-native integration root, потому что он уже содержит #36/#38/#39/#40/#41 и исправления первоначального P0 sharing gap.
3. Сохранить и перенести документационные артефакты #43 на актуальный integration state; не потерять 101-row inventory и 23 scenarios.
4. Последовательно проверять #44 → #45 → #46 → #47 → #48 → #49 → #50 → #51 → #52 → #53 по собственному `base...HEAD`.
5. До любого merge решить судьбу 473 файлов `compat/`: не делать их целевым runtime и не переносить старый монолит в новую архитектуру.
6. После архитектурной и runtime-проверки собирать отдельную integration branch; `main` до контрольной точки не менять.

Нельзя независимо сливать #36–#41, а затем поверх вслепую применять #42: #42 уже содержит их ancestry и множество более поздних исправлений. Нельзя также считать #53 полной документационной вершиной, потому что #43 в него не входит.

## 10. Вывод этапа 1

Работа ChatGPT не потеряна и имеет один фактический основной spine, но она не готова к прямому merge:

- основной native PB2 код сосредоточен в #42 и его потомках #44–#53;
- #42 имеет реальный зелёный интеграционный CI на exact head;
- финальный tip #53 после этого CI не проверялся;
- #43 содержит обязательную функциональную матрицу отдельно от spine;
- `compat/` создаёт большой архитектурный и интеграционный риск;
- GitHub Issues/PR структура частично разошлась с утверждённым one-Issue/one-PR процессом.

Следующий этап должен начинаться не с merge, а с нормативной/legacy-сверки: проверить 101-row inventory, последний legacy audit и фактический `_old`/GitHub код, затем сформировать матрицу `готово / частично / отсутствует / неправильно`.