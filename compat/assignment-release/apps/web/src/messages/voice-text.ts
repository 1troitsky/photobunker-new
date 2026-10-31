import { locale } from '../i18n'
const copy = {
  voice: ['Голосовое сообщение', 'Voice message'], record: ['Записать голосовое сообщение', 'Record voice message'],
  recording: ['Запись голоса', 'Recording voice'], stop: ['Остановить запись', 'Stop recording'],
  cancel: ['Отменить запись', 'Cancel recording'], send: ['Отправить голосовое сообщение', 'Send voice message'],
  preview: ['Прослушать запись', 'Preview recording'], delete: ['Удалить запись', 'Delete recording'],
  pause: ['Пауза записи', 'Pause recording'], resume: ['Продолжить запись', 'Resume recording'],
  lock: ['Закрепить запись', 'Lock recording'], hint: ['Влево — отмена, вверх — запись без удержания', 'Slide left to cancel, up to lock recording'],
  locked: ['Запись без удержания', 'Recording locked'], preparing: ['Включаем микрофон…', 'Starting microphone…'],
  denied: ['Разрешите доступ к микрофону в настройках браузера.', 'Allow microphone access in browser settings.'],
  unavailable: ['Не удалось включить запись. Проверьте микрофон и повторите.', 'Could not record. Check your microphone and retry.'],
  unsupported: ['Этот браузер не поддерживает запись голоса.', 'This browser cannot record voice messages.'],
  tooShort: ['Запись слишком короткая. Удерживайте микрофон дольше.', 'Recording is too short. Hold the microphone longer.'],
  tooLarge: ['Запись слишком большая. Максимум 10 минут или 20 МБ.', 'Recording is too large. Maximum 10 minutes or 20 MB.'],
  sendFailed: ['Не удалось отправить запись. Она сохранена здесь для повторной отправки.', 'Could not send. The recording is kept here so you can retry.'],
  play: ['Прослушать голосовое сообщение', 'Play voice message'], pausePlay: ['Приостановить воспроизведение', 'Pause playback'],
  loading: ['Загружаем голосовое сообщение…', 'Loading voice message…'], failed: ['Не удалось загрузить или расшифровать запись. Повторите.', 'Could not load or decrypt the recording. Retry.'],
  speed: ['Скорость воспроизведения', 'Playback speed'], seek: ['Позиция воспроизведения', 'Playback position'],
  playAgain: ['Нажмите воспроизведение ещё раз.', 'Tap play again.'], discard: ['Удалить неотправленную голосовую запись?', 'Discard the unsent voice recording?'],
} as const
export const voiceText = (key: keyof typeof copy) => copy[key][locale.value === 'ru' ? 0 : 1]
