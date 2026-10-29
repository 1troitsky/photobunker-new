import { IdentityError } from '../identity/api'
import { locale } from '../i18n'

// Source-language message IDs keep security copy together with its translation.
const english: Record<string, string> = {
  'Сохранить': 'Save',
  'Отмена': 'Cancel',
  'Ключ аккаунта будет удалён с этого устройства. Чтобы снова открыть фотографии и сообщения, понадобится сохранённый ключ.': 'Your account key will be removed from this device. You will need your saved key to open your photos and messages again.',
  'Потерянный ключ восстановить нельзя.': 'A lost account key cannot be recovered.',
  'Сначала дождитесь отправки фотографий с этого устройства.': 'Wait for photos on this device to finish uploading before signing out.',
  'Сохранить ключ в файл': 'Save key to file',
  'Выйти без сохранения': 'Sign out without saving',
  'Уникальный @username: 3–32 символа, латинские буквы, цифры, дефис или подчёркивание. Начинается с буквы; поиск по нему общедоступен. Изменение вступает в силу после сохранения.': 'Your unique @username: 3–32 Latin letters, digits, hyphens or underscores. It must start with a letter and can be found publicly. Changes take effect after saving.',
  'Публичный адрес @username доступен для поиска всем пользователям.': 'Your public @username can be found by anyone.',
  'Защита задания': 'Assignment protection',
  'Завершаем выход на устройстве…': 'Signing out on this device…',
  'Аккаунт': 'Account',
  'Устройство': 'Device',
  'Предпросмотр камеры': 'Camera preview',
  'ДЕМО': 'DEMO',
  'Сбой программы': 'Application error',
  "Снимок сохраняется на устройстве и синхронизируется с аккаунтом при наличии сети.": "The photo is saved on this device and syncs with your account when online.",
  "Аккаунт закрыт. Очистка данных на сервере выполняется автоматически.": "Your account is closed. Server data cleanup runs automatically.",
  "Закройте другие окна приложения, чтобы завершить удаление локальных данных.": "Close other app windows to finish deleting local data.",
  "Завершить очистку устройства": "Finish device cleanup",
  "Данные и хранилище": "Data and storage",
  "Фотографии, занятое место и удаление аккаунта": "Photos, storage usage and account deletion",
  "Выйти из аккаунта?": "Sign out of your account?",
  "При выходе ключ будет удалён с этого устройства. Для повторного входа и доступа к фотографиям и сообщениям понадобится сохранённый ключ аккаунта.": "Signing out removes the key from this device. You will need your saved account key to sign in again and access your photos and messages.",
  "Если вы потеряли ключ и не сохранили его на другом устройстве, доступ ко всем данным будет потерян без возможности восстановления.": "If you have lost your key and have no copy on another device, you will permanently lose access to all your data.",
  "На устройстве есть фотографии, которые ещё не загружены. Дождитесь отправки перед выходом.": "Some photos on this device have not been uploaded. Wait for them to upload before signing out.",
  "Остаться в аккаунте": "Stay signed in",
  "Всё равно выйти": "Sign out anyway",
  "Готовим съёмку…": "Getting the camera ready\u2026",
  "Не удалось подготовить съёмку. Проверьте соединение и повторите.": "Could not prepare the camera. Check your connection and retry.",
  "Участник задания ещё не подключил фотографии. Попросите его открыть приложение.": "A participant has not connected their photos yet. Ask them to open the app.",
  "Владелец задания должен подтвердить участников перед общей съёмкой.": "The assignment owner must confirm the participants before a shared shoot.",
  "Подтвердите участников задания перед общей съёмкой.": "Confirm assignment participants before a shared shoot.",
  "Проверить участников": "Review participants",
  "Участники общей съёмки": "Shared shoot participants",
  "Эти участники получат доступ к снимкам в соответствии с правами задания. Сверьте их перед подтверждением.": "These participants will receive access to photos according to assignment permissions. Verify them before confirming.",
  "Подтвердить участников": "Confirm participants",
  "Не удалось загрузить данные хранилища. Проверьте соединение и повторите.": "Could not load storage details. Check your connection and retry.",
  "Укажите целое число дней от 30 до 360.": "Enter a whole number of days from 30 to 360.",
  "Срок автоудаления сохранён.": "Auto-delete period saved.",
  "Не удалось сохранить срок. Проверьте соединение и повторите.": "Could not save the period. Check your connection and retry.",
  "Не удалось завершить очистку. Закройте другие окна приложения и повторите.": "Could not finish cleanup. Close other app windows and retry.",
  "Хранилище": "Storage",
  "Доступные фотографии": "Available photos",
  "Ваши фотографии в облаке": "Your photos in the cloud",
  "Занято в облаке": "Cloud storage used",
  "Ожидают отправки": "Waiting to upload",
  "Доступно приложению на устройстве": "Available to the app on this device",
  "В объём облака входят зашифрованные оригиналы, превью и версии. Доступное место на устройстве — оценка браузера, а не свободная память телефона.": "Cloud usage includes encrypted originals, previews and versions. Available device storage is a browser estimate of app capacity.",
  "Обновить": "Refresh",
  "Удалить аккаунт при неактивности": "Delete account if inactive",
  "Если вы не пользуетесь приложением с подключением к интернету дольше выбранного срока, аккаунт и его данные удаляются. По умолчанию — 180 дней. Фоновая синхронизация не считается активностью.": "Your account and its data are deleted if you do not use the app while connected to the internet for the selected period. The default is 180 days. Background sync does not count as activity.",
  "Дней без активности": "Days of inactivity",
  "От 30 до 360 дней": "From 30 to 360 days",
  "Если больше не пользоваться приложением:": "If you do not use the app again:",
  "Удаление данных": "Delete data",
  "Удалить аккаунт вместе с фотографиями, контактами, настройками и резервными копиями переписки. Восстановление по ключу после удаления невозможно.": "Delete your account along with photos, contacts, settings and message backups. Your key cannot restore data after deletion.",
  "Удалить аккаунт и все данные": "Delete account and all data",
  "Удалить аккаунт и все данные?": "Delete account and all data?",
  "Выполняем…": "Working\u2026",
  "Доступ на всех устройствах и внешние ссылки будут закрыты. Фотографии, ваши команды и задания, контакты и резервные копии переписки будут удалены. Это действие нельзя отменить, даже имея ключ аккаунта.": "Access on all devices and external photo links will be revoked. Photos, your teams and assignments, contacts and message backups will be deleted. This cannot be undone, even with your account key.",
  "У собеседников могут остаться полученные сообщения и сохранённые копии. Физическая очистка сервера выполняется после закрытия доступа и повторяется при сбоях.": "Recipients may retain received messages and saved copies. Server cleanup follows access revocation and retries after failures.",
  "Я понимаю, что восстановить данные будет невозможно": "I understand that the data cannot be restored",
  "Удалить без возможности восстановления": "Delete permanently",
  'Ключ аккаунта': 'Account key',
  'Подключить ключ аккаунта': 'Connect account key',
  'Подключите ключ аккаунта': 'Connect your account key',
  'Введите единственный ключ аккаунта или выберите сохранённый файл. Приложение само подключит фотографии и переписку.': 'Enter your single account key or select its saved file. The app will connect your photos and messages automatically.',
  'Создайте аккаунт и сохраните один ключ. Он подключает фотографии и переписку на ваших устройствах.': 'Create an account and save one key. It connects your photos and messages across your devices.',
  'Ключ сохраняется на этом устройстве. Резервная копия позволит войти после выхода или потери устройства.': 'Your key is saved on this device. Keep a backup to sign in after signing out or losing your device.',
  'Импортировать ключ аккаунта': 'Import account key',
  'Для старых фотографий нужна прежняя резервная копия. Импортируйте её один раз; новые ключи не создаются взамен существующих.': 'Your previous photo backup is needed for older photos. Import it once; existing keys will not be replaced.',
  'Этот ключ принадлежит другому аккаунту. Выберите ключ текущего аккаунта.': 'This key belongs to another account. Select the key for your current account.',
  'Один ключ аккаунта подключает ваши фотографии и переписку. Приложение хранит его на этом устройстве; вводить его при каждом запуске не нужно.': 'One account key connects your photos and messages. The app keeps it on this device, so you do not need to enter it on each launch.',
  'Ключ аккаунта подключён на этом устройстве.': 'Your account key is connected on this device.',
  'Сохранить ключ аккаунта в файл': 'Save account key to file',
  'Сохраните файл в надёжном месте. Он понадобится после выхода из аккаунта или на новом устройстве.': 'Keep this file somewhere safe. You will need it after signing out or on a new device.',
  'Дополнительные действия': 'Advanced actions',
  'Сверьте участников и отпечатки перед общей съёмкой.': 'Verify participants and fingerprints before a shared shoot.',
  'Камера подготовлена.': 'Camera is ready.',
  'Не удалось выполнить действие. Проверьте соединение и повторите.': 'Could not complete the action. Check your connection and try again.',
  'Подключаем фотографии…': 'Connecting photos…',
  'Фотографии пока недоступны': 'Photos are unavailable',
  'Этот аккаунт создан в прежней версии приложения. Подключите его единственный ключ один раз. Затем фотографии и переписка будут открываться автоматически.': 'This account was created in a previous version. Connect its single account key once. Photos and messages will then open automatically.',
  'Ввести ключ аккаунта': 'Enter account key',
  'Не удалось подключить фотографии. Проверьте соединение и повторите. Ваши данные сохранены.': 'Could not connect photos. Check your connection and retry. Your data is preserved.',
  'Повторить': 'Retry',

  'Импортировать резервную копию': 'Import recovery backup',
  'На этом устройстве пока нет ключей фотографий. Введите сохранённый ключ PB4 или подтвердите устройство с другого подключённого устройства. После этого фото будут открываться автоматически.': 'This device does not have your photo keys yet. Enter your saved PB4 key or approve this device from another connected device. Photos will then open automatically.',
  'Фотографии всегда шифруются на устройстве. Отдельный PIN для них не нужен. Здесь хранятся настройки резервной копии и подключения других устройств.': 'Photos are always encrypted on your device. They do not require a separate PIN. Manage backups and link other devices here.',
  'Повторить открытие на этом устройстве': 'Retry opening on this device',
  'Начать настройку': 'Start setup',
  'Проверяем доступ к фотографиям…': 'Checking photo access…',
  'Я сохранил резервную копию фотографий': 'I saved the photo backup',
  'Скачать резервную копию аккаунта и фото': 'Download account and photo backup',
  'Аккаунт создан. Сохраните ключ фотографий, чтобы восстановить снимки при потере устройства. В обычной работе фотографии открываются автоматически.': 'Your account is created. Save the photo recovery key so you can restore photos if you lose this device. Photos open automatically during normal use.',
  'Резервная копия фотографий': 'Photo backup',
  'Восстановление фотографий': 'Recover photos',
  'Фотографии и резервная копия': 'Photos and backup',
  'Войдите в аккаунт.': 'Sign in to your account.',
  'Проверяем защиту…': 'Checking protection…',
  'Фотографии, превью, описание и координаты шифруются на устройстве. Ключ PB4 открывает фотографии; PB1 восстанавливает вход в аккаунт. Сохраните оба ключа отдельно от устройства.':
    'Photos, previews, descriptions and coordinates are encrypted on your device. PB4 unlocks photos; PB1 restores your account login. Keep both keys outside this device.',
  'Ключ аккаунта PB1': 'Account key PB1',
  'Для этого аккаунта ещё не созданы ключи фотографий. Введите ключ восстановления аккаунта PB1, сохранённый при регистрации. После настройки снимки будут открываться автоматически.': 'Photo keys have not been created for this account yet. Enter the PB1 account recovery key you saved at registration. Once set up, photos will open automatically.',
  'Настроить фотографии': 'Set up photos',
  'Ключ восстановления фотографий': 'Photo recovery key',
  'Скачать ключ PB4': 'Download PB4 key',
  'Я сохранил ключ вне этого устройства. Без него фотографии нельзя восстановить.':
    'I saved the key outside this device. Photos cannot be recovered without it.',
  'Я сохранил ключ — продолжить': 'I saved the key — continue',
  'Ключ фотографий PB4': 'Photo key PB4',
  'Восстановить доступ к фото': 'Restore photo access',
  'После пяти неверных попыток потребуется PB4.':
    'After five incorrect attempts, PB4 is required.',
  'Открыть фотографии': 'Open photos',
  'Фотографии разблокированы на этой странице. При перезагрузке потребуется PB4.':
    'Photos are unlocked in this page. Reloading requires PB4.',
  'Подготовить камеру': 'Prepare camera',
  'Сверьте эти отпечатки с участниками лично или по другому доверенному каналу.':
    'Compare these fingerprints with participants in person or through another trusted channel.',
  'Исполнители получают доступ только к своим кадрам. Сверьте состав и права с заданием.':
    'Contributors can access only their own photos. Compare the participants and permissions with the assignment.',
  'Отпечатки проверены': 'Fingerprints verified',
  'PIN на 4, 6 или 8 цифр': 'PIN with 4, 6 or 8 digits',
  'PIN закрывает интерфейс при сворачивании приложения. Он действует только до перезагрузки и не заменяет PB4.':
    'PIN closes the interface when the app is hidden. It lasts until reload and does not replace PB4.',
  'Установить PIN': 'Set PIN',
  'Заменить ключ восстановления PB4': 'Replace PB4 recovery key',
  'Заблокировать фотографии': 'Lock photos',
  'Старые фотографии пока остаются в прежней библиотеке. Их перенос и удаление старых копий требуют отдельного подтверждения.':
    'Existing photos remain in the previous library. Migration and deletion of old copies require separate confirmation.',
  'Перенести старые фотографии': 'Migrate existing photos',
  'Приложение создаст зашифрованную копию, заново прочитает её и сравнит оригинал, данные и локальные версии. Существующий срок хранения не продлевается; для старых бессрочных снимков новая облачная копия хранится до 14 дней. Удаление прежних файлов — отдельный шаг.':
    'The app creates an encrypted copy, reads it back and compares the original, metadata and local versions. Existing expiry is never extended; copies of old photos with no expiry are stored for up to 14 days. Deleting previous files is a separate step.',
  'Создать и проверить зашифрованную копию': 'Create and verify encrypted copy',
  'Удалить выбранный старый оригинал после проверки копии':
    'Delete the selected old original after verifying its copy',
  'Удалить старую копию': 'Delete old copy',
  'Нет старых фотографий для переноса.':
    'There are no existing photos to migrate.',
  'Зашифрованная очередь': 'Encrypted queue',
  'При изменении участников потребуется обновить получателей недоставленных кадров. Оригинал и его срок хранения сохраняются.':
    'When participants change, update recipients for undelivered photos. The original and its expiry remain intact.',
  'Ожидает доставки': 'Awaiting delivery',
  'Есть недоставленные изменения данных': 'Metadata changes await delivery',
  'Координаты ожидают доставки': 'Coordinates await delivery',
  'Обновить получателей': 'Update recipients',
  'Подключить с открытого устройства': 'Link from an unlocked device',
  'Откройте «Защиту фотографий» на другом устройстве этого аккаунта. Введите ID запроса и сверьте полный отпечаток.':
    'Open Photo protection on another device of this account. Enter the request ID and compare the full fingerprint.',
  'ID запроса': 'Request ID',
  'Отпечаток запроса': 'Request fingerprint',
  'Получить подтверждение': 'Receive approval',
  'ID запроса с нового устройства': 'Request ID from the new device',
  'Отпечаток с нового устройства': 'Fingerprint from the new device',
  'Скопируйте данные непосредственно с нового устройства. Подтверждайте только собственное устройство.':
    'Copy these values directly from the new device. Approve only your own device.',
  'Подтвердить устройство': 'Approve device',
  'Устройство подтверждено. Завершите подключение на нём.':
    'Device approved. Complete linking on that device.',
  'Камера подготовлена. Можно снимать и после блокировки фотографий.':
    'Camera prepared. You can capture after locking photos.',
  'PIN установлен для текущего открытия приложения.':
    'PIN is set for the current app session.',
  'Зашифрованная копия и версии проверены. Старые файлы пока сохранены.':
    'Encrypted copy and versions verified. Previous files are still preserved.',
  'Удаление выбранной старой копии подтверждено.':
    'Deletion of the selected old copy is confirmed.',
  'На этом устройстве': 'On this device',
  'Прежняя библиотека аккаунта': 'Previous account library',
  'Подтверждённая старая библиотека': 'Verified legacy library',
  Владелец: 'Owner',
  Куратор: 'Curator',
  Исполнитель: 'Contributor',
  Наблюдатель: 'Viewer',
  'Оригиналы и данные': 'Originals and metadata',
  'Только миниатюры': 'Thumbnails only',
  'Без ключей чтения': 'No read keys',
  'Проверьте ключ PB4 и подключение к сети. Если время на устройстве сбилось, исправьте его.':
    'Check PB4 and your connection. Correct the device clock if necessary.',
  'Сверьте состав участников, права и новые отпечатки ниже, затем подтвердите.':
    'Review participants, permissions and new fingerprints below, then confirm.',
  'Состав изменился во время проверки. Подготовьте камеру заново и повторите сверку.':
    'Participants changed during review. Prepare the camera again and repeat verification.',
  'Владелец задания должен обновить защиту участников.':
    'The assignment owner must update participant protection.',
  'Все участники должны сначала включить защиту фотографий в своём Профиле.':
    'Every participant must first enable photo protection in their Profile.',
  'Ключ участника изменился или сервер вернул устаревшие данные. Повторная сверка необходима; отправка остановлена.':
    'A participant key changed or the server returned older data. Verification is required; delivery is stopped.',
  'Неверный PIN. После пяти попыток потребуется PB4.':
    'Incorrect PIN. After five attempts, PB4 is required.',
  'Сначала перенесите этот снимок в разделе «Фотографии и резервная копия». Старый оригинал сохранён.':
    'First migrate this photo in Photo protection. The old original is preserved.',
  'Разблокируйте фотографии ключом PB4.': 'Unlock photos with PB4.',
  'Разрешите приложению хранить данные в браузере. Очередь не сохранена.':
    'Allow browser storage for this app. The queue was not saved.',
  'Копия проверена. Если данные оригинала изменились, удаление будет остановлено.':
    'Copy verified. Deletion stops if the original has changed.',
  'Зашифрованная копия проверена. Если оригинал изменился, удаление будет остановлено.':
    'The encrypted copy is verified. Cleanup stops if the original has changed.',
  'Удаляется только выбранная копия. Другие устройства и локальные копии проверяются и очищаются отдельно, чтобы сохранить недоставленные изменения.':
    'Only the selected copy is deleted. Copies on other devices are verified and cleaned separately to preserve unsent changes.',
  'Фотографии шифруются на устройстве. Камера и геолокация зависят от разрешений браузера.':
    'Photos are encrypted on this device. Camera and location require browser permissions.',
  'Удаление ожидает подтверждения сервера':
    'Deletion awaits server confirmation',
  'Повторить удаление': 'Retry deletion',
  'Удаление ожидает подтверждения сервера. Проверьте подключение и права.':
    'Deletion awaits server confirmation. Check your connection and permissions.',
  'Слишком много запросов. Подождите немного и повторите. Вход в аккаунт сохранён.': 'Too many requests. Wait briefly and retry. Your account stays signed in.',
  'Состав или правила задания изменились. Подготовьте защиту заново.': 'Assignment members or rules changed. Prepare protection again.',
  'Сервер временно недоступен. Проверьте связь и повторите; ключи сохранены на устройстве.': 'The server is temporarily unavailable. Check your connection and retry; your keys remain on this device.',

}
// Never show an untranslated Russian source key in English. Static audit
// checks q('literal') call sites against the complete English catalogue.
export const q = (message: string): string =>
  locale.value === 'ru' ? message : (english[message] ?? 'Translation unavailable')
