# Требуются решения владельца — не менять контракты молча

**Источник ожиданий:** [visual-ux владельца от 2026-10-30](visual-ux-owner-2026-10-30.md). **Действующий технический baseline:** PB2 [03 storage](../03-PHOTO-STORAGE.md), [11 Identity](../11-IDENTITY-AND-KEYS.md), [13 Product Acceptance](../13-PRODUCT-ACCEPTANCE-BASELINE.md), [05 Security](../05-SECURITY.md). В случае конфликта код нельзя переписывать автоматически. Это список вопросов, **не предложение откладывать базовую работоспособность**.

| ID | Новая owner-спецификация | PB1 исходники / прежняя реализация | Утверждённый PB2 baseline | Что необходимо решить | Блокирует |
| --- | --- | --- | --- | --- | --- |
| **D01 TTL** | Camera 1/3/12 часов, Never, custom; SaaS Pro 60d, Unlimited бессрочно | studio/model.ts, ProfileEditView, profiles/model | 24h–45d и обязательное удаление всех ciphertext/cloud/caches | Подтвердить 24h–45d или новый срок с переработкой cleanup/стоимости/безопасности. По умолчанию оставить действующий baseline | Presets, tariff G7 |
| **D02 Thumbnail** | Thumbnail-only по заданиям 80x80 | studio/model.ts, photo-browser/download.ts | **Одна** encrypted WebP миниатюра ≤320px по длинной стороне; отдельного постоянного preview нет | Нужна ли отдельная downscaled 80px **выдача из разрешённого 320px** без дополнительного persistent asset? Можно выбрать другой размер до отправки в клиент без расширения доступа. Утвердить политику выдачи | G3/G4 |
| **D03 Username** | @username 3–15 | PB1 UI 3–32, AccountEditView.vue | Анонимный account recovery key; optional display handle не является login | Нужны ли публичные profile/@handle и какой лимит/уникальность? Никаких email/phone recovery | Public profile G6 |
| **D04 Optional contact fields** | Optional name/email/phone/about с видимостью | AccountEditView/identity person profile | Anonymous key-only, no phone/email as authentication requirements | Разрешить только opt-in public data либо исключить; поля никак не влияют на доступ к ключу | G6 |
| **D05 Dock** | 5 пунктов A/B/C/U/S, U=Teams/Contacts, S=Settings | PB1 dock с Messages | PB2 5 пунктов A/B/C/Photos/Profile | Какой именно UX сделать базовым? Просмотр Photos может быть частью Browser | G6 |
| **D06 Localization** | RU/EN/UA/PL/TR/KA | PB1 RU/EN | PB2 RU/EN | Когда включать остальные 4? Не блокировать P0 security ради переводов | G6 |
| **D07 Plan/backup/billing** | Free/Go/Pro/Unlimited, подписки $15/$25/$40, backups и квоты | PB1 не содержит доказанного тарифного backend | PB2 billing — future module, отдельный от kernel/Identity | Подтвердить тарифы и механизм оплаты/backup scope, не переносить цены как executable config без решения | G7 |
| **D08 Matrix/Signal** | Settings own Matrix/Signal server; Messenger в описании как future | PB1 имел зависимый от Matrix photo bootstrap и мессенджер | PB2 исключает Messenger/Matrix/RTC/Presence из первого релиза, key-only фото | Отдельный future messenger? Нельзя вернуть bootstrap PB1 ради функционального паритета | не блокирует G0–G5 |
| **D09 Storage provider** | Пользователь сможет выбирать S3/IPFS и сервер | PB1 отдельные API/Matrix gateways | PB2 Garage S3-compatible adapter, private ciphertext | Разрешить future storage driver/plugin; клиент никогда не передаёт plaintext storage провайдеру | G7 |
| **D10 Archive** | Archive заданий и фотографий | PB1 archive presets/tasks partly | PB2 TTL удаляет объект через 24h–45d | Архив — только UI видимость до expiry или отдельно оплачиваемая долгосрочная копия? Не создавать нелегальный бессрочный ciphertext | G2/G4 |
| **D11 Welcome autoplay** | Why PhotoBunker auto + manual scrolling | PB1 ручная carousel реализации | PB2 ручная dots/arrow | Автопрокрутка может вредить accessibility; подтвердить auto+pause или manual-only | G6 |
| **D12 Delete and recovery** | Emergency data-removing PIN с «keep data in cloud?» | PB1 app/emergency-* и local-delete-* | PB2 требует signed durable intent, preflight и честный ACK | Уточнить сохранить только cloud ciphertext, восстановимое user key, и server-delete semantics; не путать cache purge/device erase/account delete | G5 |

## Как фиксировать выбор

При решении: указать `DECIDED YYYY-MM-DD`, текст владельца, затронутый нормативный документ, новые tests/acceptance и какая существующая политика сохраняется для старых photos. Нельзя править только UI toggle, когда изменилась криптография/TTL/ACL. Пока статус `OPEN` — новая функция не должна тихо расширять права или хранение.

Решения **не запрашиваются как условие продолжения текущей инвентаризации или G0 CI**. Безопасные базовые сценарии можно восстанавливать с уже действующими контрактами.
