import { ref } from 'vue'

export type Locale = 'ru' | 'en'
export const locale = ref<Locale>('en')
const LOCALE_KEY = 'photobunker.locale'

const ru = {
  skip: 'Перейти к содержимому',
  navigation: 'Основная навигация',
  camera: 'Камера',
  gallery: 'Галерея',
  settings: 'Настройки',
  early: 'Ранняя версия',
  tagline: 'Место для ваших кадров',
  offline: 'Нет сети',
  offlineHint: 'Локальная съёмка и галерея работают без интернета.',
  cameraEyebrow: 'ВАША КАМЕРА',
  cameraTitle: 'Камера',
  cameraDescription: 'Разрешите доступ к камере, чтобы начать съёмку.',
  cameraUnavailable: 'Съёмка пока недоступна',
  cameraFlip: 'Переключить камеру',
  noVault: 'Хранилище не подключено',
  photoMode: 'ФОТО',
  captureNote: 'Кадры сохраняются в этом браузере',
  galleryEyebrow: 'ВАШИ ФОТОГРАФИИ',
  galleryTitle: 'Здесь будут ваши кадры',
  galleryDescription: 'Сделайте первый снимок. Здесь можно будет открыть его, добавить подпись или удалить.',
  backToCamera: 'К камере',
  settingsEyebrow: 'ПОД ВАС',
  settingsTitle: 'Настройки',
  settingsDescription: 'Пусть всё будет привычно.',
  language: 'Язык приложения',
  languageHint: 'Сохраняется на этом устройстве',
  languageUnavailable: 'Язык изменён. Сохранить выбор на этом устройстве не удалось.',
  security: 'Защита и хранилище',
  securityHint: 'Шифрование, PIN и защищённые аккаунты ещё не подключены.',
  comingLater: 'В следующих версиях',
  version: 'PhotoBunker · ранняя версия',
  prototype: "Локальная версия",
  prototypeNote: "Локальная версия без шифрования. Снимки можно сохранить в браузере или на локальном сервере.",
  enableCamera: "Включить камеру",
  tryDemo: "Попробовать без камеры",
  demoMode: "ТЕСТОВЫЙ КАДР",
  cameraStarting: "Подключаем камеру…",
  stopCamera: "Выключить камеру",
  capture: "Снять фото",
  saving: "Сохраняем кадр…",
  saved: "Кадр сохранён в этом браузере",
  saveFailed: "Не удалось сохранить кадр. Он пока только в памяти — можно повторить запись или отменить.",
  captureFailed: "Не удалось снять кадр. Попробуйте ещё раз.",
  cameraDenied: "Доступ к камере запрещён. Разрешите его в настройках браузера или попробуйте без камеры.",
  cameraMissing: "Камера не найдена. Можно попробовать приложение без камеры.",
  cameraBusy: "Не удалось подключить камеру. Проверьте, не использует ли её другое приложение.",
  cameraNeedsSecure: "Этот браузер не даёт доступа к камере по текущему адресу. Пока можно попробовать без камеры.",
  cameraPaused: "Камера выключена после выхода из приложения. Включите её снова, когда будете готовы.",
  retry: "Повторить",
  discard: "Отменить кадр",
  discardQuestion: "Кадр ещё не сохранён. Уйти и потерять его?",
  localOnly: "На этом устройстве",
  allPhotos: "Все кадры",
  favorites: "Избранное",
  searchPhotos: "Поиск по номеру, описанию и меткам",
  noMatches: "Таких кадров пока нет",
  noMatchesHint: "Измените поиск или снимите новый кадр.",
  loading: "Загружаем…",
  storageFailed: "Не удалось открыть фотографии. Проверьте доступ браузера к хранилищу и попробуйте ещё раз.",
  photo: "Снимок",
  testPhoto: "Тестовый кадр",
  viewPhoto: "Открыть снимок",
  photoUnavailable: "Снимок недоступен",
  photoUnavailableHint: "Возможно, он удалён в другой вкладке или браузер очистил данные.",
  backToGallery: "В галерею",
  photoTitle: "Название",
  photoTitlePlaceholder: "Без названия",
  photoNote: "Заметка",
  photoNotePlaceholder: "Что стоит запомнить об этом кадре?",
  saveChanges: "Сохранить изменения",
  changesSaved: "Изменения сохранены",
  changeFailed: "Не удалось сохранить изменения. Попробуйте ещё раз.",
  addFavorite: "В избранное",
  removeFavorite: "Убрать из избранного",
  download: "Скачать оригинал",
  deletePhoto: "Удалить снимок",
  deleteQuestion: "Удалить этот снимок из браузера? Отменить удаление будет нельзя.",
  deleteFailed: "Не удалось удалить снимок. Он остаётся в галерее.",
  resolution: "Разрешение",
  fileSize: "Размер файла",
  capturedAt: "Дата съёмки",
  cameraSource: "Источник",
  nativePhoto: "Камера",
  videoPhoto: "Кадр с камеры",
  localLibrary: "Фотографии в приложении",
  localLibraryHint: "Снимки в браузере и подключённой серверной библиотеке.",
  clearPhotos: "Удалить копии в браузере",
  clearQuestion: "Удалить все локальные снимки, правки и очередь отправки из этого браузера? Неотправленные данные будут потеряны. Отменить удаление будет нельзя.",
  cleared: "Копии в браузере удалены",
  prototypeDisabled: "Локальная версия не включена в этой сборке.",
  saveOnServer: 'Сохранить на сервере',
  serverSaved: 'На локальном сервере',
  browserOnly: 'Только в браузере',
  serverUploading: 'Отправляем на локальный сервер…',
  serverUploadFailed: 'Загрузка не завершена. Снимок остаётся в браузере — можно повторить.',
  serverPending: 'Ещё не загружено на сервер',
  retryUpload: 'Повторить загрузку',
  saveBeforeUpload: 'Сначала сохраните изменения.',
  serverUnavailable: 'Сервер недоступен. Показываем доступные локальные снимки.',
  changeConflict: 'Снимок изменён в другом браузере. Откройте его заново перед сохранением.',
  serverLibrary: 'Серверная библиотека',
  serverLibraryHint: 'Новые снимки автоматически отправляются на локальный сервер.',
  accessCode: 'Код доступа',
  accessCodeHint: 'Сохраните этот код, чтобы открыть серверные снимки в другом браузере. Он даёт полный доступ к этой библиотеке.',
  showAccessCode: 'Показать код доступа',
  hideAccessCode: 'Скрыть код',
  copyAccessCode: 'Скопировать код',
  accessCopied: 'Код скопирован',
  accessCopyFailed: 'Не удалось скопировать. Выделите код и сохраните вручную.',
  restoreLibrary: 'Открыть библиотеку по коду',
  restoreLibraryHint: 'Вставьте сохранённый код доступа. Снимки загрузятся с локального сервера.',
  restoreAction: 'Открыть библиотеку',
  restoreSuccess: 'Серверная библиотека подключена',
  restoreFailed: 'Не удалось открыть библиотеку. Проверьте код и доступность сервера.',
  accessNotSaved: 'Не удалось запомнить доступ в браузере. Сохраните код перед закрытием страницы.',
  clearLocalHint: 'Удаляются местные файлы, неотправленные правки и очередь. Подтверждённые серверные снимки останутся.',
  serverDeleteQuestion: 'Удалить снимок из браузера и с локального сервера? Отменить удаление будет нельзя.',

} as const

