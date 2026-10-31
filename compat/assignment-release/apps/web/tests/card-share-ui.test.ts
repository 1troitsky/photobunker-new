// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/identity/store', () => ({
  account: ref({ id: 'account-1' }),
  deviceId: ref('device-1'),
  sessionState: ref('confirmed'),
  hasConfirmedIdentity: () => true,
}))
vi.mock('../src/app/lock', () => ({ appLocked: ref(false) }))
vi.mock('../src/crypto/store', () => ({
  photoReadAllowed: () => true,
  strongUnlocked: ref(true),
  warmLocked: ref(false),
}))
vi.mock('../src/crypto/card-share-outbox', () => {
  const row = {
    id: 'f211bd3e-4a28-4480-aea1-f46f714e7f00',
    photoId: '85acf08b-c2a7-4304-a670-299bc7e53dd8',
    manifest: { expiresAt: Date.now() + 60_000 },
    url: 'https://example.test/c/f211bd3e-4a28-4480-aea1-f46f714e7f00#secret',
    state: 'queued',
    expiresAt: Date.now() + 60_000,
  }
  return {
    listCardShareIntents: vi.fn(async () => []),
    commitCardShare: vi.fn(async () => {
      // The durable commit emits this event before its promise resolves. The
      // UI must not invalidate its own mutation token and remain permanently busy.
      window.dispatchEvent(new Event('photobunker-card-shares'))
      return row
    }),
    revokeCardShare: vi.fn(async () => undefined),
    flushCardShares: vi.fn(async () => undefined),
  }
})

import PhotoCardLinks from '../src/components/PhotoCardLinks.vue'

describe('R1-03B / Photo Card link UI', () => {
  it('finishes an optimistic create when the durable outbox event reloads rows', async () => {
    const wrapper = mount(PhotoCardLinks, {
      props: {
        shareAllowed: true,
        card: {
          id: '85acf08b-c2a7-4304-a670-299bc7e53dd8',
          title: 'QA card',
          namePending: false,
          expiresAt: Date.now() + 3600_000,
        },
      },
      global: { stubs: { AppIcon: true } },
    })
    await flushPromises()
    const create = wrapper.findAll('button').find(button => button.text().includes('Создать ссылку'))!
    await create.trigger('click')
    await flushPromises()
    expect(create.attributes('disabled')).toBeUndefined()
    expect(wrapper.get('textarea').element.value).toContain('/c/')
    wrapper.unmount()
  })
})
