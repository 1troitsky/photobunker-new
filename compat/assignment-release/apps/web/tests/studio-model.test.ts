import { describe, expect, it } from 'vitest'
import { captureProfile, imageRules, newPreset, newTask, retentionSeconds, sessionFor, validateParticipants, validatePreset, validateTask } from '../src/studio/model'
import { missingRequirements } from '../src/profiles/model'

describe('local UI workspace contracts', () => {
  it('keeps the capture snapshot independent from later preset and assignment edits', () => {
    const task = newTask('Inspect'), preset = newPreset('Square')
    task.preset = preset; task.shots = ['Entrance']; task.rules.categories = ['Facade']
    const session = sessionFor(task)
    preset.name = 'Changed'; task.shots.push('Window'); task.rules.categories.push('Roof')
    expect(session.preset?.name).toBe('Square'); expect(session.shots).toEqual(['Entrance']); expect(session.rules.categories).toEqual(['Facade'])
  })

  it('validates schedule separately from capture count and participant IDs', () => {
    const task = newTask('Inspect')
    task.startsAt = 200; task.finishesAt = 100; expect(validateTask(task)).toBe('basics')
    task.finishesAt = 300; task.targetCount = 0; expect(validateTask(task)).toBe('captureSettings')
    task.targetCount = 3; expect(validateTask(task)).toBeUndefined()
    expect(validateParticipants([{ id: 'Person', name: '', role: 'viewer', notify: false }, { id: 'person', name: '', role: 'contributor', notify: false }])).toBe(false)
  })

  it('requires specified categories and rejects malformed numeric settings', () => {
    const task = newTask('Inspect'); task.rules.particularCategory = true
    expect(validateTask(task)).toBe('rules'); task.rules.categories = ['Facade']; expect(validateTask(task)).toBeUndefined()
    const preset = newPreset('Custom'); preset.options.size = 'custom'; preset.rules.width = NaN
    expect(validatePreset(preset)).toBe('image')
  })

  it('distinguishes no auto-delete, custom retention and invalid retention', () => {
    const preset = newPreset('Lifetime')
    preset.options.retention = 0; expect(retentionSeconds(preset)).toBe(0); expect(validatePreset(preset)).toBeUndefined()
    preset.options.retention = 'custom'; preset.options.customHours = 2.5; expect(retentionSeconds(preset)).toBe(9000)
    preset.options.customHours = 0; expect(validatePreset(preset)).toBe('retention')
  })

  it('omits combined EXIF datetime when only one of date and time is retained', () => {
    const preset = newPreset('Date only'); preset.options.time = false
    const profile = captureProfile(sessionFor(undefined, preset), 'Standard')
    expect(profile.rules.keepDate).toBe(false)
    expect(profile.rules.retentionSeconds).toBe(1209600)
  })

  it('caps resolution without upscaling the available crop', () => {
    const preset = newPreset('Low'); preset.options.size = 'low'; preset.rules.aspect = '1:1'
    const profile = captureProfile(sessionFor(undefined, preset), 'Standard')
    expect(imageRules(profile, preset, 1600, 1200)).toMatchObject({ width: 640, height: 640, resolution: 'fixed' })
    expect(imageRules(profile, preset, 400, 300)).toMatchObject({ width: 300, height: 300 })
  })

  it('checks description length while keeping owner access to metadata', () => {
    const task = newTask('Inspect'); task.rules.descriptionRequired = true; task.rules.minLength = 10; task.rules.changesAllowed = false
    const profile = captureProfile(sessionFor(task), 'Standard')
    expect(profile.rules.descriptionEditable).toBe(true)
    expect(missingRequirements({ profile, note: 'short', category: '', uiRules: task.rules })).toContain('description')
    expect(missingRequirements({ profile, note: 'Long enough description', category: '', uiRules: task.rules })).not.toContain('description')
  })
})
