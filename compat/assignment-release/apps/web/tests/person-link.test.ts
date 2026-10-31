import { expect, it } from 'vitest'
import { profilePath, profileReturnTo } from '../src/identity/person'
it('shares a canonical profile path containing only the public identifier', () => {
  expect(profilePath('pb_sample')).toBe('/people/pb_sample')
  expect(profilePath('@sample')).toBe('/people/%40sample')
})
it('returns after authentication only to supported local profile routes', () => {
  expect(profileReturnTo('/people/pb_sample')).toBe('/people/pb_sample')
  expect(profileReturnTo('/people/%40sample')).toBe('/people/%40sample')
  for (const value of ['https://other.invalid', '//other.invalid', '/people/pb_sample?key=secret', '/people/../settings', ['/people/pb_sample'], undefined]) expect(profileReturnTo(value)).toBe('/profile')
})
