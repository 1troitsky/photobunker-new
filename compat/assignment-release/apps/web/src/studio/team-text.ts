import { locale } from '../i18n'
const copy = {
  teamProfile: ['Профиль команды', 'Team profile'],
  privateOnly: ['Приватная команда. Ссылка не даёт доступ без приглашения.', 'Private team. A link does not grant access without an invitation.'],
  creator: ['Создатель', 'Creator'],
  creatorUnknown: ['Не указан в прежней записи', 'Not available in this legacy record'],
  description: ['Описание', 'Description'],
  noDescription: ['Описание пока не добавлено.', 'No description yet.'],
  noMembers: ['Других участников пока нет.', 'No other members yet.'],
  manageMembers: ['Участники и приглашения', 'Members and invitations'],
  assignments: ['Связанные задания', 'Related assignments'],
  noAssignments: ['Пока нет доступных заданий этой команды.', 'No accessible assignments for this team yet.'],
  completed: ['Завершено', 'Completed'],
  inProgress: ['В работе', 'In progress'],
  copy: ['Копировать ссылку', 'Copy link'],
  copied: ['Ссылка скопирована', 'Link copied'],
  copyFailed: ['Не удалось скопировать ссылку.', 'Could not copy link.'],
  settings: ['Настройки команды', 'Team settings'],
  notAvailable: ['Команда недоступна', 'Team unavailable'],
  loading: ['Загружаем команду…', 'Loading team…'],
  savedLocally: ['Изменения зашифрованы на устройстве. Приглашения ещё не отправлены.', 'Changes are encrypted on this device. Invitations have not been sent yet.'],
  syncFailed: ['Не удалось подтвердить изменения на сервере. Проверьте права и повторите.', 'Server could not confirm changes. Check permissions and retry.'],
  noChat: ['Общий чат команды пока не подключён.', 'The team group chat is not connected yet.'],
  leaveConfirm: ['Покинуть эту команду?', 'Leave this team?'],
} as const
export type TeamTextKey = keyof typeof copy
export const teamText = (key: TeamTextKey) => copy[key][locale.value === 'ru' ? 0 : 1]
