// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import {
  bindIdentity,
  bindPhotoReadToken,
  identityRequest,
} from '../src/identity/api'
afterEach(() => {
  bindIdentity('')
  window.dispatchEvent(new Event('pageshow'))
  vi.unstubAllGlobals()
})
function pending() {
  let signal: AbortSignal
  vi.stubGlobal(
    'fetch',
    vi.fn((_url, options) => {
      signal = options.signal
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        ),
      )
    }),
  )
  return () => signal
}
it('cancels requests bound to the previous account', async () => {
  const signal = pending()
  bindIdentity('old-account')
  const request = identityRequest('/workspace/photos')
  const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' })
  bindIdentity('next-account')
  expect(signal().aborted).toBe(true)
  await rejected
})
it('cancels pending requests before page teardown', async () => {
  const signal = pending()
  const request = identityRequest('/workspace/photos')
  const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' })
  window.dispatchEvent(new Event('pagehide'))
  expect(signal().aborted).toBe(true)
  await rejected
})
it('keeps current-account requests alive and removes completed listeners', async () => {
  bindIdentity('same-account')
  let signal: AbortSignal
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, options) => {
      signal = options.signal
      return new Response('{}')
    }),
  )
  await identityRequest('/workspace/photos')
  expect(fetch).toHaveBeenCalledWith(
    '/api/v1/identity/workspace/photos',
    expect.objectContaining({ redirect: 'error', credentials: 'same-origin' }),
  )
  bindIdentity('same-account')
  window.dispatchEvent(new Event('pagehide'))
  expect(signal!.aborted).toBe(false)
})

it('rejects an old account JSON response if its body completes after switching accounts', async () => {
  let complete!: (value: unknown) => void
  bindIdentity('old-account')
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: () => new Promise(resolve => { complete = resolve }) })))
  const request = identityRequest('/workspace')
  const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' })
  await Promise.resolve()
  bindIdentity('new-account')
  complete({ private: 'synthetic-old-state' })
  await rejected
})

it('prevents an old async continuation from starting a request after pagehide', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}')),
  )
  window.dispatchEvent(new Event('pagehide'))
  await expect(identityRequest('/workspace/photos')).rejects.toMatchObject({
    name: 'AbortError',
  })
  expect(fetch).not.toHaveBeenCalled()
  window.dispatchEvent(new Event('pageshow'))
  await identityRequest('/workspace/photos')
  expect(fetch).toHaveBeenCalledOnce()
})

it('clears the strong capability and aborts private reads while preserving capture uploads', async () => {
  const signal = pending()
  bindIdentity('same-account')
  bindPhotoReadToken('synthetic-test-capability')
  const read = identityRequest('/secure/photos')
  const rejected = expect(read).rejects.toMatchObject({ name: 'AbortError' })
  bindPhotoReadToken('')
  expect(signal().aborted).toBe(true)
  await rejected
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}')),
  )
  await identityRequest('/secure/photos', 'POST', {})
  expect(fetch).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      headers: expect.not.objectContaining({
        'X-PhotoBunker-Read': expect.any(String),
      }),
    }),
  )
})
it('rejects a completed binary read when lock occurs during body consumption', async () => {
  let complete!: (blob: Blob) => void
  bindPhotoReadToken('synthetic-test-capability')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      blob: () =>
        new Promise<Blob>((resolve) => {
          complete = resolve
        }),
    })),
  )
  const read = identityRequest(
    '/secure/photos/synthetic/objects/synthetic',
    'GET',
    undefined,
    undefined,
    'blob',
  )
  const rejected = expect(read).rejects.toMatchObject({ name: 'AbortError' })
  await Promise.resolve()
  bindPhotoReadToken('')
  complete(new Blob(['synthetic']))
  await rejected
})
