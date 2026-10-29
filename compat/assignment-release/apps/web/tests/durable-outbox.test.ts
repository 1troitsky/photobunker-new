// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { validateDurableText, MAX_DURABLE_TEXT } from '../src/messages/durable-outbox'

const valid = {
  id: '~pb-ui:pb-11111111-2222-4333-8444-555555555555',
  txnId: 'pb-11111111-2222-4333-8444-555555555555',
  roomId: '!encrypted-room:local',
  body: 'Synthetic optimistic text',
  time: 1792690000000,
}

describe('P0 encrypted outbox contract', () => {
  it('only accepts one exact stable Matrix transaction ID per local operation', () => {
    expect(validateDurableText(valid)).toEqual(valid)
    expect(() => validateDurableText({ ...valid, id: '~pb-ui:pb-other' })).toThrow('outbox.invalid')
    expect(() => validateDurableText({ ...valid, txnId: 'pb-not-a-uuid' })).toThrow('outbox.invalid')
  })
  it('rejects malformed room references, oversized and blank content', () => {
    for (const value of [
      { ...valid, roomId: '$event:local' },
      { ...valid, body: ' ' },
      { ...valid, body: 'x'.repeat(10001) },
      { ...valid, time: NaN },
      { ...valid, reply: '!room:local' },
      { ...valid, photoId: 'cross-scope-id' },
    ]) expect(() => validateDurableText(value)).toThrow('outbox.invalid')
    expect(MAX_DURABLE_TEXT).toBeLessThanOrEqual(200)
  })
  it('persists a direct recipient before a Matrix room exists and requires one target', () => {
    const { roomId: _roomId, ...base } = valid
    const pending = { ...base, peerId: 'pb_recipient123' }
    expect(validateDurableText(pending)).toEqual(pending)
    expect(() => validateDurableText({ ...pending, roomId: valid.roomId })).toThrow('outbox.invalid')
    expect(() => validateDurableText({ ...base })).toThrow('outbox.invalid')
    expect(() => validateDurableText({ ...base, peerId: 'not a public id' })).toThrow('outbox.invalid')
  })
  it('does not allow attacker-controlled unknown fields to survive canonical serialization', () => {
    const received = validateDurableText({ ...valid, injection: 'bad', rawAccessToken: 'example' }) as unknown as Record<string, unknown>
    expect(received).not.toHaveProperty('injection')
    expect(received).not.toHaveProperty('rawAccessToken')
  })
})
