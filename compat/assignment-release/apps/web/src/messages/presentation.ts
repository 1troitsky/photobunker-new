import { locale, formatDate, formatNumber } from '../i18n'
const copy = {
  search: ['Поиск чатов и сообщений', 'Search chats and messages'], searchChat: ['Поиск сообщений', 'Search messages'],
  searchHistory: ['Искать сообщения во всех чатах', 'Search messages in all chats'], searching: ['Ищем в истории…', 'Searching history…'],
  archive: ['Архив', 'Archived chats'], archiveAction: ['В архив', 'Archive'], unarchive: ['Из архива', 'Unarchive'],
  deleteChat: ['Удалить чат', 'Delete chat'], chatActions: ['Действия с чатом', 'Chat actions'], messageActions: ['Действия с сообщением', 'Message actions'],
  select: ['Выбрать сообщения', 'Select messages'], selectOne: ['Выбрать', 'Select'], selectAll: ['Выбрать все', 'Select all'], cancelSelection: ['Отменить выбор', 'Cancel selection'],
  deleteMine: ['Удалить у меня', 'Delete for me'], deleteAll: ['Удалить у всех', 'Delete for everyone'],
  pin: ['Закрепить', 'Pin'], unpin: ['Открепить', 'Unpin'], pinned: ['Закреплённое сообщение', 'Pinned message'],
  newGroup: ['Создать группу', 'New group'], newMessage: ['Новое сообщение', 'New message'],
  lookup: ['ID или @username', 'ID or @username'], lookupHint: ['ID, @username или имя контакта', 'ID, @username or contact name'], write: ['Написать', 'Message'],
  findingPerson: ['Ищем пользователя…', 'Finding user…'], personFound: ['Найденный пользователь', 'User found'],
  lookupFailed: ['Не удалось найти пользователя. Проверьте соединение и повторите поиск.', 'Could not look up the user. Check your connection and retry.'],
  callsUnavailable: ['Звонки сейчас недоступны.', 'Calls are currently unavailable.'],
  noMatches: ['Ничего не найдено', 'No results'], noMatchesHint: ['Попробуйте другое имя или слово.', 'Try another name or word.'],
  emptyHint: ['Нажмите +, чтобы написать человеку или создать группу.', 'Tap + to message someone or create a group.'],
  threadEmpty: ['Выберите чат', 'Select a chat'], threadEmptyHint: ['Откройте переписку слева или начните новую.', 'Open a conversation on the left or start a new one.'],
  direct: ['Личная переписка', 'Direct conversation'], participant: ['Пользователь', 'User'],
  members: ['участников', 'members'], today: ['Сегодня', 'Today'], yesterday: ['Вчера', 'Yesterday'],
  noMessages: ['Сообщений пока нет', 'No messages yet'], firstMessage: ['Напишите первое сообщение', 'Send the first message'],
  jump: ['К последним сообщениям', 'Jump to latest messages'], loadingHistory: ['Загружаем историю…', 'Loading history…'],
  historyFailed: ['Не удалось загрузить сообщения. Повторите загрузку.', 'Could not load messages. Retry loading.'],
  closeSearch: ['Закрыть поиск', 'Close search'], clearSearch: ['Очистить поиск', 'Clear search'],
  messageSelected: ['Выбрано', 'Selected'], contacts: ['Контакты', 'Contacts'],
  deletedMessage: ['Сообщение удалено', 'Message deleted'], delete: ['Удалить', 'Delete'],
  attachmentAdd: ['Прикрепить файл', 'Attach file'], attachmentRemove: ['Убрать вложение', 'Remove attachment'],
  attachmentOpen: ['Открыть изображение', 'Open image'], attachmentDownload: ['Скачать файл', 'Download file'],
  attachmentLoading: ['Расшифровываем…', 'Decrypting…'], attachmentSending: ['Шифруем и отправляем…', 'Encrypting and uploading…'],
  attachmentFailed: ['Не удалось открыть вложение. Повторите.', 'Could not decrypt the attachment. Retry.'],
  attachmentInvalid: ['Можно отправить JPG, PNG, WebP, PDF, TXT или ZIP размером до 15 МБ.', 'Choose JPG, PNG, WebP, PDF, TXT, or ZIP up to 15 MB.'],
  attachmentOriginalNote: ['Фото будет уменьшено при необходимости, метаданные удалены. Документы могут содержать свои метаданные.', 'Images are resized if needed and metadata is removed. Documents may contain embedded metadata.'],
  attachmentSendFailed: ['Не удалось отправить вложение. Файл оставлен для повторной попытки.', 'Attachment failed to send. The file remains available for retry.'],
  edit: ['Редактировать', 'Edit'], editing: ['Редактирование сообщения', 'Editing message'],
  saveEdit: ['Сохранить изменения', 'Save changes'], cancelEdit: ['Отменить редактирование', 'Cancel editing'],
  edited: ['изменено', 'edited'], editFailed: ['Не удалось изменить сообщение. Текст сохранён для повторной попытки.', 'Could not edit the message. Your text is kept for retry.'],
  react: ['Реакция', 'React'], reactions: ['Реакции', 'Reactions'],
  folderManage: ['Папки чатов', 'Chat folders'], folderCreate: ['Создать папку', 'Create folder'],
  folderName: ['Название папки', 'Folder name'], folderRename: ['Переименовать', 'Rename'],
  folderSave: ['Сохранить', 'Save'], folderRemove: ['Удалить папку', 'Delete folder'],
  folderAdd: ['Добавить в папку', 'Add to folder'], folderUnassign: ['Убрать из папки', 'Remove from folder'],
  folderPrivate: ['Папки зашифрованы только на этом устройстве и не синхронизируются.', 'Folders are encrypted on this device only and do not sync.'],
  folderError: ['Не удалось сохранить папки. Данные не переданы на сервер.', 'Could not save folders. Nothing was sent to the server.'],
  folderEmpty: ['В этой папке пока нет чатов.', 'This folder has no conversations yet.'],
  unreadOnly: ['Непрочитанные', 'Unread'], groupOnly: ['Группы', 'Groups'],
  muted: ['Оповещения отключены', 'Notifications muted'], mute: ['Отключить уведомления', 'Mute notifications'],
  unmute: ['Включить уведомления', 'Unmute notifications'],
  pickerTitle: ['Emoji и стикеры', 'Emoji and stickers'], emojis: ['Emoji', 'Emoji'],
  stickers: ['Стикеры', 'Stickers'], stickerFailed: ['Не удалось подготовить стикер.', 'Could not prepare sticker.'],
  stickerHint: ['Стикеры создаются здесь, без загрузки сторонних наборов, и отправляются зашифрованными изображениями.', 'Stickers are created locally without downloading external packs and sent as encrypted images.'],
  offlineShort: ['Нет подключения', 'No connection'],
  deleteConversation: ['Удалить переписку', 'Delete conversation'], deletingHistory: ['Удаляем историю…', 'Deleting history…'],
  deleteConversationQuestion: ['Будет удалена вся история переписки, включая сообщения, которые ещё не загружены на это устройство.', 'The entire conversation history will be deleted, including messages not yet loaded on this device.'],
  deleteBoth: ['Также удалить сообщения у собеседника', 'Also delete messages for the other person'],
  deleteConversationHint: ['Удаление у меня синхронизируется между моими устройствами. Полученные и сохранённые вне приложения копии удалить невозможно.', 'Deleting for me syncs across my devices. Copies received and saved outside the app cannot be removed.'],
} as const
export function ui(key: keyof typeof copy) { return copy[key][locale.value === 'ru' ? 0 : 1] }
/** Count label with correct Russian one/few/many and English singular/plural. */
export function membersCount(value: number) {
  const n = Math.abs(Math.trunc(value))
  const singular = n % 10 === 1 && n % 100 !== 11
  const few = n % 10 >= 2 && n % 10 <= 4 &&
    (n % 100 < 12 || n % 100 > 14)
  const noun = locale.value === 'ru'
    ? (singular ? 'участник' : few ? 'участника' : 'участников')
    : (n === 1 ? 'member' : 'members')
  return formatNumber(value) + ' ' + noun
}
export function initials(name: string) {
  const words = name.replace(/^@/, '').trim().split(/\s+/).filter(Boolean)
  return ((words[0]?.[0] ?? '?') + (words.length > 1 ? words.at(-1)![0] : '')).toLocaleUpperCase()
}
export function avatarColor(id: string) {
  let hash = 0
  for (const char of id) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0
  return `avatar-color-${Math.abs(hash) % 6}`
}
export function dayLabel(time: number, now = Date.now()) {
  const date = new Date(time), today = new Date(now), yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return ui('today')
  if (date.toDateString() === yesterday.toDateString()) return ui('yesterday')
  return formatDate(date, { day: 'numeric', month: 'long', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' as const } : {}) })
}
export function chatTime(time?: number, now = Date.now()) {
  if (!time) return ''
  const date = new Date(time)
  return date.toDateString() === new Date(now).toDateString()
    ? formatDate(date, { hour: '2-digit', minute: '2-digit' })
    : formatDate(date, { day: 'numeric', month: 'short' })
}
