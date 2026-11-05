import { locale } from '../i18n'
const lines={
title:['Экстренное удаление','Emergency deletion'],
hint:['Этот отдельный PIN удаляет данные устройства и отправляет подписанную команду удаления аккаунта. Он работает даже во время 30-минутной блокировки обычного PIN.','This separate PIN wipes this device and sends a signed account-deletion command. It still works during the normal PIN’s 30-minute lockout.'],
app:['Текущий PIN приложения, если он включён','Current app PIN, if enabled'],
old:['Текущий экстренный PIN (при замене или отключении)','Current emergency PIN (for replacement or disable)'],
next:['Новый экстренный PIN (от 6 до 10 цифр)','New emergency PIN (6 to 10 digits)'],
repeat:['Повторите новый PIN','Repeat new PIN'],
root:['Ключ восстановления PB1 текущего аккаунта','Current account PB1 recovery key'],
enable:['Установить экстренный PIN','Set emergency PIN'],
change:['Изменить экстренный PIN','Change emergency PIN'],
disable:['Отключить экстренный PIN','Disable emergency PIN'],
saved:['Экстренный PIN включён на этом устройстве.','Emergency PIN is active on this device.'],
revoked:['Экстренный PIN отключён','Emergency PIN disabled'],
offline:['Нет подтверждения сервера. Сохранённое намерение можно повторить после подключения.','No server confirmation. The saved registration can be retried online.'],
retry:['Повторить подтверждение регистрации','Retry registration confirmation'],
same:['Обычный и экстренный PIN не должны полностью совпадать','The normal and emergency PINs must not be identical'],
wrong:['Неверный экстренный PIN','Incorrect emergency PIN'],
failed:['Не удалось подтвердить регистрацию. Удаление не запускалось.','Could not confirm key registration. No deletion was started.'],
warning:['Это не secure erase, не удаление копий получателей и не подтверждение физического удаления. Короткий PIN не защищает от офлайн-перебора при копировании всего браузерного хранилища.','This is not secure erase, deletion of recipients’ copies, or proof of physical erasure. A short PIN cannot prevent offline guessing if an attacker copies the full browser profile.'],
lockedEntry:['Введите экстренный PIN','Enter emergency PIN'],
lockedAction:['Удалить данные','Delete data'],
lockedCancel:['Вернуться к обычному PIN','Return to app PIN'],
} as const
export type EmergencyLabel=keyof typeof lines
export const et=(k:EmergencyLabel)=>lines[k][locale.value==='ru'?0:1]
export function emergencyError(value:unknown){
  const s=value instanceof Error?value.message:''
  if(s==='emergency.samePin'||s==='localDelete.samePin')return et('same')
  if(s==='emergency.wrong')return et('wrong')
  if(s==='emergency.pending'||s==='emergency.storage'||s==='emergency.unavailable')return et('offline')
  return et('failed')
}
