# 10. Наследование аудита и checklist старого PhotoBunker

**Проверяемые источники:** [AUDIT-20261028.md](https://github.com/1troitsky/photobunker/blob/main/docs/AUDIT-20261028.md), [CHECKLIST.md](https://github.com/1troitsky/photobunker/blob/main/docs/CHECKLIST.md). Прочесть первоисточник при работе над связанной функцией. Старый checklist содержал Messenger/Matrix и порядок работ, который **не является roadmap PhotoBunker New**.

| Old checklist | Статус в новом scope | Где учитываем |
| --- | --- | --- |
| §0 общие правила | Adapting | AGENTS, 07 Quality |
| §1 геолокация | In scope | 04 Domain, Roadmap Camera/Metadata |
| §2 NAME-ID | In scope | 04 Domain, Roadmap Metadata |
| §3 вложения в сообщениях | **Out of scope** | Messenger absent |
| §4 Team/Assignment group chats | **Out of scope** | No Matrix; Teams and Assignments still exist |
| §5 Team profile | In scope | Roadmap Teams |
| §6 Presence | **Out of scope** | No Messenger/real-time presence in v1 |
| §7 Notes к фото/заданиям | In scope, lower priority | Domain & roadmap Notes; never Card description |
| §8 5 статусов заданий | In scope | 04 Domain, roadmap Assignments |
| §9 RU/EN (+future-ready) | In scope | 06 UX, roadmap Shell/Polish |
| §10 calls/RTC | **Out of scope** | No LiveKit/MatrixRTC |
| §11 three separate PINs | In scope | 05 Security, roadmap Security |
| §12 editor text/brush/pencil/shapes | In scope | 06 UX, roadmap Editor |
| §13 Photo Card | In scope | 04 Domain/05 Security/roadmap Card |
| §14 Photo Browser | In scope; download ZIP only separate verified gate | 04 Domain/05 Security/roadmap Browser |
| §15 Welcome/Onboarding | In scope; wording must **omit messenger/communication promises** | 06 UX, roadmap Shell |
| §16 recommendations | In scope P2 only | UX/roadmap Polish |
| §17 Settings | In scope, remove Messenger-only | UX/roadmap Settings |
| §18 avatars Team/person | In scope P2 | Roadmap Team/Polish |
| §19 geolocation sorting/geo map | In scope P2, privacy gated | Roadmap Geo UX |
| §20 quality | Mandatory everywhere | 07 Quality |
| §21 report format | Mandatory everywhere | 07 Quality, PR template |

## Specific contradictions resolved by owner decisions

1. Legacy `original immutable` for all photos **replaced by three capture modes**. Mode 1 UI disabled, mode 3 default. See [03](03-PHOTO-STORAGE.md).
2. Legacy encrypted original/preview/thumbnail/version **not** mandatory package; only explicitly necessary derivatives in budget with lifecycle.
3. Photo local encrypted only and no system gallery, separate metadata DB, background S3 sync — mandatory.
4. Checklists §3/4/6/10 and references to chat, Messenger, voice, LiveKit excluded from new release; do not create hidden work through generic checklist compliance.
5. Исторический checklist не является подтверждением того, что функции реально работают; даты, статусы и результаты проверять по источнику, а не предполагать.

## Old-audit P0 -> hard preventive gates

- Production camera must never depend on `import.meta.env.DEV`/prototype flag.
- User screen/navigation does not await remote identity/Matrix initialization (Matrix absent).
- Tests serve actual production bundle; CI failure is a release blocker, not a green assessment.
- No file with mixed SDK/crypto/UI/storage responsibilities; enforce dependency boundaries.
- Never count green tests as manual user acceptance.
