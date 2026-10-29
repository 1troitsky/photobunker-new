// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import VoiceRecorder from '../src/components/VoiceRecorder.vue'
import { locale } from '../src/i18n'
vi.mock('../src/identity/store', async () => ({ account: (await import('vue')).ref({ id: 'qa' }) }))
const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
let capture: ReturnType<typeof vi.fn>, stop: ReturnType<typeof vi.fn>, time = 0
class Recorder {
  static isTypeSupported() { return true }
  state = 'inactive'; mimeType = 'audio/webm'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  start() { this.state = 'recording' }
  stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['synthetic audio'], { type: this.mimeType }) }); this.onstop?.() }) }
  pause() { this.state = 'paused' }
  resume() { this.state = 'recording' }
}
beforeEach(() => {
  locale.value = 'ru'; time = 100; stop = vi.fn()
  capture = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: capture } })
  vi.stubGlobal('MediaRecorder', Recorder)
  vi.stubGlobal('AudioContext', class { constructor() { throw new DOMException('QA analysis unavailable', 'NotAllowedError') } })
  vi.spyOn(performance, 'now').mockImplementation(() => time)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:qa')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); if (original) Object.defineProperty(navigator, 'mediaDevices', original); else Reflect.deleteProperty(navigator, 'mediaDevices') })
it('records when waveform analysis is denied, releases capture and keeps a failed draft for retry', async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  const view = mount(VoiceRecorder, { props: { active: true, disabled: false, send } })
  await view.get('[aria-label="Записать голосовое сообщение"]').trigger('click'); await flushPromises()
  expect(view.attributes('data-recording-state')).toBe('recording')
  time = 1300
  await view.get('[aria-label="Остановить запись"]').trigger('click'); await flushPromises()
  expect(stop).toHaveBeenCalledOnce(); expect(view.attributes('data-recording-state')).toBe('preview')
  await view.get('[aria-label="Отправить голосовое сообщение"]').trigger('click'); await flushPromises()
  expect(view.attributes('data-recording-state')).toBe('preview'); expect(view.get('[role="alert"]').text()).toContain('Не удалось отправить')
  await view.get('[aria-label="Отправить голосовое сообщение"]').trigger('click'); await flushPromises()
  expect(send).toHaveBeenCalledTimes(2); expect(view.attributes('data-recording-state')).toBe('idle')
  view.unmount()
})
it('explains microphone denial and stops late capture after app lock', async () => {
  capture.mockRejectedValueOnce(new DOMException('QA', 'NotAllowedError'))
  const view = mount(VoiceRecorder, { props: { active: true, disabled: false, send: vi.fn() } })
  await view.get('button').trigger('click'); await flushPromises()
  expect(view.get('[role="alert"]').text()).toContain('Разрешите доступ')
  let resolve!: (value: unknown) => void
  capture.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  await view.get('button').trigger('click'); await view.setProps({ active: false })
  resolve({ getTracks: () => [{ stop }] }); await flushPromises()
  expect(stop).toHaveBeenCalledOnce(); expect(view.attributes('data-recording-state')).toBe('idle')
  view.unmount()
})
