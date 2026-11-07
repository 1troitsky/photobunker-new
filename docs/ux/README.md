# UX prototypes — PhotoBunker

Здесь хранятся **согласованные визуальные прототипы и их исходный frontend-код**. Это рабочие эталоны для будущего UI Shell, а не исполняемые страницы production-приложения.

## Каталог

| Экран | Концепция | Где открыть | Статус |
| --- | --- | --- | --- |
| Assignments / список заданий | Fieldwork 4.2, Spotify-inspired dark | [assignments/index.html](assignments/index.html) | **OWNER-SELECTED DESIGN / IMPLEMENTATION NOT STARTED** |
| Assignments / создание, редактирование, дублирование | Fieldwork Editor · 4 вкладки, Public Card внизу правил | [assignments/editor/index.html](assignments/editor/index.html) | **OWNER-SELECTED DESIGN / IMPLEMENTATION NOT STARTED** |
| Browser / файловый менеджер фото | Fieldwork Browser 3.1 · сетка/список/дерево, path bar, share в шапке | [browser/index.html](browser/index.html) | **OWNER-SELECTED DESIGN / IMPLEMENTATION NOT STARTED; sharing open** |

## Правила

1. Для каждого экрана создавать свою папку с автономным HTML/CSS/JS прототипом и кратким контрактом `README.md`. Не путать макет с production-реализацией.
2. Макеты являются **дизайн-эталонами**, не заменяют код `compat/assignment-release/apps/web/src/`. Пока изменения явно не поручены, рабочий runtime не менять.
3. Общая оболочка на всех следующих экранах: **header → content → dock**. Одинаковые высоты, отступы, максимальная ширина, safe area и логика прокрутки. Разрешённые исключения (камера и просмотрщик изображений) проектировать явно.
4. Не заменять согласованный дизайн новой концепцией без решения владельца. Для нового согласованного состояния обновлять исходный код прототипа и описание изменений.
5. Принцип **Local-First**, отсутствие блокировки UI сетью, корректная история назад и защита от двойных действий обязательны при переносе в приложение.
6. У каждого UI-перевода в production есть отдельная приёмка на реальном устройстве владельца. Только явное подтверждение даёт статус `ACCEPTED`.

Документ-владелец требований: [`ts_and_ux.md`](../../ts_and_ux.md). Текущая реализация: `compat/assignment-release/apps/web/src/views/AssignmentsView.vue`. Правила приёмки: [`AGENTS.md`](../../AGENTS.md).

**Как открыть:** запустите `python3 -m http.server 8080` из корня репозитория и откройте список `http://localhost:8080/docs/ux/assignments/` или редактор `http://localhost:8080/docs/ux/assignments/editor/`, или Browser `http://localhost:8080/docs/ux/browser/`. Никаких npm-зависимостей.
