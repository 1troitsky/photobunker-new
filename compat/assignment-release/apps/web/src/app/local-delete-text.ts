import { locale } from '../i18n'
const copy = {
  heading: ['PIN локального удаления', 'Local-delete PIN'],
  boundary: [
    'Отдельный 6- или 8-значный PIN для явной очистки ЭТОГО устройства. Не разблокирует приложение. Это не emergency PIN, не удаление сервера и не физическое secure erase. Данные можно вернуть только при подтверждённой облачной копии и действующем PB1.',
    'Separate 6- or 8-digit PIN for explicitly clearing THIS device. It does not unlock the app. This is not an emergency PIN, server deletion, or physical secure erase. Recovery needs a verified cloud copy and valid PB1.',
  ],
  appPin: ['Текущий PIN приложения (если включён)', 'Current app PIN (if enabled)'],
  current: ['Текущий PIN удаления', 'Current local-delete PIN'],
  next: ['Новый PIN удаления (6/8 цифр)', 'New local-delete PIN (6/8 digits)'],
  repeat: ['Повторите новый PIN удаления', 'Repeat local-delete PIN'],
  pb1: ['Ключ восстановления PB1', 'PB1 recovery key'],
  enable: ['Включить PIN удаления', 'Enable local-delete PIN'],
  change: ['Изменить PIN удаления', 'Change local-delete PIN'],
  disable: ['Отключить PIN удаления', 'Disable local-delete PIN'],
  save: ['PIN удаления сохранён', 'Local-delete PIN saved'],
  disabled: ['PIN удаления отключён', 'Local-delete PIN disabled'],
  same: ['PIN удаления должен отличаться от PIN приложения', 'Local-delete PIN must differ from app PIN'],
  wrong: ['Неверный PIN удаления', 'Incorrect local-delete PIN'],
  cooldown: ['Много неверных попыток. Повторите позже.', 'Too many incorrect attempts. Retry later.'],
  clock: ['Время устройства изменилось назад. Исправьте часы.', 'Device clock moved backwards. Correct it.'],
  mismatch: ['Новые PIN не совпадают или длина неверна', 'PINs do not match or length is invalid'],
  recovery: ['PB1 не соответствует ключу текущего аккаунта', 'PB1 does not match this account root key'],
  unsynced: ['Есть незавершённые или неподтверждённые операции. Ничего не удалено.', 'Pending or unverified operations exist. Nothing was erased.'],
  cloud: ['Не подтверждена облачная копия всех локальных данных. Ничего не удалено.', 'A cloud copy of every local item is not confirmed. Nothing was erased.'],
  offline: ['Нужна сеть для свежей проверки перед очисткой.', 'Online connection required for a fresh preflight.'],
  storage: ['Хранилище недоступно либо нельзя доказать безопасность очистки.', 'Storage unavailable or safe deletion cannot be proven.'],
  scope: ['Аккаунт или устройство изменились. Действие отменено.', 'Account or device changed. Action cancelled.'],
  preflight: ['Проверить готовность к очистке', 'Check readiness to clear device'],
  ready: ['Облачная копия и все обязательные источники проверены. Подтвердите scope ниже.', 'Cloud copy and required sources verified. Confirm exact scope below.'],
  confirmTitle: ['Очистить только это устройство?', 'Clear only this device?'],
  confirm: ['Я подтверждаю удаление локальных данных этого аккаунта на указанном устройстве. Серверные данные, другие устройства и копии получателей не удаляются.', 'I confirm local deletion for this account on this device only. Server data, other devices, and recipients’ copies are not deleted.'],
  clear: ['Очистить это устройство', 'Clear this device'],
  cancel: ['Отмена', 'Cancel'],
  blocked: ['Локальная очистка не завершена', 'Local deletion is incomplete'],
  journal: ['Частичная очистка заблокировала приватный доступ. Продолжите ту же операцию, не удаляя хранилище вручную.', 'A partial local wipe has blocked private access. Resume the same operation; do not clear browser data manually.'],
  phase: ['Этап', 'Phase'],
  retryNotice: ['Один из этапов завершился ошибкой. Данные другого аккаунта не тронуты; повторите.', 'A cleanup stage failed. Other accounts remain untouched; retry.'],
  retry: ['Повторить очистку', 'Retry cleanup'],
  waiting: ['Проверяем безопасность…', 'Verifying safety…'],
  failure: ['Действие не выполнено. Данные не удаляются без подтверждённого preflight.', 'Action not completed. No deletion begins without verified preflight.'],
  finished: ['Локальная очистка завершена; входите снова через PB1.', 'Local wipe completed. Sign in again using PB1.'],
} as const
export type LocalDeleteMessage = keyof typeof copy
export const localDeleteText = (name: LocalDeleteMessage) =>
  copy[name][locale.value === 'ru' ? 0 : 1]
export function localDeleteError(error: unknown) {
  const message=error instanceof Error?error.message:''
  if(message.endsWith('.samePin'))return localDeleteText('same')
  if(message.endsWith('.wrong'))return localDeleteText('wrong')
  if(message.endsWith('.cooldown'))return localDeleteText('cooldown')
  if(message.endsWith('.clock'))return localDeleteText('clock')
  if(message.endsWith('.length'))return localDeleteText('mismatch')
  if(message.endsWith('.recovery'))return localDeleteText('recovery')
  if(message.endsWith('.unsynced'))return localDeleteText('unsynced')
  if(message.endsWith('.cloud'))return localDeleteText('cloud')
  if(message.endsWith('.offline'))return localDeleteText('offline')
  if(message.endsWith('.scope'))return localDeleteText('scope')
  return localDeleteText('storage')
}
