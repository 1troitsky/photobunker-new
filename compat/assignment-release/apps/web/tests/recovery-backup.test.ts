import { expect, it } from 'vitest'
import { parseRecoveryBackup } from '../src/identity/recovery'
it('accepts the original account key and the combined account/photo recovery download', () => {
  const accountKey = 'PB1.synthetic_public.synthetic_private', photoKey = 'PB4.account.recovery.hash.secret'
  expect(parseRecoveryBackup(accountKey)).toEqual({ accountKey, photoKey: undefined })
  expect(parseRecoveryBackup(`${accountKey}\n\n${photoKey}\n`)).toEqual({ accountKey, photoKey })
})
it('rejects ambiguous, incomplete and oversized recovery backups', () => {
  for (const value of ['', 'PB4.only-photo-key', 'PB1.a.b PB1.c.d', 'PB1.a.b junk', 'PB1.a.b PB4.a PB4.b', 'PB1.' + 'a'.repeat(8200) + '.b'])
    expect(() => parseRecoveryBackup(value)).toThrow('invalid_backup')
})
