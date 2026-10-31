import { describe, expect, it } from 'vitest'
import { decideChatEntry, canAutoOpenChat } from '../src/messages/chat-entry'

describe('P0 / first-message chat entry state machine', () => {
  it('never tries to create a Matrix room before crypto and sync bootstrap finishes', () => {
    for (const stage of ['idle', 'session', 'sdk', 'storage', 'crypto', 'sync', 'peers', 'security']) {
      expect(decideChatEntry('ready', stage, true)).toEqual({ kind: 'waiting' })
    }
  })
  it('allows a fresh encrypted conversation while old history still needs device recovery', () => {
    expect(decideChatEntry('ready', 'ready', false)).toEqual({ kind: 'ready' })
  })
  it('allows room opening only after actual verified Matrix readiness', () => {
    expect(decideChatEntry('ready', 'ready', true)).toEqual({ kind: 'ready' })
  })
  it('does not consume the pending intent while verification/recovery action is still busy', () => {
    const ready = decideChatEntry('ready', 'ready', true)
    expect(canAutoOpenChat(ready, true, false)).toBe(false)
    expect(canAutoOpenChat(ready, false, false)).toBe(true)
    expect(canAutoOpenChat(ready, false, true)).toBe(false)
    expect(canAutoOpenChat(decideChatEntry('ready', 'ready', false), false, false)).toBe(true)
  })
  it('makes connection failures actionable and distinct from key recovery', () => {
    for (const reason of ['offline', 'otherTab', 'unsupported', 'error'] as const) {
      expect(decideChatEntry(reason, 'ready', false)).toEqual({ kind: 'unavailable', reason })
    }
    expect(decideChatEntry('connecting', 'sync', false)).toEqual({ kind: 'waiting' })
  })
})
