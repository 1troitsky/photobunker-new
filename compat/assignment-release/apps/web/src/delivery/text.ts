import { locale } from '../i18n'
const copy = {
  retention: ['Хранение фотографий', 'Photo retention'], duration: ['Удалять после съёмки через', 'Delete after capture in'],
  hour: ['1 час', '1 hour'], day: ['1 день', '1 day'], week: ['7 дней', '7 days'], fortnight: ['14 дней', '14 days'],
  retentionHint: ['Отправка начинается автоматически. Срок считается от съёмки и не продлевается при потере сети. Максимум в этой версии — 14 дней.', 'Upload starts automatically. Retention begins at capture and does not restart after a network interruption. This version allows up to 14 days.'],
  clockHint: ['Без сети время удаления — оценка. Срок на сервере может быть короче из-за последней проверки времени. Закрытое приложение очистит местные файлы при следующем открытии.', 'Offline deletion time is an estimate. The server deadline can be earlier because of the last time check. A closed app clears local files when next opened.'],
  expires: ['Удаление', 'Deletion'], noExpiry: ['Срок не задан — прежний снимок', 'No deadline — earlier photo'],
  shorten: ['Сократить срок хранения', 'Shorten retention'], deadline: ['Новая дата удаления', 'New deletion date'], apply: ['Применить срок', 'Apply deadline'],
  shorterOnly: ['Срок можно только сократить. Скачанные копии остаются у получателя.', 'Retention can only be shortened. Downloaded copies remain with the recipient.'],
  pending: ['Фото ещё не загружено на сервер', 'Photo is not uploaded to the server yet'], sending: ['Отправляем сохранённые фотографии…', 'Uploading saved photos…'],
  dirty: ['Изменения сохранены в браузере и ждут отправки', 'Changes are saved in this browser and await upload'],
  deleting: ['Доступ закрыт. Удаление файлов ожидает подтверждения сервера', 'Access is closed. File deletion awaits server confirmation'],
  retry: ['Повторить отправку', 'Retry delivery'], network: ['Нет связи с сервером. Повторим автоматически', 'Server unavailable. Delivery will retry automatically'],
  quota: ['На сервере недостаточно места. Освободите место и повторите', 'The server has insufficient space. Free space and retry'],
  permission: ['Сервер отклонил отправку. Проверьте доступ к библиотеке', 'The server rejected delivery. Check library access'],
  conflict: ['Данные изменены в другом окне. Откройте актуальную серверную версию', 'Data changed in another window. Open the current server version'],
  clock: ['Не удалось подтвердить время съёмки. Проверьте соединение и часы. Кадр без исходной проверки времени нужно снять заново', 'Capture time could not be confirmed. Check your connection and clock. A photo without an original time anchor must be retaken'],
  storage: ['Не удалось открыть хранилище браузера. Очередь недоступна', 'Browser storage could not be opened. The queue is unavailable'],
  tags: ['Метки', 'Tags'], tagsHint: ['Через запятую: до 20 меток, каждая до 40 символов', 'Comma separated: up to 20 tags, 40 characters each'],
  allCategories: ['Все категории', 'All categories'], completion: ['Выполнение требований', 'Requirements'], all: ['Все', 'All'], complete: ['Выполнены', 'Complete'], incomplete: ['Нужно дополнить', 'Incomplete'],
  from: ['Снято с', 'Captured from'], to: ['Снято по', 'Captured through'], select: ['Выбрать фотографии', 'Select photos'], selectAll: ['Выбрать найденные', 'Select matching'], clear: ['Снять выбор', 'Clear selection'],
  selected: ['Выбрано', 'Selected'], selectPhoto: ['Выбрать снимок', 'Select photo'], favorite: ['В избранное', 'Add to favourites'], remove: ['Удалить выбранные', 'Delete selected'],
  bulkHour: ['Хранить не дольше часа с этого момента', 'Keep for at most one more hour'], bulkConfirm: ['Закрыть доступ к выбранным снимкам и удалить их? Отмена невозможна.', 'Close access and delete selected photos? This cannot be undone.'],
  bulkFailed: ['Часть действий не выполнена. Эти снимки остались выбранными — можно повторить.', 'Some actions failed. Those photos remain selected so you can retry.'],
  bulkDone: ['Действие выполнено', 'Action completed'], reload: ['Открыть серверную версию', 'Open server version'],
} as const
export type DeliveryText = keyof typeof copy
export function d(key: DeliveryText) { return copy[key][locale.value === 'ru' ? 0 : 1] }
