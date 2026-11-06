import { locale } from '../i18n'
const lines={
title:['Экстренное удаление','Emergency deletion'],
blocked:['Аварийное удаление временно отключено: сохранение облачного бэкапа ещё не подтверждено. Обычный PIN работает.','Emergency deletion is temporarily disabled: cloud backup preservation has not been verified. Your normal PIN remains available.'],
hint:['Это PIN уничтожения данных, а не запасной PIN входа. Вводится двумя частями подряд. Он работает даже во время 20-минутной блокировки обычного PIN.','This is a DATA DESTRUCTION PIN, not a backup login PIN. Enter two consecutive halves. It works even during the normal PIN’s 20-minute lockout.'],
app:['Текущий PIN приложения, если он включён','Current app PIN, if enabled'],
old:['Текущий экстренный PIN (при замене или отключении)','Current emergency PIN (for replacement or disable)'],
next:['Новый PIN уничтожения: две части по 4–6 цифр','Destruction PIN: two halves of 4–6 digits each'],
repeat:['Повторите новый PIN','Repeat new PIN'],
root:['Ключ восстановления PB1 текущего аккаунта','Current account PB1 recovery key'],
enable:['Установить экстренный PIN','Set emergency PIN'],
change:['Изменить экстренный PIN','Change emergency PIN'],
disable:['Отключить экстренный PIN','Disable emergency PIN'],
saved:['Экстренный PIN включён на этом устройстве.','Emergency PIN is active on this device.'],
revoked:['Экстренный PIN отключён','Emergency PIN disabled'],
offline:['Нет подтверждения сервера. Сохранённое намерение можно повторить после подключения.','No server confirmation. The saved registration can be retried online.'],
retry:['Повторить подтверждение регистрации','Retry registration confirmation'],
same:['Ни одна половина аварийного PIN не должна совпадать с обычным','Neither half of the emergency PIN may equal the normal PIN'],
requiresAppPin:['Сначала включите обычный PIN (4–6 цифр).','Enable a normal PIN (4–6 digits) first.'],
acknowledge:['Я понимаю, что это удаление данных, а не запасной PIN. Без бэкапа данные будут потеряны.','I understand this destroys data; it is not a backup PIN. Without a backup, data will be lost.'],
wrongLength:['Аварийный PIN должен состоять ровно из двух частей, каждая длиной с обычный PIN.','Emergency PIN must have exactly two halves, each as long as the normal PIN.'],
wrong:['Неверный экстренный PIN','Incorrect emergency PIN'],
failed:['Не удалось подтвердить регистрацию. Удаление не запускалось.','Could not confirm key registration. No deletion was started.'],
warning:['ВНИМАНИЕ: это PIN УНИЧТОЖЕНИЯ ДАННЫХ, НЕ запасной PIN. После двух правильных частей PhotoBunker удаляет локальные данные и отправляет команду удаления облачного аккаунта. Если нет подтверждённого независимого бэкапа, восстановить данные по Recovery Key будет НЕВОЗМОЖНО. В текущем сервере сохранение облачных бэкапов при аварийном удалении ещё не реализовано. Очистка браузерного хранилища не гарантирует физическое secure erase.','WARNING: This is a DATA DESTRUCTION PIN, NOT an alternative login PIN. After two correct halves, PhotoBunker wipes local data and requests cloud-account deletion. Without an independently verified backup, your Recovery Key CANNOT restore deleted data. The current server does not yet preserve cloud backups during emergency deletion. Browser wiping is not physical secure erase.'],
lockedEntry:['Введите экстренный PIN','Enter emergency PIN'],
lockedAction:['Удалить данные','Delete data'],
lockedCancel:['Вернуться к обычному PIN','Return to app PIN'],
} as const
export type EmergencyLabel=keyof typeof lines
export const et=(k:EmergencyLabel)=>lines[k][locale.value==='ru'?0:1]
export function emergencyError(value:unknown){
  const s=value instanceof Error?value.message:''
  if(s==='emergency.releaseBlocked')return et('blocked')
  if(s==='emergency.samePin'||s==='localDelete.samePin')return et('same')
  if(s==='emergency.appPinRequired')return et('requiresAppPin')
  if(s==='emergency.pin')return et('wrongLength')
  if(s==='emergency.wrong')return et('wrong')
  if(s==='emergency.pending'||s==='emergency.storage'||s==='emergency.unavailable')return et('offline')
  return et('failed')
}