const en: Record<keyof typeof ru, string> = {
  skip: 'Skip to content',
  navigation: 'Main navigation',
  camera: 'Camera',
  gallery: 'Gallery',
  settings: 'Settings',
  early: 'Early version',
  tagline: 'A place for your moments',
  offline: 'No connection',
  offlineHint: 'Local capture and the gallery work without internet.',
  cameraEyebrow: 'YOUR CAMERA',
  cameraTitle: 'Camera',
  cameraDescription: 'Allow camera access to start taking photos.',
  cameraUnavailable: 'Capture is not available yet',
  cameraFlip: 'Switch camera',
  noVault: 'No storage connected',
  photoMode: 'PHOTO',
  captureNote: 'Photos are saved in this browser',
  galleryEyebrow: 'YOUR PHOTOGRAPHS',
  galleryTitle: 'A place for your moments',
  galleryDescription: 'Take your first photo. Open it here, add a note or delete it.',
  backToCamera: 'Back to camera',
  settingsEyebrow: 'MAKE IT YOURS',
  settingsTitle: 'Settings',
  settingsDescription: 'Make yourself at home.',
  language: 'App language',
  languageHint: 'Saved on this device',
  languageUnavailable: 'Language changed. Your choice could not be saved on this device.',
  security: 'Protection and storage',
  securityHint: 'Encryption, PIN and secure accounts are not connected yet.',
  comingLater: 'Coming in future versions',
  version: 'PhotoBunker · early version',
  prototype: "Local version",
  prototypeNote: "Local version without encryption. Save photos in this browser or on the local server.",
  enableCamera: "Turn on camera",
  tryDemo: "Try without a camera",
  demoMode: "TEST SCENE",
  cameraStarting: "Connecting camera…",
  stopCamera: "Turn off camera",
  capture: "Take photo",
  saving: "Saving photo…",
  saved: "Photo saved in this browser",
  saveFailed: "Could not save the photo. It is only in memory — retry saving or discard it.",
  captureFailed: "Could not take the photo. Please try again.",
  cameraDenied: "Camera access was denied. Allow it in browser settings or try without a camera.",
  cameraMissing: "No camera found. You can try the app without a camera.",
  cameraBusy: "Could not connect to the camera. Check whether another app is using it.",
  cameraNeedsSecure: "This browser cannot access the camera at this address. You can try without a camera.",
  cameraPaused: "Camera stopped when you left the app. Turn it on again when ready.",
  retry: "Retry",
  discard: "Discard photo",
  discardQuestion: "The photo has not been saved. Leave and lose it?",
  localOnly: "On this device",
  allPhotos: "All photos",
  favorites: "Favorites",
  searchPhotos: "Search numbers, descriptions and tags",
  noMatches: "No matching photos",
  noMatchesHint: "Change your search or take a new photo.",
  loading: "Loading…",
  storageFailed: "Could not open photos. Check browser storage access and try again.",
  photo: "Photo",
  testPhoto: "Test photo",
  viewPhoto: "Open photo",
  photoUnavailable: "Photo unavailable",
  photoUnavailableHint: "It may have been deleted in another tab, or the browser cleared its data.",
  backToGallery: "Back to gallery",
  photoTitle: "Title",
  photoTitlePlaceholder: "Untitled",
  photoNote: "Note",
  photoNotePlaceholder: "What would you like to remember?",
  saveChanges: "Save changes",
  changesSaved: "Changes saved",
  changeFailed: "Could not save changes. Please try again.",
  addFavorite: "Add to favorites",
  removeFavorite: "Remove from favorites",
  download: "Download original",
  deletePhoto: "Delete photo",
  deleteQuestion: "Delete this photo from the browser? This cannot be undone.",
  deleteFailed: "Could not delete the photo. It remains in the gallery.",
  resolution: "Resolution",
  fileSize: "File size",
  capturedAt: "Captured",
  cameraSource: "Source",
  nativePhoto: "Camera",
  videoPhoto: "Camera video frame",
  localLibrary: "Photos in the app",
  localLibraryHint: "Photos in this browser and the connected server library.",
  clearPhotos: "Remove browser copies",
  clearQuestion: "Delete all local photos, edits and the upload queue from this browser? Unsent data will be lost. This cannot be undone.",
  cleared: "Browser copies removed",
  prototypeDisabled: "The local version is not enabled in this build.",
  saveOnServer: 'Save to server',
  serverSaved: 'On local server',
  browserOnly: 'Only in this browser',
  serverUploading: 'Uploading to local server…',
  serverUploadFailed: 'Upload did not complete. The photo stays in this browser — you can retry.',
  serverPending: 'Not uploaded to server yet',
  retryUpload: 'Retry upload',
  saveBeforeUpload: 'Save your changes first.',
  serverUnavailable: 'Server unavailable. Showing accessible local photos.',
  changeConflict: 'This photo changed in another browser. Reopen it before saving.',
  serverLibrary: 'Server library',
  serverLibraryHint: 'New photos upload to the local server automatically.',
  accessCode: 'Access code',
  accessCodeHint: 'Save this code to open server photos in another browser. It grants full access to this library.',
  showAccessCode: 'Show access code',
  hideAccessCode: 'Hide code',
  copyAccessCode: 'Copy code',
  accessCopied: 'Code copied',
  accessCopyFailed: 'Could not copy. Select and save the code manually.',
  restoreLibrary: 'Open a library with a code',
  restoreLibraryHint: 'Enter your saved access code. Photos will load from the local server.',
  restoreAction: 'Open library',
  restoreSuccess: 'Server library connected',
  restoreFailed: 'Could not open the library. Check the code and server availability.',
  accessNotSaved: 'Browser could not remember access. Save the code before closing the page.',
  clearLocalHint: 'Local files, unsent edits and the queue are removed. Confirmed server photos remain.',
  serverDeleteQuestion: 'Delete this photo from the browser and local server? This cannot be undone.',

}

