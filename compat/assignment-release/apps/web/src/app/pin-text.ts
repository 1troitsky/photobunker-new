import { locale } from '../i18n'
const entries = {
  title: ['PIN приложения', 'App PIN'],
  hint: [
    'Необязательная блокировка интерфейса и ключей в памяти при reload или сворачивании. Это НЕ шифрование всей базы и НЕ замена ключу PB1/PB4, восстановлению или системной блокировке телефона. При копировании профиля браузера короткий PIN можно атаковать.',
    'Optional UI and in-memory key lock on reload or background. This does NOT encrypt the entire database or replace PB1/PB4 recovery keys or your phone lock. A copied browser profile is NOT securely protected by a short PIN.',
  ],
  newPin: ['Новый PIN (4–6 цифр)', 'New PIN (4–6 digits)'],
  repeatPin: ['Повторите новый PIN', 'Repeat the new PIN'],
  oldPin: ['Текущий PIN для подтверждения', 'Current PIN to confirm'],
  enable: ['Включить PIN', 'Enable PIN'],
  change: ['Изменить PIN', 'Change PIN'],
  disable: ['Отключить PIN', 'Disable PIN'],
  lock: ['Заблокировать приложение', 'Lock app'],
  unlock: ['Продолжить', 'Continue'],
  locked: ['PhotoBunker заблокирован', 'PhotoBunker is locked'],
  legacy: ['PIN будет безопасно обновлён после следующего ввода.', 'The PIN record will be upgraded after the next successful entry.'],
  saved: ['PIN сохранён на этом устройстве', 'PIN saved on this device'],
  disabled: ['PIN отключён', 'PIN disabled'],
  active: ['PIN включён', 'PIN is on'],
  inactive: ['PIN не настроен', 'PIN is not set'],
  activeHint: ['Приложение блокируется на этом устройстве', 'This device locks PhotoBunker with a PIN'],
  inactiveHint: ['Можно включить в любой момент', 'You can enable it at any time'],
  cancel: ['Отмена', 'Cancel'],
  mismatch: ['PIN-коды не совпадают', 'PINs do not match'],
  disableConfirm: ['Введите текущий PIN, чтобы отключить блокировку', 'Enter the current PIN to turn off the lock'],
  wrong: ['Неверный PIN', 'Incorrect PIN'],
  cooldown: ['Обычный вход заблокирован на 20 минут. Аварийный PIN доступен.', 'Normal access is locked for 20 minutes. Emergency PIN remains available.'],
  rollback: ['Время устройства изменилось назад. Верните правильное время для разблокировки.', 'Device clock moved backwards. Restore the correct time before unlocking.'],
  storage: ['Не удалось проверить локальный PIN. Доступ остаётся закрытым; проверьте хранилище и повторите.', 'Local PIN could not be verified. Access stays locked. Check storage and retry.'],
  length: ['Введите от 4 до 6 цифр', 'Enter 4 to 6 digits'],
  confirm: ['Введите текущий PIN перед изменением', 'Confirm your current PIN before changing it'],
  changed: ['PIN изменён в другой вкладке. Повторите после обновления.', 'PIN changed in another tab. Retry after refreshing.'],
  emergencyResetRequired: ['Сначала отключите аварийный PIN, затем меняйте или отключайте обычный.', 'Disable the emergency PIN before changing or removing the normal PIN.'],
  account: ['Аккаунт или устройство изменились', 'Account or device changed'],
  forgot: ['Восстановить аккаунт', 'Recover account'],
  lockAfter: ['Требовать PIN', 'Require PIN'],
  immediately: ['Сразу', 'Immediately'],
  after10s: ['Через 10 секунд', 'After 10 seconds'],
  after30s: ['Через 30 секунд', 'After 30 seconds'],
  after1m: ['Через 1 минуту', 'After 1 minute'],
  after5m: ['Через 5 минут', 'After 5 minutes'],
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
  if (msg === 'pin.mismatch') return pt('mismatch')
  if (msg === 'pin.confirm_required') return pt('confirm')
  if (msg === 'pin.changed') return pt('changed')
  if (msg === 'pin.emergency_reset_required') return pt('emergencyResetRequired')
  if (msg === 'pin.account_changed') return pt('account')
  return pt('storage')
}
