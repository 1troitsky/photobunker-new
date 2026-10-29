/** Bounded retries only for transient transport failures.
 * Authorization, trust, room membership and corrupted ciphertext errors are
 * NEVER retried automatically; they need an explicit user/security decision.
 */
export function isTransientMessageError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { httpStatus?: unknown; status?: unknown; name?: unknown; errcode?: unknown; message?: unknown }
  const status = typeof value.httpStatus === 'number' ? value.httpStatus :
    typeof value.status === 'number' ? value.status : undefined
  if (status !== undefined) return status === 429 || (status >= 500 && status < 600)
  if (typeof value.errcode === 'string') return value.errcode === 'M_LIMIT_EXCEEDED'
  if (typeof value.message === 'string' && [
    'messages.cancelled', 'unsafe_room', 'not_ready', 'workspace.pending', 'room_not_ready',
  ].includes(value.message)) return false
  return value.name === 'TypeError' || value.name === 'NetworkError'
}
export function retryDelayMs(attempt: number): number {
  const bounded = Math.max(0, Math.min(7, Number.isFinite(attempt) ? Math.trunc(attempt) : 0))
  return Math.min(60000, 1000 * (2 ** bounded))
}
