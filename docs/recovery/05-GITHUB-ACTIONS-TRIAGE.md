# GitHub Actions: историческая ошибка runner и подтверждённый G0

**Обновление, 2026-10-30:** причина первых 5 pre-run отказов не установлена, но ручной rerun получил runner и реальные логи. Ниже — зафиксированная историческая неисправность; далее смотрите подтверждённые G0 результаты.

## Обновление G0 после аудита — реальный зелёный CI

**Факт:** [GitHub Actions #41119814724](https://github.com/1troitsky/photobunker-new/actions/runs/41119814724) завершился **SUCCESS** для PB2 PR #42 (commit `1e0dc0694cb17f0d20c1c5831637feed99b67f20`).
- Получены настоящие GitHub runners: issue pre-run больше не блокирует тесты. Причина пяти исходных transient failures так и не установлена.
- `pnpm test:architecture` (включая negative fixtures), `pnpm lint` (0 errors, 1161 warnings), `pnpm typecheck`, `pnpm test:unit` (101/101), `pnpm build` — **PASS**.
- PHP syntax, PHPUnit (35/35) — **PASS**.
- Исправлены конфликт private `TestCase::be`, 401-vs-422 contract test, типы AES/receipt, вызовы `window` в тестовом Node и правила границ модулей. **Проверено по CI**, а не только из исходников.
- Поверх этого G0 добавлена отдельная ступень `browser` на Playwright Chromium. Первый [run #41120153684](https://github.com/1troitsky/photobunker-new/actions/runs/41120153684) выявил несовместимость locked Playwright 1.56.1 и выбранной GitHub Ubuntu 26.04; job закреплён на `ubuntu-24.04` в commit `e280d399`. Реальная browser E2E проверка **не стала автоматически VERIFIED**.
- **P0 STOP:** `recipient_thumbnail_reads_enabled=false`; полная фото-миграция PB1→PB2 и живые двухаккаунтные E2E не завершены. Build success означает только исходный G0, не готовность продукта.


**Исторические факты до удачного rerun.** В первых пяти попытках PHP/Vitest/typecheck действительно **не запускались**.

## Проверенные GitHub API evidence

Репозиторий `1troitsky/photobunker-new` публичный (`private:false`). Доступный workflow [pb2-draft-quality.yml](https://github.com/1troitsky/photobunker-new/blob/13fdfbd7a74346a585a301f039259e4f56b348c8/.github/workflows/pb2-draft-quality.yml) имеет 2 обычных `runs-on: ubuntu-latest` jobs. Оба шага выполняют checkout/install/checks **только после выдачи runner**.

| Run | SHA / PR | PHP job | Web job | Деталь |
| --- | --- | --- | --- | --- |
| [40973883768](https://github.com/1troitsky/photobunker-new/actions/runs/40973883768) | #41 (0ef81a22) | FAILURE | FAILURE | runner_id=0; steps=[]; ~2–3s |
| [40974345015](https://github.com/1troitsky/photobunker-new/actions/runs/40974345015) | #41 (707cb04e) | FAILURE | FAILURE | runner_id=0; steps=[]; ~2s |
| [40978886264](https://github.com/1troitsky/photobunker-new/actions/runs/40978886264) | #42 (bcb85788) | FAILURE | FAILURE | runner_id=0; steps=[]; ~2s |
| [40979077388](https://github.com/1troitsky/photobunker-new/actions/runs/40979077388) | #42 (33d794aa) | FAILURE | FAILURE | runner_id=0; steps=[]; ~2–3s |
| [40979416867](https://github.com/1troitsky/photobunker-new/actions/runs/40979416867) | #42 (13fdfbd7) | FAILURE | FAILURE | runner_id=0; steps=[]; 00:23:47–00:23:49 UTC |

**Повторяемый сигнал:** 10/10 jobs имеют пустое `runner_name`, `runner_id=0`, `steps=[]`, нет checkout/install/test, нет artifacts. Запросы job logs отвечают `404 BlobNotFound`. Это **симптом отсутствующей выдачи runner / pre-step failure**; не доказывает корневую причину (billing, policy, GitHub dispatch или validation). Изменение PHP/Vue кода в такой ситуации не может сделать уже не исполненные тесты PASS.

Документация GitHub: [Viewing workflow run logs](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs). В похожих публичных обращениях встречается сочетание `runner_id=0` и `BlobNotFound` — это сопоставление симптомов, не диагностика нашего репозитория.

## Проверить в браузере владельца, не меняя application

1. Открыть **Actions → PB2 Draft quality gate → run 40979416867 → каждый job**. Сохранить точный текст всплывающего красного баннера/`annotations` в общий отчёт, без токенов. Убедиться, что действительно нет `Set up job`.
2. В **Settings → Actions → General** проверить разрешение Actions, allowed actions, ограничения организации, workflow permissions. `permissions: contents: read` в YAML нужно для checkout и не должно требовать write.
3. В настройках **Billing/Usage/Actions** проверить доступность GitHub-hosted runners, spending limit, верификацию аккаунта и возможную блокировку. Репозиторий публичный — не делать автоматический вывод об истощении private minutes.
4. Проверить статус [GitHub Actions](https://www.githubstatus.com/) за указанное время и возможные account-level notifications.
5. Проверить, что YAML валиден и оба jobs используют доступную label `ubuntu-latest`, без запрещённой policy; добавить минимальный runner smoke лишь **после** выяснения баннера. Не создавать новый PR только ради повторения того же pre-step failure.
6. Если оба jobs опять имеют `runner_id=0`, обратиться в GitHub Support с run/job IDs, UTC временем и отсутствием steps/logs. Не утверждать, что это баг приложения.

## Как собирать реальные ошибки после восстановления runner

**В корне PB2** (Node 22, pnpm 10.20.0):

~~~bash
pnpm install --frozen-lockfile
pnpm test:architecture
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
pnpm test:browser
~~~

**В `apps/api`** (PHP 8.4, Composer):

~~~bash
composer install --no-interaction --no-progress --prefer-dist
find app tests database -name '*.php' -print0 | xargs -0 -n1 php -l
php vendor/bin/phpunit
~~~

Реальный запуск тестов **NOT RUN** в данной сессии. Проверено только присутствие `pnpm-lock.yaml`, `apps/api/composer.lock`, `apps/api/phpunit.xml`, `tools/architecture/check.mjs` и workflow.

**Следующий шаг после прохождения G0:** собирать stdout/stderr по отдельным командам с exit code, закрывать ошибки в PR #42 (а не в документационном PR) и добавлять точные regression tests. В workflow уже предусмотрены short-retention log artifacts при завершении шагов; сейчас artifacts отсутствуют, потому что ни один шаг не начался.

## Проверка после возобновления Actions

- Новый run показывает непустой runner name/id; в job есть `Set up job`, `actions/checkout`, install, test steps.
- Если setup/install падает — фиксировать настоящую причину (lock, Composer, PHP ext, cache, runner image). **Не смешивать** с прежней pre-step ошибкой.
- При зеленом CI это **ещё не** заверенная E2EE/TTL/Local-First функциональность; отдельно проходить S00–S22 в [03](03-SCENARIO-ACCEPTANCE.md).
- Этот docs-only stacked PR имеет base ветку PR #42. Его собственный push не обязан запускать workflow с `on.pull_request.branches:[main]`; это ожидаемо, а не PASS.
