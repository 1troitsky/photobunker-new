import { locale } from '../i18n'
const entries = {
  title: ['PIN приложения', 'App PIN'],
  hint: [
    'Необязательная блокировка интерфейса и ключей в памяти при reload или сворачивании. Это НЕ шифрование всей базы и НЕ замена ключу PB1/PB4, восстановлению или системной блокировке телефона. При копировании профиля браузера короткий PIN можно атаковать.',
    'Optional UI and in-memory key lock on reload or background. This does NOT encrypt the entire database or replace PB1/PB4 recovery keys or your phone lock. A copied browser profile is NOT securely protected by a short PIN.',
  ],
  newPin: ['Новый PIN (6 или 8 цифр)', 'New PIN (6 or 8 digits)'],
  oldPin: ['Текущий PIN для подтверждения', 'Current PIN to confirm'],
  enable: ['Включить PIN', 'Enable PIN'],
  change: ['Изменить PIN', 'Change PIN'],
  disable: ['Отключить PIN', 'Disable PIN'],
  lock: ['Заблокировать приложение', 'Lock app'],
  unlock: ['Разблокировать', 'Unlock'],
  locked: ['PhotoBunker заблокирован', 'PhotoBunker is locked'],
  legacy: ['Используется старый 4-значный PIN. Рекомендуем заменить его на 6 или 8 цифр.', 'A legacy 4-digit PIN is in use. We recommend switching to 6 or 8 digits.'],
  saved: ['PIN сохранён на этом устройстве', 'PIN saved on this device'],
  disabled: ['PIN отключён', 'PIN disabled'],
  wrong: ['Неверный PIN', 'Incorrect PIN'],
  cooldown: ['Слишком много попыток. Подождите и повторите.', 'Too many attempts. Wait before retrying.'],
  rollback: ['Время устройства изменилось назад. Верните правильное время для разблокировки.', 'Device clock moved backwards. Restore the correct time before unlocking.'],
  storage: ['Не удалось проверить локальный PIN. Доступ остаётся закрытым; проверьте хранилище и повторите.', 'Local PIN could not be verified. Access stays locked. Check storage and retry.'],
  length: ['Введите 6 или 8 цифр', 'Enter 6 or 8 digits'],
  confirm: ['Введите текущий PIN перед изменением', 'Confirm your current PIN before changing it'],
  changed: ['PIN изменён в другой вкладке. Повторите после обновления.', 'PIN changed in another tab. Retry after refreshing.'],
  account: ['Аккаунт или устройство изменились', 'Account or device changed'],
  forgot: ['Забыли PIN? Восстановить доступ с PB1', 'Forgot PIN? Recover with PB1'],
  recovery: ['Сброс PIN возможен только после онлайн-проверки ключа PB1. Это не сбрасывает ключ аккаунта.', 'PIN reset requires online proof of the PB1 key. This does not reset the account key.'],
  retry: ['Повторить проверку хранилища', 'Retry storage check'],
} as const
export type PinText = keyof typeof entries
export const pt = (key: PinText) => entries[key][locale.value === 'ru' ? 0 : 1]
export function pinError(error: unknown) {
  const msg = error instanceof Error ? error.message : ''
  if (msg === 'pin.wrong') return pt('wrong')
  if (msg === 'pin.cooldown') return pt('cooldown')
  if (msg === 'pin.clock_rollback') return pt('rollback')
  if (msg === 'pin.length') return pt('length')
  if (msg === 'pin.confirm_required') return pt('confirm')
  if (msg === 'pin.changed') return pt('changed')
  if (msg === 'pin.account_changed') return pt('account')
  return pt('storage')
}
