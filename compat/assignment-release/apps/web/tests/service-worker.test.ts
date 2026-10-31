import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { renderServiceWorker } from '../scripts/service-worker'

type FetchEvent = { request: { url: string; method: string; mode: string }; respondWith: ReturnType<typeof vi.fn> }
type WorkerEvent = { waitUntil: ReturnType<typeof vi.fn> }

function worker() {
  const listeners: Record<string, (event: FetchEvent & WorkerEvent) => void> = {}
  const shell = new Response('<html>offline shell</html>')
  const cache = { addAll: vi.fn().mockResolvedValue(undefined), match: vi.fn().mockResolvedValue(shell) }
  const caches = {
    open: vi.fn().mockResolvedValue(cache),
    keys: vi.fn().mockResolvedValue(['photobunker-shell-old', 'photobunker-shell-test', 'other-application']),
    delete: vi.fn().mockResolvedValue(true),
  }
  const fetch = vi.fn().mockRejectedValue(new TypeError('Offline'))
  const self = {
    location: { origin: 'https://photobunker.orb.local' },
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
    addEventListener: (name: string, listener: typeof listeners[string]) => { listeners[name] = listener },
  }
  runInNewContext(renderServiceWorker(['/', '/assets/app-abc.js', '/icons/icon.svg'], 'test'), { self, caches, fetch, URL, Response })
  function request(path: string, mode = 'cors', method = 'GET') {
    const event = { request: { url: new URL(path, self.location.origin).href, mode, method }, respondWith: vi.fn(), waitUntil: vi.fn() }
    listeners.fetch!(event)
    return event.respondWith
  }
  return { listeners, request, cache, caches, fetch, self, shell }
}

describe('public app shell cache boundary', () => {
  it('never intercepts API, user content, signed URLs, mutations or third-party requests', () => {
    const { request, caches } = worker()
    for (const path of ['/api/v1/health', '/api/v1/assets/private', '/api/v1/assets/private?token=secret', '/media/photo.jpg', '/assets/user-photo.jpg', '/assets/app-abc.js?signature=secret', 'https://storage.example/assets/app-abc.js']) {
      expect(request(path)).not.toHaveBeenCalled()
    }
    expect(request('/api/v1/assets/private', 'navigate')).not.toHaveBeenCalled()
    expect(request('/gallery/private.jpg', 'navigate')).not.toHaveBeenCalled()
    expect(request('/gallery/81fc0686-b3b5-4d98-b59e-09ab1920398b?token=secret', 'navigate')).not.toHaveBeenCalled()
    expect(request('/assets/app-abc.js', 'cors', 'POST')).not.toHaveBeenCalled()
    expect(caches.open).not.toHaveBeenCalled()
  })

  it('serves a known app route from the public shell only when the network is unavailable', async () => {
    const { request, fetch, cache, shell } = worker()
    const respondWith = request('/gallery', 'navigate')
    const response = await respondWith.mock.calls[0]![0] as Response
    expect(response).toBe(shell)
    expect(fetch).toHaveBeenCalledOnce()
    expect(cache.match).toHaveBeenCalledWith('/')
  })

  it('installs the exact public asset set and only deletes previous PhotoBunker shell caches', async () => {
    const { listeners, cache, caches, self } = worker()
    const event = { waitUntil: vi.fn(), request: { url: '', method: '', mode: '' }, respondWith: vi.fn() }
    listeners.install!(event)
    await event.waitUntil.mock.calls[0]![0]
    expect(cache.addAll).toHaveBeenCalledWith(['/', '/assets/app-abc.js', '/icons/icon.svg'])

    event.waitUntil.mockClear()
    listeners.activate!(event)
    await event.waitUntil.mock.calls[0]![0]
    expect(caches.delete).toHaveBeenCalledExactlyOnceWith('photobunker-shell-old')
    expect(self.clients.claim).toHaveBeenCalledOnce()
  })

  it('opens a local photo route offline using only the public HTML shell', async () => {
    const { request, cache, shell } = worker()
    const response = await request('/gallery/81fc0686-b3b5-4d98-b59e-09ab1920398b', 'navigate').mock.calls[0]![0]
    expect(response).toBe(shell)
    expect(cache.match).toHaveBeenCalledExactlyOnceWith('/')
  })

  it('opens profile pages offline without caching account or profile data', async () => {
    const { request, shell } = worker()
    for (const path of ['/profiles', '/profiles/new', '/profiles/81fc0686-b3b5-4d98-b59e-09ab1920398b', '/camera/presets', '/camera/presets/new', '/camera/presets/81fc0686-b3b5-4d98-b59e-09ab1920398b', '/profile', '/profile/account', '/profile/edit', '/profile/contacts', '/profile/security', '/messages', '/assignments', '/assignments/new', '/assignments/81fc0686-b3b5-4d98-b59e-09ab1920398b/edit', '/gallery/81fc0686-b3b5-4d98-b59e-09ab1920398b/edit', '/profile/teams', '/join']) {
      expect(await request(path, 'navigate').mock.calls[0]![0]).toBe(shell)
    }
  })
})
