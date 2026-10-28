# PhotoBunker New — трёхсторонний процесс / Scrumban

## 1. Источники истины

| Артефакт | Назначение |
| --- | --- |
| [README](README.md) и [docs/03](docs/03-PHOTO-STORAGE.md) | Принятые продуктовые решения, storage |
| [docs/08-ROADMAP.md](docs/08-ROADMAP.md) | **Единый** roadmap, зависимости, области и фазы |
| GitHub Issues **этого** репозитория | Полный scope, acceptance, blockers каждой задачи |
| GitHub Project **этого** проекта | Статусы, приоритет, WIP, техническая видимость |
| Pull Request | Конкретный diff, review, выполнение тестов и remaining |
| [AGENTS.md](AGENTS.md) и [CHATBOT-AGENTS.md](CHATBOT-AGENTS.md) | Постоянные правила работы агентов |
| [docs/07](docs/07-QUALITY-AND-RELEASE.md) | Гейты качества, измерения и релиз |

Никаких параллельных «планов текущего чата», копий roadmap и произвольной смены приоритетов. Project и Issues содержат текущий статус, roadmap — долгосрочные критерии. Старый repo не является рабочей очередью.

## 2. Три роли

1. **Владелец**: решения, приоритеты, утверждение открытых ST-вопросов, визуальный UX, реальная приёмка на устройстве, разрешение первого этапа разработки.
2. **ChatGPT GitHub Agent**: GitHub-only реализация одного `Ready` Issue в изолированной ветке; Draft PR с `Closes #`; не изменяет/не сливает `main`.
3. **Codex local**: проверяет `main` и PR в локальной среде, воспроизводит сценарий на production build, дорабатывает **тот же** PR, интегрирует после успешных гейтов, актуализирует Project и выдаёт следующую `Ready` задачу. Владелец может запретить merge.

Владелец не обязан каждый раз заново объяснять общий проект. Все трое читают README, AGENTS, roadmap и нужные contracts.

## 3. Project setup

Предлагаемая доска **PhotoBunker New — Development**, owner `1troitsky`, связать с `1troitsky/photobunker-new`. Поля:
- `Status`: **Backlog → Ready → In Progress → Review → Integrated → Accepted**; дополнительно **Blocked** для неразрешённых решений/зависимостей, **Cancelled** для отклонённых.
- `Priority`: P0/P1/P2; `Phase`: R2-0…R2-7; `Owner`; `Risk`: security/storage/UI/infrastructure; `Target` (optional).
- Views: Board by Status, Roadmap by Phase, Blocked/Open Decisions.
- WIP: GitHub Agent максимум 1 In Progress; Codex максимум 1 активно проверяемый Review; интеграция новой зависимости прежде следующей.

**Важно:** GitHub Projects v2 не тождественен GitHub Milestones/Issues. Пока GitHub Project не создан и связь Issues не подтверждена отдельно, считать это инструкцией настройки, а не фактом создания.

## 4. Definition of Ready

Issue допускается в Ready только если:
- есть owner-approved scope, зависимости интегрированы, OPEN ST не меняют реализацию;
- user journey, failure paths, security/storage/ACL/TTL, UI states, expected artifacts ясны;
- задача ограничена целостным outcome для одного PR; доступен тест/способ acceptance; старый код исследован как reference, но решение о reuse обосновано;
- нет скрытого требования Matrix/чатов, неясных полномочий или несовместимости;
- Codex и владелец не объявили stop.

Выписать **все Issues сразу** — нормально. Это не делает их автоматически Ready.

## 5. Цикл выполнения

1. Владелец утверждает применимые архитектурные решения и разрешает разработку; Codex выбирает незаблокированный Issue, переводит его Ready. На R2-01 обеспечить отдельный тестовый HTTPS preview из production build для ранней проверки владельцем; R2-24 — финальный deployment/release, не начало тестирования.
2. Владелец передаёт ChatGPT ссылку; ChatGPT получает актуальный main, читает инструкции, переводит In Progress, реализует в `chatbot/<task-id>-...`, открывает **Draft PR** (Closes #N).
3. Codex получает ссылку, переводит в Review, проверяет полный diff и локально запускает нужные тесты на production build, исправляет **тот же PR**.
4. Проверенный PR сливает **Codex** только после требуемых проверок и отсутствия запрета владельца; Project → Integrated.
5. **Ранние пользовательские вехи обязательны:** после R2-02 — production HTTPS preview оболочки; после R2-06 — настоящая локальная encrypted съёмка/просмотр/offline; затем S3/галерея, задания, редактор/Card, Browser/PIN. Codex выкладывает проверяемую сборку после технического Review; владелец проверяет на своём устройстве и ставит Accepted (либо возвращает дефект в Ready/Blocked). Вехи и ограничение scope прописаны в [roadmap](docs/08-ROADMAP.md). **Не ждать R2-24 для первого ручного теста и не требовать ручной приёмки каждой мелкой Issue.**
6. Следующий зависимый Issue не стартует до интеграции предпосылки; независимые задачи можно вести параллельно только без пересекающихся файлов.

## 6. Стоп-правила и проверка

- Red build, запрещённый импорт, plaintext disk write, доступ Card/Browser шире ACL, потеря несинхронизированного снимка, нарушение TTL/revoke, destructive PIN без доказательства → **stop**, не merge.
- Не менять default branch, не менять старый `photobunker`, не запускать migrations на реальных данных без review/backup.
- Мердж не равен accepted; невозможно объявить «готово» от факта наличия файлов/отчёта.
- После каждых четырёх Integrated Codex делает краткое обновление в Project: blockers/проверки/возможные архитектурные регрессии, **без метрик количества строк как цели**.
