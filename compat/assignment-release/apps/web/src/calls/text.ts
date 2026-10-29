import { locale } from '../i18n'
const copy = {
  idle: ['Звонок завершён', 'Call ended'],
  audio: ['Аудиозвонок', 'Audio call'],
  video: ['Видеозвонок', 'Video call'],
  answer: ['Ответить', 'Answer'],
  decline: ['Отклонить', 'Decline'],
  end: ['Завершить звонок', 'End call'],
  mic: ['Микрофон', 'Microphone'],
  camera: ['Камера', 'Camera'],
  incoming: ['Входящий звонок', 'Incoming call'],
  join: ['Присоединиться', 'Join'],
  connecting: ['Подключаем звонок…', 'Connecting call…'],
  connected: ['Звонок подключён', 'Call connected'],
  reconnecting: ['Восстанавливаем связь…', 'Reconnecting…'],
  ending: ['Завершаем звонок…', 'Ending call…'],
  encrypted: [
    'Медиа зашифрованы между участниками',
    'Media encrypted between participants',
  ],
  waiting: ['Ожидаем участников', 'Waiting for participants'],
  unsupported: [
    'Браузер не поддерживает защищённые звонки. Используйте актуальный браузер с поддержкой медиашифрования.',
    'This browser cannot make encrypted calls. Use a current browser with media encryption support.',
  ],
  denied: [
    'Разрешите доступ к микрофону или камере в настройках браузера.',
    'Allow microphone or camera access in browser settings.',
  ],
  unavailable: [
    'Не удалось подключить звонок. Проверьте сеть и повторите.',
    'Could not connect. Check your connection and retry.',
  ],
  access: [
    'Доступ к звонку закрыт. Проверьте участие в чате.',
    'Call access was removed. Check your chat membership.',
  ],
  crypto: [
    'Не удалось защитить медиапоток. Звонок остановлен.',
    'Media encryption failed. The call was stopped.',
  ],
  sound: ['Включить звук', 'Enable audio'],
  close: ['Закрыть', 'Close'],
  leave: [
    'Завершить звонок и перейти в другой раздел?',
    'End this call and leave this section?',
  ],
  you: ['Вы', 'You'],
  cameraOff: ['Камера выключена', 'Camera off'],
  active: ['В чате идёт звонок', 'Call in progress'],
  declined: [
    'Звонок отклонён на этом устройстве',
    'Call declined on this device',
  ],
  ready: [
    'Входящие доступны, пока открыт раздел «Сообщения».',
    'Incoming calls are available while Messages is open.',
  ],
  busy: ['Сначала завершите текущий звонок.', 'End the current call first.'],
} as const
export type CallText = keyof typeof copy
export const t = (key: CallText) => copy[key][locale.value === 'ru' ? 0 : 1]
