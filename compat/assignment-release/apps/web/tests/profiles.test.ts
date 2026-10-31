import { describe, expect, it } from 'vitest'
import piexif, { type Exif } from 'piexifjs'
import { geometry, jpegMetadata, ResolutionError, selectedExif, stripEncodedMetadata } from '../src/profiles/image'
import { defaultRules, missingRequirements, snapshot } from '../src/profiles/model'

describe('profile capture rules', () => {
  it('crops a square at actual maximum resolution and never stretches the source', () => {
    const square = geometry(1600, 1200, { ...defaultRules(), aspect: '1:1' })
    expect(square).toMatchObject({ width: 1200, height: 1200, drawWidth: 1600, drawHeight: 1200, x: -200, y: 0 })
    expect(geometry(1600, 1200, { ...defaultRules(), aspect: '1:1', fit: 'contain' })).toMatchObject({ width: 1600, height: 1600, drawWidth: 1600, drawHeight: 1200, x: 0, y: 200 })
  })
  it('requires explicit consent to a lower resolution rather than upscaling', () => {
    const rules = { ...defaultRules(), resolution: 'fixed' as const, width: 4000, height: 3000 }
    expect(() => geometry(1600, 1200, rules)).toThrow(ResolutionError)
    expect(geometry(1600, 1200, rules, true)).toMatchObject({ width: 1600, height: 1200, limited: true })
  })
  it('removes unselected EXIF fields, embedded thumbnails and location from a real serialized EXIF block', () => {
    const source: Exif = { '0th': { 271: 'Synthetic camera', 272: 'Fixture', 274: 6, 306: '2020:01:01 00:00:00' }, Exif: { 36867: '2020:01:01 00:00:00', 42033: 'private-serial' }, GPS: { 1: 'N', 2: [[1, 1], [2, 1], [3, 1]], 3: 'E', 4: [[4, 1], [5, 1], [6, 1]] }, Interop: {}, '1st': {}, thumbnail: null }
    const filtered = selectedExif(source, { ...defaultRules(), keepDate: false, keepCamera: true }, {}, 800, 800)
    const serialized = piexif.dump(filtered)
    const parsed = piexif.load(serialized)
    expect(parsed['0th'][271]).toBe('Synthetic camera')
    expect(parsed['0th'][274]).toBe(1)
    expect(parsed.Exif[36867]).toBeUndefined()
    expect(parsed.Exif[42033]).toBeUndefined()
    expect(parsed.GPS).toEqual({})
    expect(parsed.thumbnail).toBeNull()
    const segment = new Uint8Array([255, 216, 255, 225, (serialized.length + 2) >> 8, (serialized.length + 2) & 255, ...Uint8Array.from(serialized, char => char.charCodeAt(0)), 255, 217])
    expect(jpegMetadata(segment).exif).toBe(serialized)
  })
  it('keeps an immutable profile snapshot and independent requirements', () => {
    const profile = { id: 'profile', name: 'Inspection', description: '', version: 1, rules: { ...defaultRules(), descriptionRequired: true, categoryRequired: true, location: 'required' as const } }
    const previous = snapshot(profile)
    profile.rules.descriptionRequired = false
    expect(previous.rules.descriptionRequired).toBe(true)
    expect(missingRequirements({ note: '', profile: previous, metadata: {} })).toEqual(['description', 'category', 'location'])
    expect(missingRequirements({ note: 'Done', category: 'Facade', profile: previous, metadata: { location: { latitude: 1, longitude: 2, accuracy: 5, measuredAt: Date.now() } } })).toEqual([])
  })
  it('removes EXIF inserted by a browser encoder before applying the profile policy', async () => {
    const exif = piexif.dump({ '0th': { 271: 'Private camera' } })
    const encoded = new Blob([new Uint8Array([255, 216, 255, 225, (exif.length + 2) >> 8, (exif.length + 2) & 255]), Uint8Array.from(exif, char => char.charCodeAt(0)), new Uint8Array([255, 218, 0, 2, 1, 2, 3, 255, 217])], { type: 'image/jpeg' })
    const cleaned = new Uint8Array(await (await stripEncodedMetadata(encoded)).arrayBuffer())
    expect(jpegMetadata(cleaned).exif).toBeUndefined()
    expect([...cleaned]).toEqual([255, 216, 255, 218, 0, 2, 1, 2, 3, 255, 217])
  })
})
