import { locale } from '../i18n'
const copy = {
  pending: ['ID после подключения', 'ID after reconnect'],
  unavailable: ['Постоянный ID будет выдан при подключении к серверу.', 'Permanent ID will be assigned after connecting to the server.'],
} as const
export function nameText(key: keyof typeof copy): string {
  return copy[key][locale.value === 'ru' ? 0 : 1]
}
