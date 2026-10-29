// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import Edit from '../src/views/AccountEditView.vue'
import { account, saveProfile, profileSaved } from '../src/identity/store'
import { IdentityError } from '../src/identity/api'
import { locale } from '../src/i18n'
vi.mock('../src/identity/store', async () => {
  const { ref } = await import('vue')
  return {
    account: ref(),
    profileSaved: ref(false),
    loadIdentity: vi.fn(async () => {}),
    saveProfile: vi.fn(async () => {}),
  }
})
let wrapper: ReturnType<typeof mount>
beforeEach(() => {
  locale.value = 'ru'
  account.value = {
    id: '86a2cfab-78a7-4a99-9936-7c5fa042a598',
    publicId: 'pb_qa',
    revision: 1,
    fields: {
      name: '',
      username: '',
      email: '',
      phone: '',
      links: '',
      about: '',
    },
    visibility: {
      name: 'private',
      username: 'private',
      email: 'private',
      phone: 'private',
      links: 'private',
      about: 'private',
    },
    matrix: { state: 'ready', userId: null },
  }
  profileSaved.value = false
  vi.mocked(saveProfile).mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function open() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/profile/edit', component: Edit },
      { path: '/profile', component: { template: '<p>Profile</p>' } },
    ],
  })
  await router.push('/profile/edit')
  wrapper = mount(
    { template: '<router-view />' },
    { global: { plugins: [router] }, attachTo: document.body },
  )
  await flushPromises()
  return router
}
describe('account edit feedback', () => {
  it('returns to profile if the editor remounts after session expiry', async () => {
    account.value = undefined
    const router = await open()
    expect(router.currentRoute.value.path).toBe('/profile')
    expect(wrapper.find('form').exists()).toBe(false)
  })
  it('explains invalid email instead of silently blocking submit', async () => {
    await open()
    await wrapper.find('input[type=email]').setValue('not-an-email')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(saveProfile).not.toHaveBeenCalled()
    expect(wrapper.get('[role=alert]').text()).toContain('Проверьте Email')
    expect(document.activeElement).toBe(wrapper.get('[role=alert]').element)
  })
  it('keeps draft and exposes retry after a failed save', async () => {
    await open()
    await wrapper.find('input').setValue('QA saved name')
    vi.mocked(saveProfile).mockRejectedValueOnce(new IdentityError(503))
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain(
      'Изменения остались в форме',
    )
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe(
      'QA saved name',
    )
    expect(
      wrapper.find('button.primary-button').attributes('disabled'),
    ).toBeUndefined()
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(saveProfile).toHaveBeenCalledTimes(2)
  })
  it('saves a profile with optional email empty and confirms navigation', async () => {
    const router = await open()
    await wrapper.find('input').setValue('QA name only')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.objectContaining({ name: 'QA name only', email: '' }),
      }),
    )
    expect(router.currentRoute.value.path).toBe('/profile')
  })
  it('explains a revision conflict without discarding the edits', async () => {
    await open()
    await wrapper.find('input').setValue('QA conflict')
    vi.mocked(saveProfile).mockRejectedValueOnce(new IdentityError(409))
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('другом окне')
    expect(wrapper.text()).toContain('Обновить анкету')
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe(
      'QA conflict',
    )
  })
})
