import { locale } from '../i18n'
const lines={
title:['Экстренная авторизация (подготовка)','Emergency authorization (setup)'],
hint:['Подготовка отдельного PIN и ключа для серверного удаления аккаунта. До следующего этапа экстренный PIN НЕ работает на экране блокировки и НЕ удаляет данные. Сервер может удалить аккаунт без возможности восстановления только по отдельно подписанному запросу.','Prepare a separate PIN and signing key for server-side account deletion. Until the next phase, the emergency PIN DOES NOT work on the lock screen and DOES NOT delete data. A separately signed request can irreversibly retire the account on the server.'],
app:['Текущий PIN приложения, если он включён','Current app PIN, if enabled'],
old:['Текущий экстренный PIN (при замене или отключении)','Current emergency PIN (for replacement or disable)'],
next:['Новый экстренный PIN (6/8 цифр)','New emergency PIN (6/8 digits)'],
repeat:['Повторите новый PIN','Repeat new PIN'],
root:['Ключ восстановления PB1 текущего аккаунта','Current account PB1 recovery key'],
enable:['Зарегистрировать emergency-ключ','Register emergency key'],
change:['Заменить emergency-ключ','Replace emergency key'],
disable:['Отозвать emergency-ключ','Revoke emergency key'],
saved:['Ключ зарегистрирован сервером. Экстренный сценарий пока не активирован.','Key registered on server. Emergency trigger is not active yet.'],
revoked:['Ключ отозван сервером','Key revoked on server'],
offline:['Нет подтверждения сервера. Сохранённое намерение можно повторить после подключения.','No server confirmation. The saved registration can be retried online.'],
retry:['Повторить подтверждение регистрации','Retry registration confirmation'],
same:['PIN должен отличаться от обычного PIN и PIN локального удаления','PIN must differ from app PIN and local-delete PIN'],
wrong:['Неверный экстренный PIN','Incorrect emergency PIN'],
failed:['Не удалось подтвердить регистрацию. Удаление не запускалось.','Could not confirm key registration. No deletion was started.'],
warning:['Это не secure erase, не удаление копий получателей и не подтверждение физического удаления. Короткий PIN не защищает от офлайн-перебора при копировании всего браузерного хранилища.','This is not secure erase, deletion of recipients’ copies, or proof of physical erasure. A short PIN cannot prevent offline guessing if an attacker copies the full browser profile.'],
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
