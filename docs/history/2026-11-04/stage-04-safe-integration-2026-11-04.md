# Этап 4 — безопасная сборка веток

Дата: 2026-11-04
Рабочий checkout: `/Users/ivan/Documents/WEB/photobunker-new/.codex-review`
Integration branch: `codex/integration-2026-11-04`
Integration SHA: `f060dd4d2333801373ae26e1a618ac59e6d43961`
Статус: локальная контрольная ветка; не опубликована, не merge-ready.

## 1. Результат

Создана отдельная локальная integration-ветка, которая объединяет:

1. полный implementation spine #53;
2. отдельную recovery/inventory documentation branch #43.

Merge-коммит имеет ровно два ожидаемых родителя:

```text
f060dd4 integration
├── 4491ee1  #53 chatbot/pb2-g5-second-device-verification
└── 15b47ce  #43 chatbot/pb1-pb2-functional-inventory
```

`main`, исходные ChatGPT-ветки и remote refs не изменялись.

## 2. Почему сборка выполнена одним merge

Весь кодовый порядок уже является ancestry tip #53:

```text
main
  → #36 Assignments
  → #38 Teams/Contacts
  → #39 Assignment Capture
  → #40 Editor
  → #42 PB2 native integration
  → #44 → #45 → #46 → #47 → #48 → #49 → #50 → #51 → #52 → #53
```

Повторный cherry-pick этих веток создал бы дублирование и конфликты. Проверка `git branch -r --merged HEAD` подтверждает, что все перечисленные implementation tips являются предками integration branch.

#43 содержит отдельную документационную историю. Её code parents также уже являются предками #53, поэтому обычный merge добавил только финальные recovery-документы без повторного применения application code.

## 3. Фактический merge diff

Добавлено 12 файлов, 2253 строки:

- `docs/recovery/00-START-HERE.md`;
- `docs/recovery/01-FUNCTIONAL-INVENTORY.csv`;
- `docs/recovery/01-FUNCTIONAL-INVENTORY.md`;
- `docs/recovery/02-RESTORATION-PLAN.md`;
- `docs/recovery/03-SCENARIO-ACCEPTANCE.md`;
- `docs/recovery/04-OWNER-DECISIONS.md`;
- `docs/recovery/05-GITHUB-ACTIONS-TRIAGE.md`;
- `docs/recovery/06-G1-STAGING-READINESS.md`;
- `docs/recovery/data/part-1.json`;
- `docs/recovery/data/part-2.json`;
- `docs/recovery/data/part-3.json`;
- `docs/recovery/visual-ux-owner-2026-10-30.md`.

В двух Markdown-файлах удалён только trailing whitespace. `git diff --ignore-all-space` подтверждает, что смысловое содержимое `docs/recovery` совпадает с #43.

Вне `docs/recovery` дерево integration merge полностью совпадает с parent #53.

## 4. Применённые меры безопасности

- Перед созданием ветки выполнен свежий `git fetch origin`; remote SHA не изменились.
- Integration branch создана от точного #53 SHA `4491ee1`.
- Documentation merge сначала выполнен через `--no-commit` и проверен.
- Конфликтов не было.
- Перед commit проверены staged names, stat и whitespace.
- У integration branch снят upstream на исходную ChatGPT-ветку, чтобы исключить случайный push не туда.
- В GitHub ничего не отправлялось.
- Force-push, rebase, history rewrite и auto-merge не применялись.
- `_old` не изменялся.
- `main` остался на `d2b9f58b507fa5cd32f8461d5248c871ad1a816e`.

## 5. Оставшиеся блокеры

Integration branch является единой версией для следующих проверок, но ещё не готова к `main`:

1. `compat/assignment-release` всё ещё присутствует как ancestry #53: 473 legacy-файла и более 67 тысяч строк. Он не импортируется native runtime, но не может попасть в финальную интеграцию без отдельного решения.
2. Architecture guard ожидаемо красный:

   ```text
   features/account/ui/ProfileScreen.vue: cross-feature deep import ../../ui-preview/application/home-preference
   ```

3. P0 TTL/tombstone и trusted-time defects из этапа 3 не исправлены.
4. Полный `pnpm`, PHPUnit, PostgreSQL/Garage и Playwright pipeline на integration SHA ещё не запускался.
5. Owner UI/device acceptance отсутствует.

## 6. Следующая контрольная точка

Этап 5 должен запускать именно `codex/integration-2026-11-04` через Colima, не OrbStack. До runtime setup запрещено удалять containers/images/volumes, запускать destructive DB-команды или менять чужой стек.

Этап 4 завершён без изменения application code, `main`, исходных веток, GitHub, `_old`, Docker, Colima, OrbStack, containers, images, volumes или данных.