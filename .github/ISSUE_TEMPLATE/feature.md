---
name: "Implementation task"
about: "Один законченный пользовательский результат из R2 roadmap"
title: "[R2-XX] "
labels: []
assignees: []
---

> Roadmap Issues #1–#26 уже созданы. Не создавать дубль. Новые продуктовые требования/изменение roadmap — только по решению владельца.
> **Owner decision 2026-10-29:** Implementation Ready определяется самостоятельно ChatGPT по нормативным требованиям и доступному коду upstream branches; Codex Ready Project status или merge не обязательны для разработки. [Process](../../docs/14-INDEPENDENT-DEVELOPMENT-PIPELINE.md).

**Roadmap ID / Phase / Priority:** R2-XX / R2-X / P0|P1|P2

**Implementation status:** Backlog / Implementation Ready / Implemented (Draft)
**Integration status:** Not Verified / Verified / Integrated / Accepted (proof required)

## Пользовательская цель и до/после

## Scope / Non-goals

## Dependencies (main OR unmerged upstream branches)

| Upstream Issue/PR | Branch | Verified head SHA | Needed public API |
| --- | --- | --- | --- |
| | | | |

## OPEN owner decisions (do not invent decisions)

## Data / API / storage / crypto / permissions contracts

## Legacy evidence — MUST complete before code

| Exact path in 1troitsky/photobunker | REUSE / ADAPT / REFERENCE / REJECT | Intended behavior, defects and test vectors |
| --- | --- | --- |
| | | |

> Если отсутствует: ChatGPT самостоятельно выполняет узкий read-only GitHub legacy-check и заполняет таблицу прямо в этой Issue до кода.

## Replaceable UI / UX contract

Какие typed actions/view-state предоставляет application, какие mobile/desktop layouts используют их без импортов raw DB/HTTP/crypto, какие design tokens/primitives нужны? Как проверяется смена UI без переписывания функций?

## Acceptance scenarios (implementation vs verification)

- [ ] Happy path
- [ ] Offline/reconnect/reload/lost ACK/concurrent account or device where applicable
- [ ] Error/quota/permission/TTL/revoke/ACL/crypto/no plaintext where applicable
- [ ] RU/EN, mobile 320px, desktop, keyboard/accessibility
- [ ] No new accidental persistent files, no false server ACK

## Checks actually executed / NOT RUN and risks

## Migrations / rollback / recovery / downstream impact

## PR link / head / base / merge-base / final integration note