export function t(key: keyof typeof ru): string {
  return (locale.value === 'ru' ? ru : en)[key]
}

// Language is DEVICE-scoped, never tied to the selected identity/session.
 // The browser's language is only an initial preference; unknown locales fall
 // back to English. No network read or account-specific async callback may
 // overwrite the user's current selection.
const supported = (value: unknown): value is Locale => value === 'ru' || value === 'en'
function defaultLocale(): Locale {
  try { return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en' }
  catch { return 'en' }
}
function applyLocale(value: Locale) {
  locale.value = value
  document.documentElement.lang = value
}
export function initializeLocale() {
  let choice: Locale = defaultLocale()
  try {
    const saved = localStorage.getItem(LOCALE_KEY)
    // Invalid stored locale is not a recognized language: English is safe.
    if (saved !== null) choice = supported(saved) ? saved : 'en'
  } catch { /* Browser preference still works without storage. */ }
  applyLocale(choice)
}
// A later change in another tab is a device preference update; it must never
// be silently rolled back by a stale account/session response.
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key !== LOCALE_KEY || event.storageArea !== localStorage) return
  applyLocale(event.newValue === null ? defaultLocale()
    : supported(event.newValue) ? event.newValue : 'en')
})
// Only the interface preference is persisted. Never account or sensitive data.
export function setLocale(value: Locale): boolean {
  applyLocale(supported(value) ? value : 'en')
  try {
    localStorage.setItem(LOCALE_KEY, locale.value)
    return true
  } catch { return false }
}

export const languageTag = () => locale.value === 'ru' ? 'ru-RU' : 'en-US'
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return Number.isFinite(value) ? new Intl.NumberFormat(languageTag(), options).format(value) : '—'
}
export function formatDate(value: number | Date, options: Intl.DateTimeFormatOptions = {
  dateStyle: 'medium',
}): string {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(languageTag(), options).format(date) : '—'
}
export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—'
  const sizes = locale.value === 'ru' ? ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']
    : ['B', 'KB', 'MB', 'GB', 'TB']
  let index = 0, size = value
  while (size >= 1024 && index < sizes.length - 1) { size /= 1024; index++ }
  return formatNumber(size, { maximumFractionDigits: index ? 1 : 0 }) + ' ' + sizes[index]
}
