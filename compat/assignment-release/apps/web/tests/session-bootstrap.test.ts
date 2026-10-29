// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '../src/router'
import { profileReturnTo } from '../src/identity/person'
import { sessionState } from '../src/identity/store'

afterEach(() => { sessionState.value = 'initial' })

it('never waits for an Identity HTTP request to resolve a protected route', async () => {
  sessionState.value = 'checking'
  const router = createAppRouter(createMemoryHistory())
  await router.push('/gallery/private')
  await router.isReady()
  expect(router.currentRoute.value.path).toBe('/gallery/private')
  // App.vue keeps the private component unmounted while Identity is pending.
})

it('preserves a safe direct link after confirmed sign-out', async () => {
  sessionState.value = 'signed-out'
  const router = createAppRouter(createMemoryHistory())
  await router.push('/assignments/valid-id')
  await router.isReady()
  expect(router.currentRoute.value.path).toBe('/profile')
  expect(router.currentRoute.value.query.returnTo).toBe('/assignments/valid-id')
})

it('lets public shared-photo links open without Identity', async () => {
  sessionState.value = 'revoked'
  const router = createAppRouter(createMemoryHistory())
  await router.push('/s/public-link')
  expect(router.currentRoute.value.path).toBe('/s/public-link')
})

it('drops external, query-bearing, and account-key-bearing return paths', () => {
  expect(profileReturnTo('//evil.example')).toBe('/profile')
  expect(profileReturnTo('/gallery/photo-1?token=private')).toBe('/profile')
  expect(profileReturnTo('/gallery/photo-1')).toBe('/gallery/photo-1')
  expect(profileReturnTo('/profile/account')).toBe('/profile')
})
