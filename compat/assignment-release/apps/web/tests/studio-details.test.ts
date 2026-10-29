import { describe, expect, it } from 'vitest'
import type { Photo } from '../src/local/photos'
import { defaultRules, missingRequirements } from '../src/profiles/model'
import { detailsChanges, detailsFor } from '../src/studio/details'
import { capturePresetLabel, externalPhotoData, internalAuthor } from '../src/studio/disclosure'
import { emptyEdits } from '../src/studio/versions'
import { imagePoint, outputPoint, textCorners, textContains } from '../src/studio/geometry'
function photo(extra: Partial<Photo> = {}): Photo { return { id: 'private-photo', title: '', note: '', favorite: false, uiOnly: true, profile: { id: 'private-preset', name: 'Private preset', description: '', version: 4, rules: { ...defaultRules(), categories: ['Facade'] } }, ...extra } as Photo }

describe('category rules and manual photo details', () => {
  it('supports independent required and limited rules', () => {
    for (const required of [false, true]) for (const limited of [false, true]) {
      const item = photo({ uiRules: { descriptionRequired: false, minLength: 10, particularCategory: limited } })
      item.profile!.rules.categoryRequired = required
      for (const category of ['', 'Facade', 'Other']) {
        const missing = missingRequirements({ ...item, category })
        expect(missing.includes('category')).toBe(required && !category || limited && !!category && category !== 'Facade')
        const draft = { ...detailsFor(item), category }
        if (limited && category === 'Other') expect(() => detailsChanges(item, draft)).toThrow()
        else expect(detailsChanges(item, draft).category).toBe(category)
      }
    }
  })
  it('marks manual coordinates without claiming GPS precision or modifying original metadata', () => {
    const item = photo(); const changes = detailsChanges(item, { ...detailsFor(item), latitude: '-33,9', longitude: '18.4' })
    expect(changes.metadata?.location).toMatchObject({ latitude: -33.9, longitude: 18.4, source: 'manual' })
    expect(changes.metadata?.locationEditedAt).toBeGreaterThan(0)
    expect(item.metadata).toBeUndefined()
    item.profile!.rules.location = 'required'
    expect(missingRequirements({ ...item, metadata: changes.metadata })).toContain('location')
  })
  it('rejects incomplete and invalid coordinates; clearing them records an explicit edit', () => {
    const item = photo({ metadata: { location: { latitude: 41, longitude: 44, accuracy: 10, measuredAt: 1 } } })
    for (const [latitude, longitude] of [['91','0'],['0','181'],['NaN','1'],['','2']]) expect(() => detailsChanges(item, { ...detailsFor(item), latitude, longitude })).toThrow()
    expect(detailsChanges(item, { ...detailsFor(item), latitude: '', longitude: '' }).metadata).toMatchObject({ location: undefined, locationEditedAt: expect.any(Number) })
  })
})

describe('private capture context and public disclosure', () => {
  it('builds an explicit public allowlist without author, internal IDs, coordinates or preset', () => {
    const item = photo({ creatorId: 'private-author', assignmentId: 'private-task', spaceId: 'private-team', tags: ['private-tag'], metadata: { camera: 'private-camera', location: { latitude: 41, longitude: 44, accuracy: 1, measuredAt: 1 } }, captureContext: { standard: false, presetName: 'private-capture-preset', author: { kind: 'device' }, teamName: 'private-team-name' } })
    const publicData = externalPhotoData(item)
    expect(Object.keys(publicData).sort()).toEqual(['category', 'description', 'expiresAt', 'title'])
    expect(JSON.stringify(publicData)).not.toContain('private-')
    expect(internalAuthor(item)).toContain('устройство')
    expect(capturePresetLabel(item)).toBe('private-capture-preset')
  })
  it('does not expose a legacy creator without a team access context or invent missing capture facts', () => {
    const item = photo({ uiOnly: false, creatorId: 'private-author', spaceId: 'private-team', profile: undefined })
    expect(internalAuthor(item)).toBeUndefined()
    expect(capturePresetLabel(item)).toContain('не сохранён')
    item.access = { role: 'viewer', readOwnPhotos: true, manageProfiles: false }
    expect(internalAuthor(item)).toBe('private-author')
  })
})

it('keeps annotation coordinates attached to the image through crop, mirror and all rotations', () => {
  for (const rotation of [0,1,2,3]) for (const mirror of [false,true]) for (const crop of ['native','1:1','4:3','16:9'] as const) {
    const edits = { ...emptyEdits(), rotation, mirror, crop }
    const point = { x: .23, y: .67 }, source = imagePoint(point, 1600, 1200, edits), output = outputPoint(source, 1600, 1200, edits)
    expect(output.x).toBeCloseTo(point.x, 8); expect(output.y).toBeCloseTo(point.y, 8)
  }
})

it('creates horizontal, readable text in the current rotated or mirrored viewport', () => {
  for (const rotation of [0,1,2,3]) for (const mirror of [false,true]) {
    const edits = { ...emptyEdits(), rotation, mirror }
    const anchor = imagePoint({ x: .2, y: .3 }, 1600, 1200, edits)
    const layer = { ...anchor, id: 'text', rotation, mirror, text: 'Hello', size: .05, color: '#fff' }
    const corners = textCorners(layer, 1600, 1200).map(point => outputPoint(point, 1600, 1200, edits))
    expect(corners[1]!.x).toBeGreaterThan(corners[0]!.x); expect(corners[1]!.y).toBeCloseTo(corners[0]!.y)
    expect(corners[2]!.y).toBeGreaterThan(corners[0]!.y); expect(corners[2]!.x).toBeCloseTo(corners[0]!.x)
    expect(textContains(layer, imagePoint({ x: .21, y: .31 }, 1600, 1200, edits), 1600, 1200)).toBe(true)
  }
})
