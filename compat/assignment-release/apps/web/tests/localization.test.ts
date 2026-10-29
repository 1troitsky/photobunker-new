// @vitest-environment jsdom
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { formatBytes,formatDate,formatNumber,initializeLocale,languageTag,locale,setLocale,t } from '../src/i18n'
import { q } from '../src/crypto/text'
import { chatTime,dayLabel,ui,membersCount } from '../src/messages/presentation'

beforeEach(()=>{
  localStorage.clear()
  document.documentElement.lang='en'
  initializeLocale()
})
afterEach(()=>vi.restoreAllMocks())

describe('R1-11: device-scoped RU/EN, offline/reload/account switch',()=>{
  it('applies the requested language immediately with no API, and survives reload',()=>{
    expect(setLocale('ru')).toBe(true)
    expect(localStorage.getItem('photobunker.locale')).toBe('ru')
    expect(document.documentElement.lang).toBe('ru')
    expect(t('settingsTitle')).toBe('Настройки')
    initializeLocale()
    expect(locale.value).toBe('ru')
    expect(languageTag()).toBe('ru-RU')
    // Another account selecting the same browser profile must NOT reset it.
    expect(t('settingsTitle')).toBe('Настройки')
    expect(setLocale('en')).toBe(true)
    initializeLocale()
    expect(t('settingsTitle')).toBe('Settings')
  })
  it('reflects cross-tab preference changes without network or stale response state',()=>{
    setLocale('ru')
    localStorage.setItem('photobunker.locale','en')
    window.dispatchEvent(new StorageEvent('storage',{
      key:'photobunker.locale',oldValue:'ru',newValue:'en',storageArea:localStorage,
    }))
    expect(locale.value).toBe('en')
    expect(document.documentElement.lang).toBe('en')
    expect(q('Выполняем…')).toBe('Working…')
    expect(ui('edited')).toBe('edited')
  })
  it('defaults to English on invalid persisted locale and never leaks Russian untranslated q keys',()=>{
    localStorage.setItem('photobunker.locale','future-language')
    initializeLocale()
    expect(locale.value).toBe('en')
    expect(q('Неизвестная строка интерфейса')).toBe('Translation unavailable')
    expect(q('Сохранить')).toBe('Save')
    expect(q('Отмена')).toBe('Cancel')
    setLocale('ru')
    expect(q('Неизвестная строка интерфейса')).toBe('Неизвестная строка интерфейса')
  })
  it('keeps the active language even when storage is denied',()=>{
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('Denied','SecurityError')})
    expect(setLocale('en')).toBe(false)
    expect(locale.value).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })
  it('formats dates, times, counts and file sizes using the selected app locale',()=>{
    const time=Date.UTC(2026,9,28,14,7)
    setLocale('en')
    expect(formatNumber(12345)).toBe('12,345')
    expect(formatNumber(1.5)).toBe('1.5')
    expect(formatBytes(1024*1024)).toBe('1 MB')
    const english=formatDate(time,{dateStyle:'long',timeZone:'UTC'})
    expect(english).toContain('October')
    const englishTime=formatDate(time,{hour:'2-digit',minute:'2-digit',timeZone:'UTC'})
    setLocale('ru')
    expect(formatNumber(12345)).toBe('12 345')
    expect(formatNumber(1.5)).toBe('1,5')
    expect(formatBytes(1024*1024)).toBe('1 МБ')
    const russian=formatDate(time,{dateStyle:'long',timeZone:'UTC'})
    expect(russian).not.toBe(english)
    expect(russian).toContain('октября')
    expect(formatDate(time,{hour:'2-digit',minute:'2-digit',timeZone:'UTC'})).not.toBe('')
    expect(englishTime).not.toBe('')
    expect(formatDate(Number.NaN)).toBe('—')
    expect(formatBytes(-10)).toBe('—')
  })
  it('inflects participant counts correctly in both languages',()=>{
    setLocale('ru')
    expect(membersCount(1)).toBe('1 участник')
    expect(membersCount(2)).toBe('2 участника')
    expect(membersCount(5)).toBe('5 участников')
    expect(membersCount(11)).toBe('11 участников')
    expect(membersCount(21)).toBe('21 участник')
    setLocale('en')
    expect(membersCount(1)).toBe('1 member')
    expect(membersCount(2)).toBe('2 members')
  })
  it('re-renders chat date/time in the language selected AFTER an earlier render',()=>{
    const now=new Date(2026,9,28,12,0).getTime()
    const past=new Date(2026,9,23,10,20).getTime()
    setLocale('en')
    const before=dayLabel(past,now)
    const timeBefore=chatTime(now,now)
    setLocale('ru')
    expect(dayLabel(past,now)).not.toBe(before)
    expect(chatTime(now,now)).toBeTruthy()
    expect(timeBefore).toBeTruthy()
  })
})
