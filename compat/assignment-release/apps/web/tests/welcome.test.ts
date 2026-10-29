// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { nextTick } from 'vue'
import WelcomeView from '../src/views/WelcomeView.vue'
import { createAppRouter } from '../src/router'
import { account, offlineCaptureIdentity, sessionState } from '../src/identity/store'
import { locale, setLocale } from '../src/i18n'
import { welcomeText } from '../src/welcome/text'

const identity = {
  id: '11111111-2222-4333-8444-555555555555',
  publicId: 'pb_owner', fields: {
    name: '', username: '', email: '', phone: '', links: '', about: '',
  },
  visibility: {
    name: 'private', username: 'private', email: 'private',
    phone: 'private', links: 'private', about: 'private',
  },
  revision: 0,
  matrix: { state: 'ready', userId: '@owner:local' },
} as const

beforeEach(() => {
  sessionState.value = 'signed-out'
  account.value = undefined
  offlineCaptureIdentity.value = false
  localStorage.removeItem('pb-active-device')
  localStorage.removeItem('pb-signed-out')
  setLocale('en')
})
afterEach(() => {
  sessionState.value = 'initial'
  account.value = undefined
  offlineCaptureIdentity.value = false
  setLocale('en')
})

describe('R1-10 / guest Welcome', () => {
  it('opens owner-approved Create and Recover workflows, not an alternative auth backend', async () => {
    const router = createAppRouter(createMemoryHistory())
    await router.push('/')
    await router.isReady()
    expect(router.currentRoute.value.path).toBe('/welcome')
    const view = mount(WelcomeView, { global: { plugins: [router] } })
    expect(view.get('.welcome-create').attributes('href')).toContain('/profile/account?')
    expect(view.get('.welcome-create').attributes('href')).toContain('mode=create')
    expect(view.get('.welcome-recover').attributes('href')).toContain('mode=recover')
    await view.get('.welcome-create').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/profile/account')
    expect(router.currentRoute.value.query.mode).toBe('create')
    await router.push('/welcome')
    await view.get('.welcome-recover').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/profile/account')
    expect(router.currentRoute.value.query.mode).toBe('recover')
    view.unmount()
  })

  it('offers six localized truthful features and accessible buttons, touch and keyboard', async () => {
    const router = createAppRouter(createMemoryHistory())
    const view = mount(WelcomeView, { global: { plugins: [router] } })
    expect(welcomeText().features).toHaveLength(6)
    expect(view.findAll('.welcome-dot')).toHaveLength(6)
    expect(view.text()).toContain('Shoot privately.')
    await view.get('.welcome-carousel').trigger('keydown', { key: 'ArrowRight' })
    expect(view.text()).toContain('Share on your terms.')
    await view.get('.welcome-arrow').trigger('click')
    expect(view.text()).toContain('Shoot privately.')
    await view.findAll('.welcome-dot')[4]!.trigger('click')
    expect(view.text()).toContain('Private conversations.')
    await view.get('.welcome-language').trigger('click')
    await nextTick()
    expect(locale.value).toBe('ru')
    expect(view.text()).toContain('Приватная переписка.')
    expect(view.get('.welcome-carousel').attributes('role')).toBe('region')
    expect(view.get('.welcome-carousel').attributes('tabindex')).toBe('0')
    view.unmount()
  })

  it('skips Welcome for a confirmed existing session', async () => {
    sessionState.value = 'authenticated'
    account.value = { ...identity, fields: { ...identity.fields }, visibility: { ...identity.visibility },
      matrix: { ...identity.matrix } }
    const router = createAppRouter(createMemoryHistory())
    await router.push('/')
    await router.isReady()
    expect(router.currentRoute.value.path).toBe('/camera')
    // Other imported startup services can perform a real /me check in jsdom.
    // Restore this synthetic confirmed session before the explicit guard case.
    sessionState.value = 'authenticated'
    await router.push('/welcome')
    expect(router.currentRoute.value.path).toBe('/camera')
  })

  it('does not show guest Welcome to a trusted offline R0-02 account', async () => {
    sessionState.value = 'offline'
    offlineCaptureIdentity.value = true
    account.value = { ...identity, fields: { ...identity.fields },
      visibility: { ...identity.visibility }, matrix: { ...identity.matrix } }
    const router = createAppRouter(createMemoryHistory())
    await router.push('/')
    await router.isReady()
    expect(router.currentRoute.value.path).toBe('/camera')
    await router.push('/welcome')
    expect(router.currentRoute.value.path).toBe('/camera')
  })

  it('preserves protected deep links rather than redirecting them to guest Welcome', async () => {
    const router = createAppRouter(createMemoryHistory())
    await router.push('/gallery/private-photo')
    await router.isReady()
    expect(router.currentRoute.value.path).toBe('/profile')
    expect(router.currentRoute.value.query.returnTo).toBe('/gallery/private-photo')
    await router.push('/s/public-share')
    expect(router.currentRoute.value.path).toBe('/s/public-share')
  })
})
