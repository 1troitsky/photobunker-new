# Spec Delta

## Purpose

Определяет наблюдаемое визуальное, адаптивное и доступное поведение нижней навигации PhotoBunker на телефонах, планшетах и desktop viewport.

## ADDED Requirements

### Requirement: Единственное активное состояние
Dock SHALL показывать ровно один активный пункт, соответствующий текущему маршруту. Camera MUST NOT иметь постоянное акцентное состояние, когда открыт другой раздел; все пять пунктов SHALL использовать один согласованный стиль иконок.

#### Scenario: Открыт раздел Assignments
- **WHEN** пользователь находится на маршруте Assignments
- **THEN** только Assignments имеет активные цвет, фон/индикатор и `aria-current="page"`
- **AND** Camera и остальные пункты визуально не конкурируют с активным пунктом

#### Scenario: Открыт раздел Camera
- **WHEN** пользователь находится на маршруте Camera
- **THEN** Camera получает то же активное состояние, которое используется другими пунктами
- **AND** размеры и положение соседних пунктов не меняются

### Requirement: Цельная safe-area поверхность
Mobile dock SHALL быть физически прижат к нижней границе visual viewport и SHALL иметь непрерывный фон до нижнего края safe-area. Рабочая область MUST оканчиваться у верхней границы dock и MUST NOT быть скрыта под ним.

#### Scenario: Телефон в portrait с нижней safe-area
- **WHEN** приложение открыто на phone viewport с ненулевым `safe-area-inset-bottom`
- **THEN** нижняя граница dock совпадает с нижней границей visual viewport
- **AND** область системного home indicator окрашена тем же dock surface без отдельной пустой полосы

#### Scenario: Телефон в landscape
- **WHEN** viewport имеет ширину до 1000 px и высоту до 500 px
- **THEN** используется mobile full-width dock без floating gap
- **AND** основной scroll surface заканчивается у верхней границы dock

### Requirement: Читаемость и touch accessibility
Каждый пункт dock SHALL иметь доступное имя, видимую подпись и touch target не меньше 44×44 CSS px. Active state MUST отличаться не только цветом, а focus indicator MUST оставаться видимым и не обрезаться.

#### Scenario: Узкий экран 320 px
- **WHEN** dock отображается при ширине viewport 320 px
- **THEN** все пять полных подписей видимы без наложения, horizontal overflow и обрезания touch targets
- **AND** каждый пункт имеет высоту и ширину не меньше 44 CSS px

#### Scenario: Keyboard navigation
- **WHEN** пользователь перемещает focus по пунктам dock клавишей Tab
- **THEN** focus идёт в визуальном порядке слева направо
- **AND** focus indicator полностью виден поверх dock

### Requirement: Стабильная локальная навигация
Переход между пунктами dock SHALL немедленно менять URL, active state и локальный экран без ожидания HTTP/sync. Pressed feedback MUST NOT изменять layout bounds, высоту dock или положение соседних пунктов.

#### Scenario: Assignments переключается на Contacts
- **WHEN** пользователь нажимает Contacts в dock на экране Assignments
- **THEN** URL и единственное active state переключаются на Contacts в ближайшем rendering cycle
- **AND** `top`, `bottom` и `height` dock остаются неизменными

#### Scenario: Reduced motion
- **WHEN** включено `prefers-reduced-motion: reduce`
- **THEN** dock остаётся полностью функциональным
- **AND** state changes не используют обязательное движение или layout animation

### Requirement: Тема и масштаб текста
Dock SHALL сохранять читаемость и различимость состояний в light и dark themes. При увеличении системного текста интерфейс MUST сохранять все пять destinations и не перекрывать рабочую область.

#### Scenario: Light и dark themes
- **WHEN** пользователь переключает каждую поддерживаемую тему
- **THEN** текст и meaningful icons сохраняют требуемый контраст
- **AND** border, active, pressed и focus states визуально различимы

#### Scenario: Увеличенный текст
- **WHEN** browser text scale увеличен до 200 процентов
- **THEN** destinations остаются доступны по имени и touch target
- **AND** dock не создаёт horizontal page scroll

### Requirement: Versioned PWA delivery без очистки данных
Каждый production upload SHALL использовать новый release ID. Установленная PWA MUST обнаружить новый marker и загрузить новый shell без очистки IndexedDB, OPFS, ключей или пользовательского cache.

#### Scenario: Обновление установленной PWA
- **WHEN** установленная PWA со старым build ID снова становится активной при доступной сети
- **THEN** она обнаруживает другой public `release.json` marker и загружает новый shell
- **AND** локальная сессия и пользовательские данные сохраняются
