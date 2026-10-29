import type { Access } from '../collaboration/model'
export type ProfileRules = {
  curatorDescriptionEditable?: boolean
  retentionSeconds?: number
  resolution: 'maximum' | 'fixed'; width: number; height: number
  aspect: 'native' | '1:1' | '4:3' | '3:2' | '16:9' | 'custom'; aspectWidth: number; aspectHeight: number
  fit: 'crop' | 'contain'; quality: number
  metadata: 'all' | 'selected' | 'none'; keepDate: boolean; keepCamera: boolean
  location: 'off' | 'optional' | 'required'; accuracy: number; locationWindow: number
  descriptionRequired: boolean; descriptionEditable: boolean; categoryRequired: boolean
  categories: string[]; shotList: string[]; idPrefix: string
}
export type Profile = { id: string; name: string; description: string; version: number; rules: ProfileRules; archived?: boolean; spaceId?: string; access?: Access }
export type Location = { source?: 'gps'; latitude: number; longitude: number; accuracy: number; measuredAt: number }
export type ManualLocation = { source: 'manual'; latitude: number; longitude: number }
export type PhotoMetadata = { locationEditedAt?: number; date?: string; time?: string; capturedAt?: number; camera?: string; location?: Location | ManualLocation; locationStatus?: 'pending' | 'unavailable'; resolutionLimited?: boolean }

export function defaultRules(): ProfileRules {
  return { retentionSeconds: 1209600, resolution: 'maximum', width: 1600, height: 1200, aspect: 'native', aspectWidth: 4, aspectHeight: 3,
    fit: 'crop', quality: 0.94, metadata: 'selected', keepDate: true, keepCamera: false,
    location: 'off', accuracy: 20, locationWindow: 15, descriptionRequired: false, descriptionEditable: true,
    categoryRequired: false, categories: [], shotList: [], idPrefix: '' }
}
export function aspectRatio(rules: ProfileRules): number | undefined {
  if (rules.aspect === 'native') return rules.resolution === 'fixed' ? rules.width / rules.height : undefined
  if (rules.aspect === 'custom') return rules.aspectWidth / rules.aspectHeight
  const [width, height] = rules.aspect.split(':').map(Number)
  return width! / height!
}
export function snapshot(profile: Profile): Profile { return JSON.parse(JSON.stringify({ id: profile.id, name: profile.name, description: profile.description, version: profile.version, rules: profile.rules, spaceId: profile.spaceId, access: profile.access })) }
export function missingRequirements(photo: { uiRules?: { descriptionRequired: boolean; minLength: number; particularCategory?: boolean }; note: string; category?: string; metadata?: PhotoMetadata; profile?: Profile }): ('description' | 'category' | 'location' | 'resolution')[] {
  const rules = photo.profile?.rules
  if (!rules) return []
  const missing: ('description' | 'category' | 'location' | 'resolution')[] = []
  if ((rules.descriptionRequired || photo.uiRules?.descriptionRequired) && photo.note.trim().length < (photo.uiRules?.minLength ?? 1)) missing.push('description')
  if (rules.categoryRequired && !photo.category?.trim() || photo.uiRules?.particularCategory && !!photo.category && !rules.categories.includes(photo.category)) missing.push('category')
  if (rules.location === 'required' && (!photo.metadata?.location || photo.metadata.location.source === 'manual' || photo.metadata.location.accuracy > rules.accuracy)) missing.push('location')
  if (photo.metadata?.resolutionLimited) missing.push('resolution')
  return missing
}
