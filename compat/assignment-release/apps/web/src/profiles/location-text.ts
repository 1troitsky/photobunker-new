import { locale } from '../i18n'

const copy = {
  enabled: ['Автоматические координаты', 'Automatic location'],
  description: [
    'После ранее выданного разрешения PhotoBunker определяет местоположение при открытом приложении. Координаты остаются приватными и доступны снимкам только по правилам выбранного пресета или задания.',
    'After permission is granted, PhotoBunker checks your location while the app is open. Coordinates remain private and are used for photos only under the selected preset or assignment rules.',
  ],
  enable: ['Разрешить геолокацию', 'Allow location'],
  disable: ['Отключить GPS', 'Turn off GPS'],
  permission: ['Чтобы добавить координаты, включите геолокацию по нажатию. Без неё съёмка доступна.', 'Allow location with a tap to add coordinates. You can still take photos without it.'],
  denied: ['Геолокация недоступна или отклонена. Проверьте разрешение в браузере; съёмка работает без координат.', 'Location is unavailable or denied. Check browser permissions; photos still work without coordinates.'],
  pending: ['Уточняем координаты. Съёмка не ждёт GPS.', 'Finding your location. Taking photos does not wait for GPS.'],
  photoWithoutGps: ['сохранено без автоматических координат', 'saved without automatic coordinates'],
  notSaved: ['Не удалось сохранить настройку. После перезапуска проверьте её снова.', 'The preference could not be saved. Check it again after restarting the app.'],
  noBackground: ['В PWA на iPhone фоновое отслеживание не гарантируется.', 'Background location updates are not guaranteed in iPhone PWAs.'],
} as const
export type LocationTextId = keyof typeof copy
export function locationText(id: LocationTextId) {
  return copy[id][locale.value === 'ru' ? 0 : 1]
}
