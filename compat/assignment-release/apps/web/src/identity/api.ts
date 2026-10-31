export class IdentityError extends Error {
  constructor(
    public status: number,
    public code?: string,
  ) {
    super('identity.request_failed')
  }
}
export class IdentityTimeoutError extends Error {
  constructor() { super('identity.timeout') }
}
export class IdentityNetworkError extends Error {
  constructor() { super('identity.network') }
}
let expectedAccount = ''
let photoReadToken = ''
let readGeneration = 0
export function bindPhotoReadToken(token: string) {
  photoReadToken = token
  if (!token) {
    readGeneration++
    for (const [controller, request] of requests)
      if (request.privateRead) controller.abort()
  }
}
const requests = new Map<
  AbortController,
  { owner: string; privateRead: boolean }
>()
let documentActive = true
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    documentActive = false
    for (const controller of requests.keys()) controller.abort()
  })
  window.addEventListener('pageshow', () => {
    documentActive = true
  })
}
export function bindIdentity(id: string) {
  if (expectedAccount !== id) bindPhotoReadToken('')
  expectedAccount = id
  for (const [controller, request] of requests)
    if (request.owner && request.owner !== id) controller.abort()
}
export async function identityRequest<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  accountBinding?: string,
  format: 'json' | 'blob' = 'json',
): Promise<T> {
  if (!documentActive) throw new DOMException('Document inactive', 'AbortError')
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, path === '/profile' ? 15000 : path === '/me' ? 12000 : 45000)
  const binding = accountBinding ?? expectedAccount
  const privateRead =
    (method === 'GET' &&
      /^\/(secure\/(photos|migration)|workspace\/photos)/.test(path)) ||
    path === '/secure/migration/content'
  const readVersion = readGeneration
  requests.set(controller, { owner: binding, privateRead })
  const cancel = () => controller.abort()
  if (typeof window !== 'undefined')
    window.addEventListener('pagehide', cancel, { once: true })
  try {
    const form = typeof FormData !== 'undefined' && body instanceof FormData
    const response = await fetch(`/api/v1/identity${path}`, {
      method,
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept:
          format === 'blob' ? 'application/octet-stream' : 'application/json',
        ...(photoReadToken && /^\/(secure|workspace\/photos)/.test(path)
          ? { 'X-PhotoBunker-Read': photoReadToken }
          : {}),
        'X-PhotoBunker': 'identity-v1',
        ...(binding && !['/challenges', '/sessions', '/me'].includes(path)
          ? { 'X-PhotoBunker-Account': binding }
          : {}),
        ...(body && !form ? { 'Content-Type': 'application/json' } : {}),
      },
      body: form ? body : body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) {
      if (
        response.status === 401 &&
        binding === expectedAccount &&
        expectedAccount &&
        !['/challenges', '/sessions', '/me'].includes(path)
      )
        window.dispatchEvent(new Event('photobunker-identity-expired'))
      const payload = await response.json().catch(() => ({}))
      if (response.status === 410 && payload.code === 'account_expired' && binding === expectedAccount)
        window.dispatchEvent(new Event('photobunker-identity-expired'))
      throw new IdentityError(
        response.status,
        payload.code === 'username_taken' ? 'username_taken' : undefined,
      )
    }
    const result = (
      format === 'blob' ? await response.blob() : await response.json()
    ) as T
    if (binding && binding !== expectedAccount && !['/me', '/challenges', '/sessions', '/session'].includes(path))
      throw new DOMException('Account changed', 'AbortError')
    if (privateRead && readVersion !== readGeneration)
      throw new DOMException('Photo read cancelled', 'AbortError')
    return result
  } catch (error) {
    if (timedOut) throw new IdentityTimeoutError()
    if (error instanceof TypeError) throw new IdentityNetworkError()
    throw error
  } finally {
    clearTimeout(timer)
    requests.delete(controller)
    if (typeof window !== 'undefined')
      window.removeEventListener('pagehide', cancel)
  }
}
