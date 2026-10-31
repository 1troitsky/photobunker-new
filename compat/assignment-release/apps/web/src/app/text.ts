import { locale } from '../i18n'

const copy = {
  assignments: ['Задания', 'Assignments'], messages: ['Сообщения', 'Messages'], camera: ['Камера', 'Camera'], photos: ['Фото', 'Photos'], profile: ['Профиль', 'Profile'],
  presets: ['Пресеты камеры', 'Camera presets'], standard: ['Стандартная съёмка', 'Standard capture'],
  presetHint: ['Пресет сохраняет настройки камеры. Для обычной съёмки создавать его не нужно.', 'A preset saves your camera settings. You can take photos without creating one.'],
  appearance: ['Оформление', 'Appearance'], dark: ['Тёмное', 'Dark'], light: ['Светлое', 'Light'], system: ['Как на устройстве', 'Use device setting'],
  startup: ['При запуске', 'Open on launch'], last: ['Последний раздел', 'Last section'], preferences: ['Приложение', 'Application'],
  profileIntro: ['Ваш аккаунт и настройки', 'Your account and preferences'], localAccount: ['Локальная библиотека', 'Local library'],
  accountPending: ['Постоянный аккаунт ещё не подключён. Сейчас фотографии доступны через код библиотеки в настройках.', 'Permanent accounts are not connected yet. For now, a library access code in Settings opens your photos.'],
  settingsHint: ['Язык, хранение и доступ к библиотеке', 'Language, storage and library access'],
  messagesPending: ['Переписка ещё не подключена', 'Messaging is not connected yet'],
  messagesHint: ['Здесь будут личные и групповые переписки. Они станут доступны после подключения аккаунтов и сервиса сообщений.', 'Direct and group conversations will be available here once accounts and messaging are connected.'],
  backCamera: ['Открыть камеру', 'Open camera'], localMode: ['Фотографии прототипа · пока без шифрования', 'Prototype photos · not encrypted yet'],
  saveFailed: ['Настройка применена, но не сохранилась на устройстве.', 'Preference applied, but could not be saved on this device.'],
  personalPhotos: ['Доступных фото', 'Available photos'], queued: ['Ожидают отправки', 'Waiting to upload'],
  presetsHint: ['Размер, пропорции, данные и срок хранения', 'Size, aspect ratio, metadata and retention'],
  standardHint: ['Максимальное качество · 14 дней · без GPS', 'Maximum quality · 14 days · no GPS'],
  settings: ['Настройки', 'Settings'],
} as const

export function u(key: keyof typeof copy): string { return copy[key][locale.value === 'ru' ? 0 : 1] }
