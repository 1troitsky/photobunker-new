import { locale } from '../i18n'
const copy = {
  title: ['Профиль пользователя', 'User profile'], open: ['Открыть профиль', 'Open profile'],
  loading: ['Загружаем профиль…', 'Loading profile…'], retry: ['Повторить', 'Retry'],
  share: ['Поделиться профилем', 'Share profile'], shared: ['Ссылка на профиль скопирована', 'Profile link copied'],
  shareLink: ['Ссылка на профиль', 'Profile link'], shareHint: ['Отправьте эту ссылку человеку, с которым хотите поделиться профилем.', 'Send this link to someone you want to share the profile with.'],
  id: ['ID PhotoBunker', 'PhotoBunker ID'], username: ['Username', 'Username'],
  add: ['Добавить в контакты', 'Add to contacts'], added: ['В ваших контактах', 'In your contacts'],
  removeQuestion: ['Удалить пользователя из контактов?', 'Remove this user from contacts?'],
  removeHint: ['Переписка сохранится. Пользователь больше не будет видеть ваши поля анкеты для контактов.', 'The conversation will remain. This user will no longer see your contact-only profile fields.'],
  blockQuestion: ['Заблокировать пользователя?', 'Block this user?'],
  blockHint: ['Пользователь будет удалён из контактов и не сможет написать или позвонить вам в приложении. Существующая переписка сохранится.', 'The user will be removed from contacts and cannot message or call you in the app. The existing conversation will remain.'],
  blocked: ['Пользователь заблокирован', 'User blocked'],
  privacy: ['Здесь показана вся информация, которую пользователь разрешил вам видеть.', 'This is all the information the user has allowed you to see.'],
  noInfo: ['Пользователь не открыл дополнительные сведения.', 'This user has not shared additional information.'],
  signIn: ['Войдите, чтобы открыть профиль и начать общение.', 'Sign in to view this profile and start a conversation.'],
  failed: ['Не удалось загрузить профиль. Проверьте соединение и повторите.', 'Could not load the profile. Check your connection and retry.'],
  actionFailed: ['Не удалось выполнить действие. Проверьте соединение и повторите.', 'Could not complete the action. Check your connection and retry.'],
  rateLimited: ['Запросы временно ограничены. Повторите позже.', 'Requests are temporarily limited. Try again later.'],
  opening: ['Открываем переписку…', 'Opening conversation…'],
} as const
export const personText = (key: keyof typeof copy) => copy[key][locale.value === 'ru' ? 0 : 1]
