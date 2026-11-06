// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import PasscodeInput from '../src/components/PasscodeInput.vue'
import { createBackgroundLock } from '../src/app/background-lock'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

it('shows the fourth dot and accepts the next complete segment without waiting for verification', async () => {
  const value = ref(''), parts: string[] = []
  const wrapper = mount(defineComponent({ setup: () => () => h(PasscodeInput, {
    modelValue: value.value, length: 4, label: 'Synthetic PIN', autoClear: true,
    'onUpdate:modelValue': (v: string) => { value.value = v },
    onComplete: (v: string) => { parts.push(v) },
  }) }))
  const input = wrapper.find('input')
  for (const digits of ['1', '12', '123', '1234']) {
    await input.setValue(digits)
    expect(wrapper.findAll('.filled')).toHaveLength(digits.length)
  }
  expect(input.element.value).toBe('')
  expect(parts).toEqual(['1234'])
  // Two input events before Vue paints: the next segment is not overwritten.
  input.element.value = '5'; input.element.dispatchEvent(new Event('input', { bubbles: true }))
  input.element.value = '5678'; input.element.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  expect(parts).toEqual(['1234', '5678'])
  expect(wrapper.findAll('.filled')).toHaveLength(4)
  wrapper.unmount()
})

it('updates ordinary setup dots when the parent clears an input', async () => {
  const wrapper = mount(PasscodeInput, { props: { modelValue: '1234', label: 'Synthetic PIN', length: 4 } })
  expect(wrapper.findAll('.filled')).toHaveLength(4)
  await wrapper.setProps({ modelValue: '' })
  expect(wrapper.findAll('.filled')).toHaveLength(0)
  wrapper.unmount()
})

function deadline(delay = 300000) {
  const lock = vi.fn()
  const policy = createBackgroundLock({ enabled: () => true, delay: () => delay, lock })
  return { ...policy, lock }
}

it('does not lock before five minutes, and duplicate pagehide does not extend the deadline', () => {
  vi.useFakeTimers()
  const policy = deadline()
  policy.hide(); vi.advanceTimersByTime(240000); policy.hide()
  expect(policy.lock).not.toHaveBeenCalled()
  vi.advanceTimersByTime(59999)
  expect(policy.lock).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(policy.lock).toHaveBeenCalledTimes(1)
  policy.clear()
})

it('cancels the background deadline on a quick foreground return', () => {
  vi.useFakeTimers()
  const policy = deadline()
  policy.hide(); vi.advanceTimersByTime(10000); policy.show()
  vi.advanceTimersByTime(300000)
  expect(policy.lock).not.toHaveBeenCalled()
  policy.hide(); vi.advanceTimersByTime(300000)
  expect(policy.lock).toHaveBeenCalledTimes(1)
})

it('enforces a deadline on resume even when the OS suspended timers', () => {
  vi.useFakeTimers()
  const policy = deadline()
  policy.hide()
  vi.setSystemTime(Date.now() + 300001)
  policy.show()
  expect(policy.lock).toHaveBeenCalledTimes(1)
})

it('locks immediately for zero delay and fails closed on wall-clock rollback', () => {
  vi.useFakeTimers()
  const immediate = deadline(0)
  immediate.hide()
  expect(immediate.lock).toHaveBeenCalledTimes(1)
  const policy = deadline()
  policy.hide(); vi.setSystemTime(Date.now() - 6000); policy.show()
  expect(policy.lock).toHaveBeenCalledTimes(1)
})
