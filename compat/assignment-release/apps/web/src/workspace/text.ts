import { locale } from '../i18n'
const copy = {
  account: ['Аккаунт', 'Account'],
  device: ['На этом устройстве', 'On this device'],
  owner: ['Владелец', 'Owner'],
  invitations: ['Приглашения', 'Invitations'],
  accept: ['Принять', 'Accept'],
  decline: ['Отклонить', 'Decline'],
  invited: ['Приглашён', 'Invited'],
  accepted: ['Участвует', 'Joined'],
  declined: ['Отклонил', 'Declined'],
  expired: ['Приглашение истекло', 'Invitation expired'],
  leave: ['Покинуть', 'Leave'],
  refresh: ['Обновить', 'Refresh'],
  retry: ['Повторить', 'Retry'],
  sending: ['Загружаем фото', 'Uploading photos'],
  pendingPhotos: [
    'Фото ещё не загружены в аккаунт',
    'Photos have not been uploaded to your account',
  ],
  unavailable: [
    'Нет связи с сервером. Данные формы сохранены для повторной попытки.',
    'The server is unavailable. Your form remains available for retry.',
  ],
  cryptoChanged: ['Получатели или версия данных изменились. Откройте «Защиту фотографий» и проверьте очередь.', 'Recipients or data revision changed. Open Photo protection and check the queue.'],
  encryptedQuota: ['Недостаточно места для доставки. Зашифрованный снимок сохранён на устройстве.', 'Not enough storage for delivery. The encrypted photo remains on your device.'],
  accessChanged: [
    'Доступ или правила изменились. Обновите задание перед повторной попыткой.',
    'Access or rules changed. Refresh the assignment before retrying.',
  ],
  retention: [
    'Для облака сейчас доступен срок от 1 часа до 14 дней. Снимок сохранён на устройстве.',
    'Cloud storage currently allows 1 hour to 14 days. The photo remains on this device.',
  ],
  conflict: [
    'Запись уже изменилась. Обновите её перед редактированием.',
    'This record changed. Refresh it before editing.',
  ],
  participantError: [
    'Укажите ID принятого контакта или участника выбранной команды. Проверьте поля формы.',
    'Use an accepted contact or a member of the selected team. Check the form fields.',
  ],
  inviteHint: [
    'После сохранения участники получат приглашения. Доступ появится только после принятия.',
    'Saving sends invitations. Access starts only after acceptance.',
  ],
  teamHint: [
    'Команда хранится в аккаунте. Её состав не выдаёт доступ ко всем заданиям и фото.',
    'Teams belong to your account. Team membership does not grant access to every assignment or photo.',
  ],
  taskHint: [
    'Права на материалы задаются отдельно от команды и обсуждения.',
    'Photo permissions are separate from team and discussion membership.',
  ],
  discussion: ['Обсуждение', 'Discussion'],
  discussionPending: [
    'Обсуждение ещё обновляется. Права на фото уже применены.',
    'Discussion updates are pending. Photo permissions have already changed.',
  ],
  discussionHint: [
    'Название и состав обсуждения видны Matrix-серверу. Сообщения шифруются.',
    'The Matrix server can see the discussion title and members. Messages are encrypted.',
  ],
  photoScope: ['Доступ к фотографиям', 'Photo access'],
  defaultScope: ['По правилам задания', 'Assignment defaults'],
  none: ['Без просмотра', 'No viewing'],
  thumbnails: ['Только миниатюры', 'Thumbnails only'],
  all: ['Полный просмотр', 'Full view'],
  own: ['Свои фотографии', 'Own photos'],
  thumbnailOnly: [
    'Доступна только миниатюра',
    'Only the thumbnail is available',
  ],
  openPhoto: ['Открыть фото', 'Open photo'],
  discussPhoto: ['Обсудить снимок', 'Discuss photo'],
  photoReference: ['Фотография PhotoBunker', 'PhotoBunker photograph'],
  readOnly: ['Доступ только для просмотра', 'Read-only access'],
  import: ['Перенести прежние данные', 'Import earlier data'],
  importHint: [
    'Будут созданы копии в этом аккаунте. Старые записи останутся на устройстве и в прежней библиотеке. Участников нужно назначить заново: приглашения автоматически не отправляются.',
    'Copies will be created in this account. Earlier records stay on the device and in the legacy library. Assign participants again; no invitations are sent automatically.',
  ],
  importPhotos: ['Также скопировать фотографии', 'Also copy photographs'],
  importDone: [
    'Перенос завершён. Исходные данные сохранены.',
    'Import complete. Original data has been kept.',
  ],
  importConfirm: [
    'Скопировать выбранные данные в текущий аккаунт?',
    'Copy the selected data into the current account?',
  ],
  legacy: ['Прежняя библиотека', 'Legacy library'],
  local: ['Данные этого устройства', 'Data on this device'],
  importBusy: ['Копируем данные…', 'Copying data…'],
  noImport: ['Нет данных для переноса', 'No data to import'],
  received: ['Получено сервером', 'Received by server'],
  uploaded: ['Отправленные материалы', 'Submitted material'],
  noPhotoRead: [
    'Снимки отправляются куратору. Просмотр материалов не разрешён.',
    'Photos are sent to the curator. Viewing material is not allowed.',
  ],
  closed: [
    'Задание завершено или срок истёк',
    'The assignment is completed or expired',
  ],
  save: ['Сохранить', 'Save'],
  cancel: ['Отмена', 'Cancel'],
  create: ['Создать', 'Create'],
  revoked: ['Доступ отозван', 'Access revoked'],
  author: ['Автор', 'Author'],
} as const
export type WorkspaceText = keyof typeof copy
export function w(key: WorkspaceText) {
  return copy[key][locale.value === 'ru' ? 0 : 1]
}
