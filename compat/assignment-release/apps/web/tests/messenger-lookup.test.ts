import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, ref, type EffectScope } from 'vue'
const request = vi.hoisted(() => vi.fn())
vi.mock('../src/identity/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/identity/api')>(), identityRequest: request,
}))
import { IdentityError } from '../src/identity/api'
import { personHandle, usePersonLookup } from '../src/messages/lookup'
let scope: EffectScope
beforeEach(() => { vi.useFakeTimers(); request.mockReset(); scope = effectScope() })
afterEach(() => { scope.stop(); vi.useRealTimers() })
function fixture() {
  const query = ref(''), enabled = ref(true), owner = ref('account:device')
  const lookup = scope.run(() => usePersonLookup(query, enabled, owner))!
  return { query, enabled, owner, ...lookup }
}
const person = (id: string) => ({ publicId: id, fields: {}, ready: true })
it('accepts public IDs, usernames and full local Matrix IDs without treating names as identifiers', () => {
  expect(personHandle(' pb_123abc ')).toBe('pb_123abc')
  expect(personHandle('@alex')).toBe('@alex')
  expect(personHandle('alex')).toBe('@alex')
  expect(personHandle('@pb_0123456789abcdef:photos.local')).toBe('@pb_0123456789abcdef:photos.local')
  expect(personHandle('Мария Воронова')).toBe('')
})
it('debounces typing and resolves the final identifier before offering a person', async () => {
  const f = fixture(); request.mockResolvedValue(person('pb_target'))
  f.query.value = '@al'; await vi.advanceTimersByTimeAsync(150)
  f.query.value = '@alex'; expect(f.person.value).toBeUndefined()
  await vi.advanceTimersByTimeAsync(300)
  expect(request).toHaveBeenCalledExactlyOnceWith('/matrix/resolve/%40alex')
  expect(f.person.value?.publicId).toBe('pb_target'); expect(f.busy.value).toBe(false)
})
it('immediately removes a previous result and ignores a late response for the previous query', async () => {
  const f = fixture(); let resolve!: (value: unknown) => void
  request.mockImplementationOnce(() => new Promise(r => { resolve = r }))
  f.query.value = '@old'; await vi.advanceTimersByTimeAsync(300)
  request.mockResolvedValue(person('pb_new')); f.query.value = '@new'
  resolve(person('pb_old')); await vi.advanceTimersByTimeAsync(300)
  expect(f.person.value?.publicId).toBe('pb_new')
  f.query.value = ''; expect(f.person.value).toBeUndefined(); expect(f.busy.value).toBe(false)
})
it.each(['close', 'account', 'unmount'])('does not publish a pending profile after %s', async change => {
  const f = fixture(); let resolve!: (value: unknown) => void
  request.mockImplementation(() => new Promise(r => { resolve = r }))
  f.query.value = '@alex'; await vi.advanceTimersByTimeAsync(300)
  if (change === 'close') f.enabled.value = false
  if (change === 'account') f.owner.value = 'another:device'
  if (change === 'unmount') scope.stop()
  resolve(person('pb_old')); await Promise.resolve(); await Promise.resolve()
  expect(f.person.value).toBeUndefined()
})
it('distinguishes missing or blocked people from a connection failure and supports retry', async () => {
  const f = fixture(); request.mockRejectedValueOnce(new IdentityError(404)).mockRejectedValueOnce(new Error('network')).mockResolvedValue(person('pb_retry'))
  f.query.value = '@alex'; await vi.advanceTimersByTimeAsync(300)
  expect(f.error.value).toBe('missing'); expect(f.person.value).toBeUndefined()
  await f.find(); expect(f.error.value).toBe('failed')
  await f.find(); expect(f.error.value).toBe(''); expect(f.person.value?.publicId).toBe('pb_retry')
})
