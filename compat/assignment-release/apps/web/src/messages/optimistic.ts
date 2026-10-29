/**
 * Optimistic display reconciliation with an optional encrypted durable outbox.
 * Matrix SDK local echoes are authoritative. Never guess identity by body:
 * equal messages are distinct messages unless transaction/server IDs match.
 */
export type PendingText = {
  id: string
  txnId: string
  roomId: string
  body: string
  reply?: string
  photoId?: string
  time: number
  status: 'queued' | 'sending' | 'notSent' | 'sent'
  serverEventId?: string
  inFlight: boolean
}

export type MatrixEventIdentity = { id: string; txnId?: string }
export function visiblePendingText(
  pending: readonly PendingText[],
  identities: readonly MatrixEventIdentity[],
  roomId: string,
): PendingText[] {
  const eventIds = new Set(identities.map(event => event.id))
  const transactions = new Set(identities.flatMap(event => event.txnId ? [event.txnId] : []))
  return pending.filter(message =>
    message.roomId === roomId &&
    !transactions.has(message.txnId) &&
    !eventIds.has(message.id) &&
    !(message.serverEventId && eventIds.has(message.serverEventId)),
  )
}

/** Only real server timeline echoes may mark a pending entry reconciled. */
export function acknowledgedPendingText(
  pending: readonly PendingText[],
  identities: readonly MatrixEventIdentity[],
): PendingText[] {
  const ids = new Set(identities.map(event => event.id))
  return pending.filter(item => !item.serverEventId || !ids.has(item.serverEventId))
}
