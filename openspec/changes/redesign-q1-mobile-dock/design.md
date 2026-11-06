# Design

## Context

См. `proposal.md` и `specs/mobile-app-navigation/spec.md`. В текущем `compat/assignment-release/apps/web` dock уже закреплён у нижней границы mobile viewport и использует общий `--dock-total-height`. На 320×700 CSS всё же постоянно акцентирует Camera, а активный раздел получает отдельную тяжёлую подложку; подписи имеют 10 px и слабый контраст. Снимок Q1 до правки сохранён в `test-results/playwright-mcp/q1-before-20261106-320x700.png`.

Локальный API сейчас возвращает 500 при проверке сессии (`require_once(/index.php)`), поэтому browser visual baseline получен на реальном Vue runtime с временным состоянием тестовой учётной записи **только в памяти браузера**. Это не подтверждает авторизацию или пользовательский сценарий сервера.

## Goals / Non-Goals

**Goals:** одна визуальная система пяти destination, читаемые подписи на 320 px, единый active indicator, focus/pressed states без сдвига, непрерывная поверхность до нижней safe-area, прежние route и session guards.

**Non-Goals:** переработка API, identity, Camera, Browser, PB2-дерева, локального хранилища или экранов за пределами dock. Исправление локального API 500 — отдельная проблема окружения.

## Decisions

1. Оставить существующие пять `RouterLink`, `isActive`, `aria-current` и SVG из `AppIcon`. Удалить отдельный класс Camera и его заливку: активность определяется только текущим маршрутом.
2. На телефоне сохранить `height: var(--dock-total-height)`, `bottom: 0` и общий inset рабочей области. Поменять только внутренний ритм и состояние элементов: нейтральная цельная поверхность, одинаковые outline icons, активный цвет и тонкий верхний индикатор без отдельной карточки.
3. Использовать существующие `--dock`, `--accent`, `--secondary`, `--border` для обеих тем. Не вводить новую библиотеку и произвольные цвета в компонент.
4. Сохранить desktop floating navigation и его layout. Mobile focus outline рисовать внутри элемента, чтобы dock не обрезал его. Pressed feedback меняет только цвет/фон; reduced motion уже отключает transitions в `style.css`.

## Risks / Trade-offs

- Длинная английская подпись Assignments на 320 px может приблизиться к ширине ячейки → проверить фактический `scrollWidth`, видимый текст и screenshot в RU/EN.
- Ненулевой safe-area inset нельзя доказать обычным Chromium viewport → проверить CSS геометрию и отдельно оставить реальный iPhone/Android как `NOT RUN` до проверки владельца.
- API 500 мешает настоящему входу на локальном стенде → проверить верстку в памяти без создания учётной записи, а production API и release отдельно.

## Migration Plan

Собрать изменённый frontend с новым уникальным `PHOTOBUNKER_RELEASE_ID`; загрузить immutable assets до shell файлов, `index.html`, `sw.js`, `release.json` последними. Сверить публичный marker, hashes, headers и health. Не очищать PWA storage. При дефекте восстановить предыдущие явно сохранённые static files и опубликовать их с **ещё одним** новым release ID после пересборки.
