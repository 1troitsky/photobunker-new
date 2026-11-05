# 14. Owner + Agent workflow и заменяемый UI

**Актуальное решение владельца: 2026-11-06.** В проекте два участника: владелец и один агент. Этот документ заменяет старую трёхстороннюю схему ChatGPT/Codex и stacked implementation pipeline.

## 1. Полномочия

### Владелец

- определяет продукт, приоритеты, UX, тарифы и выпуск;
- выбирает следующий крупный этап либо подтверждает предложенный агентом quick task;
- единственный присваивает UI/device статус `ACCEPTED`;
- отдельно разрешает destructive data/DB/container операции.

### Агент

- читает актуальные specification/status/problem документы до кода;
- воспроизводит проблему, реализует один ограниченный вертикальный slice и проверяет его;
- честно различает code presence, automated PASS и owner acceptance;
- обновляет документацию, коммитит и push после законченного шага;
- не меняет продуктовые правила и не объявляет release самостоятельно.

## 2. Один шаг за раз

Рабочий цикл:

1. выбрать один ID из `docs/16-OPEN-PROBLEMS-AND-QUICK-TASKS.md`;
2. зафиксировать before-state и затронутый runtime;
3. определить public contract и минимальный scope;
4. реализовать fix;
5. выполнить targeted tests/production check;
6. обновить статус и `NOT RUN`;
7. commit/push;
8. передать владельцу на проверку;
9. только после этого переходить к следующему UI slice.

Critical security work может требовать более широких тестов до показа, но тестирование не заменяет реализацию и не скрывает отсутствие пользовательского результата.

## 3. Git

- Текущая рабочая ветка задаётся в `README.md` и `docs/00-START-HERE.md`.
- `main` не менять без прямой команды владельца.
- Не force-push, не переписывать чужую историю, не удалять сохранённые ветки.
- Один commit должен иметь понятный scope и называть затронутый runtime.
- После push зафиксировать SHA в status/problem docs.

GitHub Issues/PR допустимы как task/evidence containers, но не являются обязательной сложной системой ролей. Статус Issue не доказывает готовность кода.

## 4. UI остаётся заменяемым presentation layer

Целевая связь:

```text
mobile/desktop Vue view
  -> readonly view-state / presenter
  -> typed application command/query
  -> declared ports
  -> DB/OPFS/WebCrypto/HTTP/Camera/S3 adapters
```

Запрещено размещать в UI raw DB/HTTP/crypto/S3, ACL/TTL decisions, retry/rollback ownership и persistent business state. Design tokens/primitives едины, но mobile и desktop composition могут отличаться. Замена layout не должна переписывать encryption/storage/sync.

Текущий compatibility runtime этому соответствует не полностью. Рефакторинг выполняется по вертикальным сценариям без третьего rewrite и без потери работающего server state.

## 5. Acceptance

- `IMPLEMENTED`: код существует.
- `CONFIRMED`: конкретная проверка прошла на указанном SHA.
- `OWNER FAILED`: реальное устройство владельца выявило дефект; этот статус выше автоматического PASS.
- `ACCEPTED`: владелец подтвердил результат.
- `RELEASED`: отдельно доказаны build, deployment, backup/rollback, security и device gates.

Подробные определения находятся в `AGENTS.md`.

## 6. Documentation discipline

- `ts_and_ux.md` — Technical Specification + quick tasks.
- `docs/15-*` — фактическое состояние.
- `docs/16-*` — открытые проблемы и acceptance criteria.
- `docs/history/` — старые доказательства, не текущая инструкция.

После каждого шага агент обязан обновить фактический статус; нельзя снова накапливать большой незадокументированный diff.
