# UX prototypes — PhotoBunker

Здесь хранятся **согласованные визуальные прототипы и их исходный frontend-код**. Это рабочие эталоны для будущего UI Shell, а не исполняемые страницы production-приложения.

## Каталог

| Экран | Концепция | Где открыть | Статус |
| --- | --- | --- | --- |
| Assignments / список заданий | Fieldwork 4.2, Spotify-inspired dark | [assignments/index.html](assignments/index.html) | **OWNER-SELECTED DESIGN / IMPLEMENTATION NOT STARTED** |
| Assignments / настройка задания | **Assignment Editor 2.2** · фото, видео, аудио, цели, автоудаление и права | [assignments/editor/index.html](assignments/editor/index.html) · [оригинальный HTML](assignments/editor/accepted-assignment-editor-v2.2.html) · [спецификация](assignments/editor/README.md) | **OWNER-ACCEPTED UX / NOT PRODUCTION IMPLEMENTED** |
| Контакты и Команды / единая страница | **Contacts & Teams 1.1** · две вкладки со счётчиками, Blacklist, профили, команды, участники, права | [contacts-teams/index.html](contacts-teams/index.html) · [оригинальный HTML](contacts-teams/accepted-contacts-teams-v1.1.html) · [спецификация](contacts-teams/README.md) | **OWNER-ACCEPTED UX / NOT PRODUCTION IMPLEMENTED** |
| Settings + Profile / настройки и карточка | **Fieldwork 1.6 (WIP)** · поиск, профиль, приватность, команды, заголовок с тарифом | [settings-profile/index.html](settings-profile/index.html) · [автономный HTML](settings-profile/settings-profile-v1.6-standalone.html) · [спецификация](settings-profile/README.md) | **INTERIM / NOT FINAL / NOT PRODUCTION IMPLEMENTED** |
| Browser / каталог фото, видео и аудио | **Browser v3** · каталог, загрузчик, поиск, массовые действия, сортировка, архив | [browser/index.html](browser/index.html) · [эталон HTML](browser/accepted-v3-standalone.html) · [спецификация](browser/README.md) | **OWNER-ACCEPTED UX / NOT PRODUCTION IMPLEMENTED** |
| Browser / просмотр файлов | **File Viewer 1.0** · фото, видео, аудио, одинаковая геометрия, trim, стоп-кадр | [browser/viewer/index.html](browser/viewer/index.html) · [автономный эталон](browser/viewer/accepted-file-viewer-v1-standalone.html) · [спецификация](browser/viewer/README.md) | **OWNER-ACCEPTED UX / NOT PRODUCTION IMPLEMENTED** |
| Browser / редактирование фотографий | Fieldwork Photo Editor 3.2 Fixed · Информация / Фото / Проверка, тексты, фигуры, сохранение | [browser/editor/index.html](browser/editor/index.html) · [спецификация](browser/editor/README.md) | **OWNER-SELECTED DESIGN / PROTOTYPE DOCUMENTED / IMPLEMENTATION NOT STARTED** |
| Browser / редактирование видео и аудио | **Video & Audio Editor 1.1** · обрезка, стоп-кадр, JPEG/WAV, сохранение на устройство и в Browser | [browser/media-editor/index.html](browser/media-editor/index.html) · [автономный эталон](browser/media-editor/accepted-media-editor-v1.1.html) · [спецификация](browser/media-editor/README.md) | **OWNER-ACCEPTED UX / NOT PRODUCTION IMPLEMENTED** |

**Тарифная политика (решение владельца 2026-11-08):** [Billing & Tariff Contract](../product/BILLING-TARIFF-CONTRACT.md). Содержит Free / Go / Pro / Unlimited, окончательную продуктовую сетку, скидки, квоты, одну обновляемую резервную копию и льготный период. Старый `payments/catalog.ts` содержит устаревшие значения. Новый HTML тарифов пока проходит отдельное согласование и **не является готовым UX-эталоном**.

## Обязательный общий интерфейс

Перед созданием или изменением экрана прочитать **[UI-SHELL-CONTRACT.md](UI-SHELL-CONTRACT.md)**. Header, логотип PhotoBunker, системный статус, path bar Browser и пятикнопочный dock **не меняют визуальный стиль, геометрию и расположение от страницы к странице**. Разрешён только контекстный набор иконок Header. File Viewer (ранее Photo Viewer) — часть Browser, не отдельный UI Shell.

## Правила

1. Для каждого экрана создавать свою папку с автономным HTML/CSS/JS прототипом и кратким контрактом `README.md`. Не путать макет с production-реализацией.
2. Макеты являются **дизайн-эталонами**, не заменяют код `compat/assignment-release/apps/web/src/`. Пока изменения явно не поручены, рабочий runtime не менять.
3. Общая оболочка на всех следующих экранах: **header → content → dock**. Одинаковые высоты, стиль, положение и safe area. Камера и File Viewer для фото/видео/аудио **не получают новую шапку/dock**. Полноэкранный просмотр может временно перекрывать оболочку только как модальное представление.
4. Не заменять согласованный дизайн новой концепцией без решения владельца. Для нового согласованного состояния обновлять исходный код прототипа и описание изменений.
5. Принцип **Local-First**, отсутствие блокировки UI сетью, корректная история назад и защита от двойных действий обязательны при переносе в приложение.
6. У каждого UI-перевода в production есть отдельная приёмка на реальном устройстве владельца. Только явное подтверждение даёт статус `ACCEPTED`.

Документ-владелец требований: [`ts_and_ux.md`](../../ts_and_ux.md). Текущая реализация: `compat/assignment-release/apps/web/src/views/AssignmentsView.vue`. Правила приёмки: [`AGENTS.md`](../../AGENTS.md).

**Как открыть:** запустите `python3 -m http.server 8080` из корня репозитория и откройте список `http://localhost:8080/docs/ux/assignments/` или редактор `http://localhost:8080/docs/ux/assignments/editor/`, или Browser `http://localhost:8080/docs/ux/browser/`, или File Viewer `http://localhost:8080/docs/ux/browser/viewer/`, или Photo Editor `http://localhost:8080/docs/ux/browser/editor/`, или Video & Audio Editor `http://localhost:8080/docs/ux/browser/media-editor/`, или Contacts & Teams `http://localhost:8080/docs/ux/contacts-teams/`, или Settings & Profile `http://localhost:8080/docs/ux/settings-profile/`. Никаких npm-зависимостей.
