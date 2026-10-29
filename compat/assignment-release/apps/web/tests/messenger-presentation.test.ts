import { beforeEach, expect, it } from 'vitest'
import { locale } from '../src/i18n'
import { avatarColor, initials, chatTime, dayLabel } from '../src/messages/presentation'
beforeEach(() => { locale.value = 'ru' })
it('builds human initials for Cyrillic names, usernames and missing names', () => {
  expect(initials('  Мария Воронова  ')).toBe('МВ')
  expect(initials('@alex')).toBe('A')
  expect(initials('')).toBe('?')
})
it('keeps the avatar palette stable without rendering identifiers as colors', () => {
  expect(avatarColor('room-one')).toBe(avatarColor('room-one'))
  expect(avatarColor('room-one')).toMatch(/^avatar-color-[0-5]$/)
})
it('uses calendar days for today and yesterday across month boundaries', () => {
  const now = new Date(2026, 9, 1, 12).getTime()
  expect(dayLabel(new Date(2026, 9, 1, 1).getTime(), now)).toBe('Сегодня')
  expect(dayLabel(new Date(2026, 8, 30, 23).getTime(), now)).toBe('Вчера')
  expect(dayLabel(new Date(2025, 8, 30).getTime(), now)).toContain('2025')
})
it('does not show an invented time for a conversation without messages', () => {
  expect(chatTime()).toBe('')
  expect(chatTime(0)).toBe('')
})
