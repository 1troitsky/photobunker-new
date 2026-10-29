import { describe, it, expect } from 'vitest'
import { retryDelayMs, isTransientMessageError } from '../src/messages/retry-policy'

describe('P0 local-first Matrix retry policy', () => {
  it('retries outages and rate limits, not account authorization or trust failures', () => {
    for (const value of [{httpStatus:429},{httpStatus:500},{httpStatus:503},{name:'TypeError'},{name:'NetworkError'},{errcode:'M_LIMIT_EXCEEDED'}])
      expect(isTransientMessageError(value)).toBe(true)
    for (const value of [{httpStatus:401},{httpStatus:403},{httpStatus:404},{message:'messages.cancelled'},{message:'unsafe_room'},{message:'room_not_ready'},{name:'OperationError'},{errcode:'M_FORBIDDEN'}])
      expect(isTransientMessageError(value)).toBe(false)
  })
  it('enforces exponential backoff with a 60-second ceiling', () => {
    expect([0,1,2,3,4,5,6,7,8].map(retryDelayMs))
      .toEqual([1000,2000,4000,8000,16000,32000,60000,60000,60000])
  })
})
