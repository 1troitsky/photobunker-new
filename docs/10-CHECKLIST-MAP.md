# 10. Наследование аудита и checklist старого PhotoBunker

**ЭТО ТОЛЬКО КАРТА ИСТОРИЧЕСКОГО ПРОИСХОЖДЕНИЯ ТРЕБОВАНИЙ.** Обязательные новые критерии уже перенесены в [13 — Product Acceptance Baseline](13-PRODUCT-ACCEPTANCE-BASELINE.md), [11 — Identity/Keys](11-IDENTITY-AND-KEYS.md), [12 — Storage/Time](12-CLIENT-STORAGE-AND-TRUSTED-TIME.md) и в профильные docs. Старые [AUDIT-20261028](https://github.com/1troitsky/photobunker/blob/main/docs/AUDIT-20261028.md) и [CHECKLIST](https://github.com/1troitsky/photobunker/blob/main/docs/CHECKLIST.md) читать **только при конкретном поиске старого дефекта/компонента**; их текст не является обязательным дополнением к новому Issue и не может автоматически расширить scope.

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

1. Новый нормативный baseline [13](13-PRODUCT-ACCEPTANCE-BASELINE.md) **самодостаточен**; будущие Billing/Subscriptions и Messenger подключаются через модульный Identity/User contract [11](11-IDENTITY-AND-KEYS.md) и не зависят от старых Matrix схем.
2. Legacy `original immutable` for all photos **replaced by three capture modes**. Mode 1 UI disabled, mode 3 default. See [03](03-PHOTO-STORAGE.md).
3. Legacy encrypted original/preview/thumbnail/version **not** mandatory package; only explicitly necessary derivatives in budget with lifecycle.
4. Photo local encrypted only and no system gallery, separate metadata DB, background S3 sync — mandatory.
5. Checklists §3/4/6/10 and references to chat, Messenger, voice, LiveKit excluded from new release; do not create hidden work through generic checklist compliance.
6. Исторический checklist не является подтверждением того, что функции реально работают; даты, статусы и результаты проверять по источнику, а не предполагать.

## Old-audit P0 -> hard preventive gates

- Production camera must never depend on `import.meta.env.DEV`/prototype flag.
- User screen/navigation does not await remote identity/Matrix initialization (Matrix absent).
- Tests serve actual production bundle; CI failure is a release blocker, not a green assessment.
- No file with mixed SDK/crypto/UI/storage responsibilities; enforce dependency boundaries.
- Never count green tests as manual user acceptance.
