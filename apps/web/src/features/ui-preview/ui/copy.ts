import { computed, ref, watch } from 'vue'

export type Language = 'en' | 'ru'
export type Theme = 'dark' | 'light'

function stored<T extends string>(key: string, fallback: T, values: readonly T[]): T {
  try {
    const value = window.localStorage.getItem(key)
    if (value && values.includes(value as T)) return value as T
  } catch { /* UI preferences are optional, not account state */ }
  return fallback
}

export const language = ref<Language>(
  stored('pb-preview-language', typeof navigator !== 'undefined' && navigator.language.startsWith('ru') ? 'ru' : 'en', ['en', 'ru']),
)
export const theme = ref<Theme>(
  stored('pb-preview-theme', typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark', ['light', 'dark']),
)

export function setLanguage(value: Language) { language.value = value }
export function setTheme(value: Theme) { theme.value = value }

watch(language, value => {
  if (typeof document !== 'undefined') document.documentElement.lang = value
  try { localStorage.setItem('pb-preview-language', value) } catch { /* optional */ }
}, { immediate: true })

watch(theme, value => {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = value
  try { localStorage.setItem('pb-preview-theme', value) } catch { /* optional */ }
}, { immediate: true })

const copy = {
  en: {
    preview: 'INTERFACE PREVIEW', previewInfo: 'Demo content only · No account, photo or cloud actions are active',
    photos: 'Photos', camera: 'Camera', assignments: 'Assignments', browser: 'Photo Browser', profile: 'Profile',
    welcome: 'Welcome', back: 'Back', close: 'Close', search: 'Search', filter: 'Filter', all: 'All', active: 'Active',
    new: 'New', saved: 'Saved', select: 'Select', list: 'List', grid: 'Grid', empty: 'Nothing found',
    emptyHint: 'Try a different search or filter.', noActions: 'Real actions arrive in later milestones.',
    theme: 'Appearance', light: 'Light', dark: 'Dark', language: 'Language', settings: 'Settings',
    demo: 'Demo data', photoHint: 'Sample photos for navigation and visual review — not stored files.',
    cameraHint: 'Viewfinder preview only. Real camera permission and encrypted capture come in R2-06.',
    cameraOff: 'Camera is not active in this preview', cameraOffDesc: 'No camera permission is requested and no image is captured.',
    shutter: 'Capture unavailable in UI preview', gridToggle: 'Toggle composition grid', mode: 'Capture policy',
    newest: 'Newest', favourites: 'Saved', work: 'Assignments', personal: 'Personal', browse: 'Explore',
    recent: 'Recent photographs', selected: 'Selected assignment', expires: 'Retention',
    openCard: 'Open photo card preview', openEditor: 'Open editor preview', openBrowser: 'Explore browser',
    team: 'Team', searchAssignments: 'Search assignments', tasksHint: 'Sample assignments, not linked to a server.',
    details: 'Details', folders: 'Assignments', galleryView: 'Gallery view', browserHint: 'Sample folders and files. Access checks and downloads are not active.',
    sampleAccess: 'Preview · No shared access granted', file: 'Photograph', state: 'Status',
    profileAnon: 'Anonymous account', profileDemo: 'Sample identity · Not registered',
    privateKey: 'Account Recovery Key', anonymous: 'No email. No phone number. No passwords.',
    create: 'Create new account', recover: 'Restore access', recoverDesc: 'Use your Account Recovery Key to restore access on a new device.',
    createDesc: 'An anonymous account uses one private Recovery Key. Keep it safe; nobody can reset it for you.',
    createUnavailable: 'Account creation starts in R2-03 — unavailable in preview',
    restoreUnavailable: 'Key restoration starts in R2-03 — unavailable in preview',
    dontPaste: 'Do not enter a real Recovery Key into this interface preview.',
    why: 'Why PhotoBunker?', lead: 'Capture. Protect. Share. On your terms.',
    benefits: [
      { title: 'Shoot privately.', description: 'Photos captured in PhotoBunker stay out of your phone’s gallery.' },
      { title: 'Share on your terms.', description: 'Control who can view or download an image and when access ends.' },
      { title: 'Keep assignments together.', description: 'Organize photographs with people and teams inside assignments.' },
      { title: 'Every shot has context.', description: 'Keep capture time and optional location alongside your images.' },
      { title: 'No email. No phone number.', description: 'Recover an anonymous account using your private Account Recovery Key.' },
    ],
    prevSlide: 'Previous advantage', nextSlide: 'Next advantage', showSlide: 'Show advantage',
    editor: 'Editor preview', brush: 'Brush', textTool: 'Text', shape: 'Shape', card: 'Photo Card preview', pin: 'PIN settings preview',
    editorHint: 'Illustrative editor controls. No image is changed or saved.',
    cardHint: 'Card fields are sample data only. No public link is created.',
    pinHint: 'Three independent PIN mechanisms; none is configured in this preview.',
    lockPin: 'App lock PIN', deletePin: 'Local delete PIN', emergencyPin: 'Emergency PIN',
    locked: 'Not configured', keyNotice: 'A Recovery Key is not an app PIN.',
    needKey: 'Your key is the only way to restore an account when all trusted devices are lost.',
    demoAction: 'Preview only — action unavailable', settingsHint: 'Settings shown here affect only this interface preview.',
  },
  ru: {
    preview: 'ПРЕДПРОСМОТР ИНТЕРФЕЙСА', previewInfo: 'Только демонстрационные данные · Аккаунт, съёмка и облако пока не работают',
    photos: 'Фото', camera: 'Камера', assignments: 'Задания', browser: 'Фото-браузер', profile: 'Профиль',
    welcome: 'Добро пожаловать', back: 'Назад', close: 'Закрыть', search: 'Поиск', filter: 'Фильтр', all: 'Все', active: 'Активные',
    new: 'Новые', saved: 'Сохранённые', select: 'Выбрать', list: 'Список', grid: 'Сетка', empty: 'Ничего не найдено',
    emptyHint: 'Попробуйте изменить поисковый запрос или фильтр.', noActions: 'Настоящие действия появятся на следующих этапах.',
    theme: 'Оформление', light: 'Светлая', dark: 'Тёмная', language: 'Язык', settings: 'Настройки',
    demo: 'Демо-данные', photoHint: 'Пример фотографий для оценки интерфейса — не сохранённые файлы.',
    cameraHint: 'Только макет видоискателя. Настоящая камера и шифрование — на этапе R2-06.',
    cameraOff: 'Камера в этом предпросмотре не запущена', cameraOffDesc: 'Разрешения камеры не запрашиваются. Снимки не создаются.',
    shutter: 'Съёмка недоступна в предпросмотре', gridToggle: 'Показать или скрыть сетку', mode: 'Режим хранения',
    newest: 'Новые', favourites: 'Сохранённые', work: 'Задания', personal: 'Личные', browse: 'Открыть',
    recent: 'Недавние фотографии', selected: 'Выбранное задание', expires: 'Хранение',
    openCard: 'Открыть макет карточки', openEditor: 'Открыть макет редактора', openBrowser: 'Открыть фото-браузер',
    team: 'Команда', searchAssignments: 'Поиск заданий', tasksHint: 'Примеры заданий без подключения к серверу.',
    details: 'Подробнее', folders: 'Задания', galleryView: 'Вид галереи', browserHint: 'Демо-папки и фото. Реальные права и скачивание пока отключены.',
    sampleAccess: 'Предпросмотр · Доступ никому не выдан', file: 'Фотография', state: 'Статус',
    profileAnon: 'Анонимный аккаунт', profileDemo: 'Пример профиля · Аккаунт не создан',
    privateKey: 'Ключ восстановления аккаунта', anonymous: 'Без почты. Без телефона. Без пароля.',
    create: 'Создать новый аккаунт', recover: 'Восстановить доступ', recoverDesc: 'Используйте Account Recovery Key для восстановления на другом устройстве.',
    createDesc: 'Анонимный аккаунт использует один секретный ключ восстановления. Сохраните его: сброса через поддержку нет.',
    createUnavailable: 'Создание аккаунта появится в R2-03 — сейчас недоступно',
    restoreUnavailable: 'Восстановление ключом появится в R2-03 — сейчас недоступно',
    dontPaste: 'Не вводите настоящий ключ восстановления в интерфейс предпросмотра.',
    why: 'Зачем PhotoBunker?', lead: 'Снимайте. Защищайте. Делитесь. На своих условиях.',
    benefits: [
      { title: 'Снимайте приватно.', description: 'Фотографии PhotoBunker не попадают в обычную галерею телефона.' },
      { title: 'Делитесь на своих условиях.', description: 'Решайте, кому доступен снимок и когда доступ закончится.' },
      { title: 'Задания в одном месте.', description: 'Организуйте снимки и работу участников внутри заданий.' },
      { title: 'У каждого кадра есть контекст.', description: 'Время съёмки и, при разрешении, местоположение остаются с фотографией.' },
      { title: 'Без почты и телефона.', description: 'Анонимный аккаунт восстанавливается по приватному ключу.' },
    ],
    prevSlide: 'Предыдущее преимущество', nextSlide: 'Следующее преимущество', showSlide: 'Показать преимущество',
    editor: 'Макет редактора', brush: 'Кисть', textTool: 'Текст', shape: 'Фигура', card: 'Макет Photo Card', pin: 'Настройки PIN — макет',
    editorHint: 'Инструменты демонстрационные. Изображение не меняется и не сохраняется.',
    cardHint: 'Поля карточки демонстрационные. Публичная ссылка не создаётся.',
    pinHint: 'Три независимых PIN-кода. В этом предпросмотре ничего не настроено.',
    lockPin: 'PIN блокировки', deletePin: 'PIN локального удаления', emergencyPin: 'Экстренный PIN',
    locked: 'Не настроен', keyNotice: 'Ключ восстановления не является PIN-кодом приложения.',
    needKey: 'Если все доверенные устройства потеряны, без ключа восстановить аккаунт нельзя.',
    demoAction: 'Только предпросмотр — действие недоступно',
    settingsHint: 'Настройки здесь влияют только на отображение этого интерфейса.',
  },
} as const

export const text = computed(() => copy[language.value])
