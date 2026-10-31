/**
 * Chat entry is a user intent, not an incidental combination of reactive flags.
 * Do not create Matrix rooms until crypto bootstrap has finished. Device
 * verification protects access to old history, but Matrix can still create
 * and encrypt fresh conversations from an otherwise ready device.
 */
export type ChatEntryDecision =
  | { kind: 'ready' }
  | { kind: 'recover' }
  | { kind: 'waiting' }
  | { kind: 'unavailable'; reason: 'offline' | 'otherTab' | 'unsupported' | 'error' }

export function decideChatEntry(connection: string, diagnostic: string, _verified: boolean): ChatEntryDecision {
  if (connection === 'ready') {
    if (diagnostic !== 'ready') return { kind: 'waiting' }
    return { kind: 'ready' }
  }
  if (connection === 'offline' || connection === 'otherTab' || connection === 'unsupported')
    return { kind: 'unavailable', reason: connection }
  if (connection === 'error') return { kind: 'unavailable', reason: 'error' }
  return { kind: 'waiting' }
}

/** A verification callback can set "verified" while an async action still
 * owns the UI. Revisit the intent when that action finishes; never mark an
 * ignored launch as completed.
 */
export function canAutoOpenChat(decision: ChatEntryDecision, busy: boolean, alreadyOpened: boolean): boolean {
  return decision.kind === 'ready' && !busy && !alreadyOpened
}
