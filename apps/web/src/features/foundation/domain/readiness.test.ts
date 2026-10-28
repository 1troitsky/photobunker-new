import { describe, expect, it } from 'vitest'

import { foundationReadiness } from './readiness'

describe('foundation invariants', () => {
  it('does not include legacy or messenger runtime', () => {
    expect(foundationReadiness).toEqual({
      productionBuild: true,
      legacyRuntimeIncluded: false,
      messengerIncluded: false,
    })
  })
})