export const roleLabel = (role: string) =>
  q(
    (
      {
        owner: 'Владелец',
        curator: 'Куратор',
        contributor: 'Исполнитель',
        viewer: 'Наблюдатель',
      } as Record<string, string>
    )[role] ?? role,
  )
export const scopeLabel = (scope: string) =>
  q(
    (
      {
        all: 'Оригиналы и данные',
        thumbnails: 'Только миниатюры',
        none: 'Без ключей чтения',
      } as Record<string, string>
    )[scope] ?? scope,
  )
export function securityError(error: unknown): string {
  if(error instanceof IdentityError && error.status===429)return q('Слишком много запросов. Подождите немного и повторите. Вход в аккаунт сохранён.')
  if(error instanceof IdentityError && error.status===409)return q('Состав или правила задания изменились. Подготовьте защиту заново.')
  if(error instanceof IdentityError && error.status===503)return q('Сервер временно недоступен. Проверьте связь и повторите; ключи сохранены на устройстве.')
  const code = error instanceof Error ? error.message : ''
  const messages: Record<string, string> = {
    'crypto.migrate_first':
      'Сначала перенесите этот снимок в разделе «Фотографии и резервная копия». Старый оригинал сохранён.',
    'crypto.review_required':
      'Сверьте состав участников, права и новые отпечатки ниже, затем подтвердите.',
    'crypto.review_changed':
      'Состав изменился во время проверки. Подготовьте камеру заново и повторите сверку.',
    'crypto.owner_must_prepare':
      'Владелец задания должен обновить защиту участников.',
    'crypto.participants_not_ready':
      'Все участники должны сначала включить защиту фотографий в своём Профиле.',
    'crypto.key_changed':
      'Ключ участника изменился или сервер вернул устаревшие данные. Повторная сверка необходима; отправка остановлена.',
    'crypto.rollback':
      'Ключ участника изменился или сервер вернул устаревшие данные. Повторная сверка необходима; отправка остановлена.',
    'crypto.invalid_pin': 'Неверный PIN. После пяти попыток потребуется PB4.',
    'crypto.strong_required': 'Разблокируйте фотографии ключом PB4.',
    'crypto.storage_failed':
      'Разрешите приложению хранить данные в браузере. Очередь не сохранена.',
    'crypto.storage_unavailable':
      'Разрешите приложению хранить данные в браузере. Очередь не сохранена.',
  }
  return q(
    messages[code] ??
      'Проверьте ключ PB4 и подключение к сети. Если время на устройстве сбилось, исправьте его.',
  )
}
