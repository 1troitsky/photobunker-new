import { beforeEach, expect, it, vi } from 'vitest'
const sdk = vi.hoisted(() => ({ start: vi.fn(), preserve: vi.fn(), stop: vi.fn() }))
vi.mock('../src/identity/store', async () => { const { ref } = await import('vue'); return { account: ref({ id: 'first' }), deviceId: ref('device-first') } })
vi.mock('../src/messages/store', async () => {
  const { ref } = await import('vue')
  return { connection: ref('ready'), security: ref({ verified: true }), startMessaging: sdk.start, preserveMessageKeys: sdk.preserve, stopMessaging: sdk.stop }
})
import { account, deviceId } from '../src/identity/store'
import { connection, security } from '../src/messages/store'
import { ensureNewAccountMessaging } from '../src/identity/messaging-setup'
beforeEach(() => { vi.clearAllMocks(); account.value = { id: 'first' } as never; deviceId.value = 'device-first'; connection.value = 'ready'; security.value.verified = true; sdk.start.mockResolvedValue(undefined); sdk.preserve.mockResolvedValue(undefined) })
it('finishes saving the existing account recovery package before releasing the onboarding client', async () => {
  await ensureNewAccountMessaging()
  expect(sdk.preserve).toHaveBeenCalledOnce(); expect(sdk.stop).toHaveBeenCalledOnce()
  expect(sdk.preserve.mock.invocationCallOrder[0]).toBeLessThan(sdk.stop.mock.invocationCallOrder[0]!)
})
it('does not finish registration with an unprepared messaging identity', async () => {
  security.value.verified = false
  await expect(ensureNewAccountMessaging()).rejects.toThrow('onboarding.messaging_unavailable')
  expect(sdk.preserve).not.toHaveBeenCalled(); expect(sdk.stop).toHaveBeenCalledOnce()
})
it('does not save or stop another account when it changes during initial preparation', async () => {
  let finish!: () => void
  sdk.start.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const preparing = ensureNewAccountMessaging()
  await vi.waitFor(() => expect(sdk.start).toHaveBeenCalledOnce())
  account.value = { id: 'second' } as never; deviceId.value = 'device-second'; finish()
  await expect(preparing).rejects.toMatchObject({ name: 'AbortError' })
  expect(sdk.preserve).not.toHaveBeenCalled(); expect(sdk.stop).not.toHaveBeenCalled()
})
