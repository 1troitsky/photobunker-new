// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import App from '../src/App.vue'
import { createAppRouter } from '../src/router'
import {
  account,
  identityReady,
  identityUnavailable,
  sessionState,
} from '../src/identity/store'
let wrapper: ReturnType<typeof mount> | undefined
beforeEach(() => {
  localStorage.clear()
  account.value = undefined
  identityReady.value = false
  identityUnavailable.value = false
  sessionState.value = 'initial'
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 401 })),
  )
})
afterEach(() => {
  wrapper?.unmount()
  vi.unstubAllGlobals()
})
async function open(path: string) {
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  wrapper = mount(App, { global: { plugins: [router] } })
  await flushPromises()
  return router
}
it('renders a locked private gate while identity checks run in the background', async () => {
  const router = await open('/camera')
  expect(router.currentRoute.value.path).toBe('/camera')
  expect(wrapper!.find('nav.navigation').exists()).toBe(false)
  expect(wrapper!.find('video').exists()).toBe(false)
  expect(wrapper!.find('.main-content').text()).not.toContain('Задания ·')
})
it('does not mount private messages or photos before confirmed Identity', async () => {
  const router = await open('/messages')
  expect(wrapper!.find('.message-composer').exists()).toBe(false)
  await router.push('/gallery/private')
  expect(wrapper!.find('.photo-editor').exists()).toBe(false)
})
it('shows a sign-in gate for a shared profile without revealing profile information', async () => {
  const router = await open('/people/pb_sample')
  expect(router.currentRoute.value.name).toBe('person-profile')
  expect(wrapper!.text()).toContain('Войдите, чтобы открыть профиль')
  expect(wrapper!.find('.person-information').exists()).toBe(false)
  expect(wrapper!.find('nav.navigation').exists()).toBe(false)
})
it('allows explicit account recovery before authentication', async () => {
  const router = await open('/profile/account?mode=recover')
  expect(router.currentRoute.value.name).toBe('account-auth')
  expect(wrapper!.find('textarea').exists()).toBe(true)
  expect(wrapper!.find('nav.navigation').exists()).toBe(false)
})
it('keeps a direct recovery navigation when identity loads after the app mounts', async () => {
  const router = createAppRouter(createMemoryHistory())
  wrapper = mount(App, { global: { plugins: [router] } })
  await router.push('/profile/account?mode=recover')
  await router.isReady()
  await flushPromises()
  expect(router.currentRoute.value.name).toBe('account-auth')
  expect(wrapper.find('textarea').exists()).toBe(true)
})

it('does not expose stored photo counts or saved-account shortcuts on the signed-out profile', async () => {
  const { photos } = await import('../src/local/library')
  photos.value = [{id: 'private-local-1'}, {id: 'private-local-2'}, {id: 'private-local-3'}] as never
  const { localDevices } = await import('../src/identity/store')
  localDevices.value = [{id: 'old-1', publicId: 'pb_fixture_one'}, {id: 'old-2', publicId: 'pb_fixture_two'}, {id: 'old-3', publicId: 'pb_fixture_three'}] as never
  await open('/profile')
  expect(wrapper!.find('.account-stats').exists()).toBe(false)
  expect(wrapper!.text()).not.toContain('pb_fixture_')
  expect(wrapper!.text()).toContain('Войти с ключом аккаунта')
})
