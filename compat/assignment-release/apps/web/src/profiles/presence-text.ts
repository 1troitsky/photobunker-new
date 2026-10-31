import { locale } from '../i18n'
import type { PresenceState, PresenceVisibility } from './presence'
const text = {
  title: ['Статус присутствия', 'Presence status'],
  description: ['Кто видит, что вы онлайн или заходили недавно. Точное время активности не показывается.', 'Choose who can see whether you are online or were active recently. Exact activity times are never shown.'],
  all: ['Все', 'Everyone'],
  contacts: ['Контакты', 'Contacts'],
  nobody: ['Никто', 'Nobody'],
  online: ['Онлайн', 'Online'],
  recent: ['Был(а) недавно', 'Active recently'],
  longAgo: ['Был(а) давно', 'Active a while ago'],
  hidden: ['Статус скрыт', 'Status hidden'],
  unknown: ['Статус недоступен', 'Status unavailable'],
  pending: ['Сохранено на устройстве. Ожидает подтверждения сервера.', 'Saved on this device. Awaiting server confirmation.'],
  conflict: ['Настройка изменена на другом устройстве. Показан подтверждённый сервером выбор.', 'Privacy changed on another device. Showing the server-confirmed choice.'],
  offline: ['Не удалось подтвердить настройку. Она останется в защищённой очереди до подключения.', 'Unable to confirm the choice. It remains in the encrypted queue until reconnect.'],
  save: ['Не удалось сохранить на устройстве. Выбор не изменён.', 'Could not save on this device. Your choice was not changed.'],
  hint: ['Контакты — только взаимно добавленные пользователи. При потере соединения онлайн исчезает после короткого таймаута.', 'Contacts means mutually added users only. Online expires shortly after disconnect.'],
  retry: ['Повторить синхронизацию', 'Retry sync'],
} as const
export const presenceText=(key:keyof typeof text)=>text[key][locale.value==='ru'?0:1]
export const presenceLabel=(state:PresenceState)=>presenceText(state)
export const visibilityLabel=(state:PresenceVisibility)=>presenceText(state)
