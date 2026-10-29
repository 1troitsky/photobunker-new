import { identityRequest, bindPhotoReadToken } from '../identity/api'
import { account } from '../identity/store'
export let readExpiresAt = 0
export function setReadToken(token: string, expiresAt = 0) {
  bindPhotoReadToken(token)
  readExpiresAt = expiresAt
}
export function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  format: 'json' | 'blob' = 'json',
  owner = account.value?.id,
) {
  if (!owner) return Promise.reject(new Error('crypto.no_account'))
  return identityRequest<T>(`/secure${path}`, method, body, owner, format)
}
