import { describe, expect, it } from 'vitest'
import { assignmentFixtures, photoFixtures } from './fixtures'

describe('R2-02 explicit fixture-only interface', () => {
  it('contains inert demo content and no server credentials or original images', () => {
    expect(photoFixtures).toHaveLength(6)
    expect(assignmentFixtures).toHaveLength(3)
    expect(new Set(photoFixtures.map(photo => photo.id)).size).toBe(6)
    expect(photoFixtures.every(photo => /^[A-Z]{4}\d{4}$/.test(photo.id))).toBe(true)
    expect(assignmentFixtures.every(assignment => assignment.title.en && assignment.title.ru)).toBe(true)
  })
})
