import {
  aspectRatio,
  defaultRules,
  type Profile,
  type ProfileRules,
} from '../profiles/model'

export type Size = 'maximum' | 'high' | 'medium' | 'low' | 'custom'
export type PresetOptions = {
  size: Size
  date: boolean
  time: boolean
  retention: number | 'custom'
  customHours: number
}
export type Preset = Profile & {
  uiOnly: true
  originServer?: boolean
  hidden?: boolean
  revision: number
  options: PresetOptions
}
export type Participant = {
  id: string
  name: string
  role: 'curator' | 'contributor' | 'viewer'
  notify: boolean
  photoScope?: 'default' | 'none' | 'thumbnails' | 'all'
  state?: 'invited' | 'accepted' | 'declined'
  invitationId?: string
  expiresAt?: number
}
export type Team = {
  id: string
  name: string
  description?: string
  participants: Participant[]
  revision: number
  accountId?: string
  canManage?: boolean
  role?: 'owner' | 'curator' | 'contributor' | 'viewer'
  ownerPublicId?: string
}
export type ContributorRules = {
  categoryRequired: boolean
  particularCategory: boolean
  categories: string[]
  descriptionRequired: boolean
  minLength: number
  changesAllowed: boolean
  keepOriginal: boolean
  deletionAllowed: boolean
  galleryAllowed: boolean
  thumbnailsOnly: boolean
  sharingAllowed: boolean
  participantsOnly: boolean
  useAssignmentPhotoId: boolean
}
export type Task = {
  id: string
  name: string
  instructions: string
  startsAt: number | null
  finishesAt: number | null
  targetCount: number
  shots: string[]
  presetId: string
  preset: Preset | null
  teamId: string
  teamName?: string
  participants: Participant[]
  rules: ContributorRules
  completed: boolean
  revision: number
  createdAt: number
  accountId?: string
  canManage?: boolean
  role?: 'owner' | 'curator' | 'contributor' | 'viewer'
  ownerPublicId?: string
  discussion?: { roomId: string | null; state: string }
}
export type Session = {
  taskId: string
  taskName: string
  taskRevision: number
  teamId?: string
  teamName?: string
  preset: Preset | null
  shots: string[]
  rules: ContributorRules
  category: string
  accountId?: string
}
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
export function contributorRules(): ContributorRules {
  return {
    categoryRequired: false,
    particularCategory: false,
    categories: [],
    descriptionRequired: false,
    minLength: 10,
    changesAllowed: true,
    keepOriginal: true,
    deletionAllowed: true,
    galleryAllowed: true,
    thumbnailsOnly: false,
    sharingAllowed: true,
    participantsOnly: true,
    useAssignmentPhotoId: true,
  }
}
export function newPreset(name: string, source?: Profile): Preset {
  const rules = clone(source?.rules ?? defaultRules())
  return {
    id: source?.id ?? crypto.randomUUID(),
    name: source?.name ?? name,
    description: source?.description ?? '',
    version: source?.version ?? 0,
    revision: 0,
    uiOnly: true,
    originServer: !!source,
    rules,
    options: {
      size: rules.resolution === 'fixed' ? 'custom' : 'maximum',
      date: rules.keepDate,
      time: rules.keepDate,
      retention: rules.retentionSeconds ?? 1209600,
      customHours: 48,
    },
  }
}
export function newTask(name: string): Task {
  return {
    id: crypto.randomUUID(),
    name,
    instructions: '',
    startsAt: null,
    finishesAt: null,
    targetCount: 1,
    shots: [],
    presetId: '',
    preset: null,
    teamId: '',
    participants: [],
    rules: contributorRules(),
    completed: false,
    revision: 0,
    createdAt: Date.now(),
  }
}
export function lines(value: string): string[] {
  return [
    ...new Set(
      value
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]
}
export function retentionSeconds(preset?: Preset | null): number {
  return preset
    ? preset.options.retention === 'custom'
      ? Math.round(preset.options.customHours * 3600)
      : preset.options.retention
    : 1209600
}
export function sessionFor(task?: Task, preset?: Preset | null): Session {
  return {
    taskId: task?.id ?? '',
    taskName: task?.name ?? '',
    taskRevision: task?.revision ?? 0,
    teamId: task?.teamId,
    teamName: task?.teamName,
    preset: clone(task?.preset ?? preset ?? null),
    shots: clone(task?.shots ?? []),
    rules: clone(task?.rules ?? contributorRules()),
    category: '',
    accountId: task?.accountId,
  }
}
export function captureProfile(
  session: Session,
  standardName: string,
): Profile {
  const preset = session.preset
  const rules = clone(preset?.rules ?? defaultRules())
  rules.descriptionRequired = session.rules.descriptionRequired
  rules.descriptionEditable = true
  rules.categoryRequired = session.rules.categoryRequired
  rules.categories = clone(
    session.rules.particularCategory
      ? session.rules.categories
      : [...new Set([...rules.categories, ...session.rules.categories])],
  )
  rules.shotList = clone(session.shots)
  rules.retentionSeconds = retentionSeconds(preset)
  if (preset) {
    rules.keepDate = preset.options.date && preset.options.time
    rules.metadata = 'selected'
  }
  return {
    id: preset?.id ?? 'standard-local',
    name: preset?.name ?? standardName,
    description: preset?.description ?? '',
    version: preset?.version ?? 1,
    rules,
  }
}
export function imageRules(
  profile: Profile,
  preset: Preset | null,
  width: number,
  height: number,
): ProfileRules {
  const rules = clone(profile.rules)
  const limit =
    preset?.options.size === 'high'
      ? 2560
      : preset?.options.size === 'medium'
        ? 1280
        : preset?.options.size === 'low'
          ? 640
          : 0
  if (!limit) return rules
  const ratio = aspectRatio(rules) ?? width / height
  let availableWidth =
    rules.fit === 'crop'
      ? Math.min(width, height * ratio)
      : Math.max(width, height * ratio)
  let availableHeight = availableWidth / ratio
  const scale = Math.min(1, limit / Math.max(availableWidth, availableHeight))
  availableWidth = Math.max(64, Math.floor(availableWidth * scale))
  availableHeight = Math.max(64, Math.floor(availableHeight * scale))
  return {
    ...rules,
    resolution: 'fixed',
    width: availableWidth,
    height: availableHeight,
  }
}
export function validateParticipants(items: Participant[]): boolean {
  return (
    items.length <= 100 &&
    items.every(
      (item) =>
        item.id.trim().length >= 3 &&
        item.id.length <= 120 &&
        !/\s/.test(item.id) &&
        ['curator', 'contributor', 'viewer'].includes(item.role),
    ) &&
    new Set(items.map((item) => item.id.trim().toLowerCase())).size ===
      items.length
  )
}
export function validatePreset(
  item: Preset,
): 'basics' | 'image' | 'metadata' | 'retention' | undefined {
  if (
    !item.name.trim() ||
    item.name.length > 80 ||
    item.description.length > 1000
  )
    return 'basics'
  if (
    !['maximum', 'high', 'medium', 'low', 'custom'].includes(
      item.options.size,
    ) ||
    !Number.isFinite(item.rules.quality) ||
    item.rules.quality < 0.6 ||
    item.rules.quality > 1
  )
    return 'image'
  if (
    item.options.size === 'custom' &&
    (!Number.isInteger(item.rules.width) ||
      !Number.isInteger(item.rules.height) ||
      Math.min(item.rules.width, item.rules.height) < 64 ||
      Math.max(item.rules.width, item.rules.height) > 16384 ||
      item.rules.width * item.rules.height > 50_000_000)
  )
    return 'image'
  if (
    item.rules.aspect === 'custom' &&
    ![item.rules.aspectWidth, item.rules.aspectHeight].every(
      (value) => Number.isFinite(value) && value >= 1 && value <= 100,
    )
  )
    return 'image'
  if (
    ![item.rules.accuracy, item.rules.locationWindow].every(
      (value) => Number.isFinite(value) && value > 0,
    ) ||
    item.rules.locationWindow > 60 ||
    item.rules.accuracy > 1000
  )
    return 'metadata'
  const seconds = retentionSeconds(item)
  if (
    !Number.isFinite(seconds) ||
    (item.options.retention === 'custom' && seconds < 3600) ||
    (seconds !== 0 && (seconds < 3600 || seconds > 31536000))
  )
    return 'retention'
}
export function validateTask(
  item: Task,
): 'basics' | 'captureSettings' | 'participants' | 'rules' | undefined {
  if (
    !item.name.trim() ||
    item.name.length > 80 ||
    item.instructions.length > 4000 ||
    [item.startsAt, item.finishesAt].some(
      (value) => value !== null && !Number.isFinite(value),
    ) ||
    (item.startsAt !== null &&
      item.finishesAt !== null &&
      item.finishesAt <= item.startsAt)
  )
    return 'basics'
  if (
    !Number.isInteger(item.targetCount) ||
    item.targetCount < 1 ||
    item.targetCount > 999 ||
    item.shots.length > 100 ||
    item.shots.some((value) => value.length > 80)
  )
    return 'captureSettings'
  if (!validateParticipants(item.participants)) return 'participants'
  if (
    !Number.isInteger(item.rules.minLength) ||
    item.rules.minLength < 1 ||
    item.rules.minLength > 2000 ||
    item.rules.categories.length > 30 ||
    item.rules.categories.some((value) => value.length > 80) ||
    (item.rules.particularCategory && !item.rules.categories.length)
  )
    return 'rules'
}
