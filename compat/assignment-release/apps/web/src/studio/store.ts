import { account, deviceId, sessionState, hasConfirmedIdentity, loadIdentity } from '../identity/store'
import { appLockReady, appLocked } from '../app/lock'
import { IdentityError, IdentityNetworkError, IdentityTimeoutError } from '../identity/api'
import { mutateTeamCache, readTeamCache, type TeamCache, type TeamTaskSummary } from '../workspace/team-local'
import * as workspace from '../workspace/api'
import { invitations } from '../workspace/state'
import { taskGrants } from '../workspace/access'
import { computed, ref, watch } from 'vue'
import { accessLibraryId } from '../server/api'
import { profiles } from '../profiles/store'
import {
  clone,
  newPreset,
  sessionFor,
  validateParticipants,
  validatePreset,
  validateTask,
  type Preset,
  type Session,
  type Task,
  type Team,
} from './model'
import * as repository from './repository'
import { cleanupVersions } from './versions'

export const localPresets = ref<Preset[]>([]),
  localTasks = ref<Task[]>([]),
  teams = ref<Team[]>([])
export const cachedTeamTasks = ref<TeamTaskSummary[]>([])
export const pendingTeamIds = ref<string[]>([])
export const teamSyncErrors = ref<string[]>([])
export const personalCategories = ref<string[]>([])
let categoryRevision = 0
export const selectedCategory = ref('')
export const studioReady = ref(false),
  studioError = ref(false)
export const studioSession = ref<Session | null>(null)
const scope = () =>
  account.value
    ? `account:${account.value.id}`
    : accessLibraryId.value || 'device'
let generation = 0
let sendingTeams: { scope: string; promise: Promise<void> } | undefined
let teamRetryTimer: ReturnType<typeof setTimeout> | undefined
let teamRetryAttempt = 0
const teamCacheScope = () => account.value?.id && deviceId.value &&
  appLockReady.value && !appLocked.value && sessionState.value !== 'signed-out' &&
  sessionState.value !== 'revoked'
    ? 'team:' + account.value.id + ':' + deviceId.value : ''
function projectTeams(data: TeamCache) {
  const list = new Map(data.snapshot.map(team => [team.id, team]))
  for (const pending of data.pending) list.set(pending.id, pending)
  teams.value = [...list.values()]
  cachedTeamTasks.value = data.tasks ?? []
  pendingTeamIds.value = data.pending.map(team => team.id)
}
async function restoreTeamsFromDevice(owner: string) {
  const key = teamCacheScope()
  if (!key || owner !== scope()) return
  const data = await readTeamCache(key)
  if (owner === scope() && key === teamCacheScope()) projectTeams(data)
}
function sameTeam(source: Team, candidate: Team) {
  const participants = (team: Team) => team.participants.map(person => ({
    id: person.id.toLowerCase(), role: person.role,
    photoScope: person.photoScope || 'default',
  })).sort((a, b) => a.id.localeCompare(b.id))
  return source.name.trim() === candidate.name.trim() &&
    (source.description || '') === (candidate.description || '') &&
    JSON.stringify(participants(source)) === JSON.stringify(participants(candidate))
}
function retryTeamOnTransientFailure(key: string, failure: unknown) {
  const transient = failure instanceof IdentityNetworkError ||
    failure instanceof IdentityTimeoutError ||
    (failure instanceof IdentityError && failure.status >= 500)
  if (!transient || teamRetryTimer || !navigator.onLine) return
  const delay = Math.min(30_000, 2000 * 2 ** teamRetryAttempt)
  teamRetryAttempt = Math.min(teamRetryAttempt + 1, 4)
  teamRetryTimer = setTimeout(() => {
    teamRetryTimer = undefined
    if (key === teamCacheScope() && hasConfirmedIdentity()) scheduleTeamFlush()
  }, delay)
}
// Deliver only while server Identity is really confirmed, never from an
// R0-02 offline capture descriptor. Existing Workspace revision checks and
// UUIDs prevent extra Team records on lost ACK/retry.
export function flushPendingTeams(): Promise<void> {
  const key = teamCacheScope()
  if (!key || !hasConfirmedIdentity()) return Promise.resolve()
  if (sendingTeams?.scope === key) return sendingTeams.promise
  const job = (async () => {
  const owner = scope()
  try {
    for (const intent of (await readTeamCache(key)).pending) {
      if (teamCacheScope() !== key || scope() !== owner || !hasConfirmedIdentity()) return
      try {
        let saved: Team | undefined
        // Probe first to reconcile a lost success response before re-PUT.
        try {
          const remote = await workspace.request<Team>('/team/' + encodeURIComponent(intent.id))
          if (sameTeam(remote, intent)) saved = remote
          else if (remote.revision !== intent.revision) {
            teamSyncErrors.value = [...new Set([...teamSyncErrors.value, intent.id])]
            continue
          }
        } catch { /* New Team (404) or network loss: keep the same UUID. */ }
        if (!saved) saved = await workspace.save('team', intent)
        if (teamCacheScope() !== key || scope() !== owner) return
        const accepted = saved
        const next = await mutateTeamCache(key, data => ({
          snapshot: [...data.snapshot.filter(item => item.id !== accepted.id), accepted],
          pending: data.pending.filter(item => item.id !== intent.id ||
            JSON.stringify(item) !== JSON.stringify(intent)),
        }))
        if (teamCacheScope() !== key || scope() !== owner) return
        projectTeams(next)
        teamSyncErrors.value = teamSyncErrors.value.filter(id => id !== intent.id)
        if (!next.pending.length) {
          if (teamRetryTimer) clearTimeout(teamRetryTimer)
          teamRetryTimer = undefined
          teamRetryAttempt = 0
        }
        changed()
      } catch (failure) {
        if (teamCacheScope() !== key || scope() !== owner) return
        // Conflict / ACL remain pending and actionable. Never silently
        // discard the local draft or imply the server accepted an invite.
        teamSyncErrors.value = [...new Set([...teamSyncErrors.value, intent.id])]
        retryTeamOnTransientFailure(key, failure)
      }
    }
  } finally { /* The in-flight promise owns the cross-caller barrier. */ }
  })()
  const promise = job.finally(() => {
    if (sendingTeams?.promise === promise) sendingTeams = undefined
  })
  sendingTeams = { scope: key, promise }
  return promise
}
function scheduleTeamFlush() {
  void flushPendingTeams().catch(() => {
    // The durable local intent remains available for the next retry.
    teamSyncErrors.value = [...new Set([...teamSyncErrors.value, ...pendingTeamIds.value])]
  })
}
const changed = () => {
  window.dispatchEvent(new Event('photobunker-studio'))
  channel?.postMessage('changed')
}
let channel: BroadcastChannel | undefined
let loadingStudio: { owner: string; promise: Promise<void> } | undefined
export async function loadStudio(): Promise<void> {
  const owner = scope()
  if (account.value) await restoreTeamsFromDevice(owner).catch(() => {})
  await loadIdentity()
  if (loadingStudio?.owner === owner) return loadingStudio.promise
  const promise = loadStudioData()
  loadingStudio = { owner, promise }
  void promise.finally(() => {
    if (loadingStudio?.promise === promise) loadingStudio = undefined
  })
  return promise
}
async function loadStudioData() {
  const current = ++generation,
    owner = scope()
  try {
    if (account.value) {
      if (teamCacheScope()) await restoreTeamsFromDevice(owner).catch(() => {})
      const data = await workspace.index()
      if (current !== generation || owner !== scope()) return
      localPresets.value = data.presets
      localTasks.value = data.tasks
      const key = teamCacheScope()
      if (key) {
        try {
          const next = await mutateTeamCache(key, local => {
            const pending = local.pending.filter(item => {
              const remote = data.teams.find(team => team.id === item.id)
              return !remote || !sameTeam(remote, item)
            })
            return { ...local, snapshot: data.teams, pending, tasks: data.tasks.map(task => ({
              id: task.id, name: task.name, teamId: task.teamId, completed: task.completed,
            })) }
          })
          if (current !== generation || owner !== scope()) return
          projectTeams(next)
          scheduleTeamFlush()
        } catch {
          // Never replace a newer live optimistic list with a stale response.
          teams.value = data.teams
        }
      } else teams.value = data.teams
      personalCategories.value = data.categories.names
      categoryRevision = data.categories.revision
      invitations.value = data.invitations
      taskGrants.value = data.tasks
      studioError.value = false
      void cleanupVersions(owner).catch(() => {})
      return
    }
    const [p, a, t] = await Promise.all([
      repository.list<Preset>(owner, 'presets'),
      repository.list<Task>(owner, 'tasks'),
      repository.list<Team>(owner, 'teams'),
    ])
    if (current !== generation) return
    const documents = await repository.list<{
      id: string
      revision: number
      names: string[]
    }>(owner, 'categories')
    if (current !== generation) return
    const document = documents[0]
    categoryRevision = document?.revision ?? 0
    personalCategories.value = document?.names ?? [
      ...new Set(
        [...p, ...profiles.value]
          .flatMap((preset) => preset.rules.categories)
          .concat(
            !studioSession.value?.taskId
              ? (studioSession.value?.rules.categories ?? [])
              : [],
          ),
      ),
    ]
    if (!document && personalCategories.value.length) {
      const saved = await repository
        .save(
          owner,
          'categories',
          { id: 'personal', revision: 0, names: [...personalCategories.value] },
          0,
        )
        .catch(() => undefined)
      if (saved && current === generation) categoryRevision = saved.revision
    }
    if (current !== generation) return
    localPresets.value = p
    localTasks.value = a.sort((a, b) => b.createdAt - a.createdAt)
    teams.value = t
    studioError.value = false
    void cleanupVersions(owner).catch(() => {})
  } catch {
    if (current === generation) studioError.value = true
  } finally {
    if (current === generation) studioReady.value = true
  }
}
export const presetChoices = computed(() =>
  account.value
    ? localPresets.value.filter((item) => !item.hidden)
    : [
        ...localPresets.value.filter((item) => !item.hidden),
        ...profiles.value.filter(
          (item) => !localPresets.value.some((local) => local.id === item.id),
        ),
      ],
)
export async function savePreset(value: Preset): Promise<Preset> {
  if (validatePreset(value)) throw new Error('workspace.invalid_preset')
  const item = clone(value)
  item.name = item.name.trim()
  item.version++
  item.rules.resolution = item.options.size === 'custom' ? 'fixed' : 'maximum'
  item.rules.keepDate = item.options.date && item.options.time
  const owner = scope()
  const saved = account.value
    ? await workspace.save('preset', item)
    : await repository.save(owner, 'presets', item, value.revision)
  if (owner === scope()) {
    generation++
    localPresets.value = [
      ...localPresets.value.filter((item) => item.id !== saved.id),
      saved,
    ]
  }
  changed()
  return saved
}
export async function saveTask(value: Task): Promise<Task> {
  if (validateTask(value)) throw new Error('workspace.invalid_task')
  // The Workspace API requires the Team to exist before an Assignment can
  // reference it. Keep the draft intact if its local Team is still pending.
  if (account.value && value.teamId && pendingTeamIds.value.includes(value.teamId)) {
    await flushPendingTeams()
    // A flush already in flight may have captured the queue before this Team
    // was committed locally. Give the new intent one delivery pass too.
    if (pendingTeamIds.value.includes(value.teamId)) await flushPendingTeams()
    if (pendingTeamIds.value.includes(value.teamId))
      throw new Error('workspace.team_pending')
  }
  const owner = scope(),
    saved = account.value
      ? await workspace.save('task', value)
      : await repository.save(
          owner,
          'tasks',
          { ...clone(value), name: value.name.trim() },
          value.revision,
        )
  if (owner === scope()) {
    generation++
    localTasks.value = [
      saved,
      ...localTasks.value.filter((item) => item.id !== saved.id),
    ]
  }
  changed()
  return saved
}
export async function saveTeam(value: Team): Promise<Team> {
  if (!value.name.trim() || value.name.length > 80 ||
      (value.description || '').length > 1000 ||
      !validateParticipants(value.participants))
    throw new Error('workspace.invalid_team')
  const owner = scope()
  const item = { ...clone(value), name: value.name.trim(),
    description: (value.description || '').trim(),
    ...((account.value && value.revision === 0) ? {
      accountId: account.value.id, ownerPublicId: account.value.publicId,
      role: 'owner' as const, canManage: true,
    } : {}) }
  if (account.value) {
    if (value.revision > 0 && value.canManage !== true)
      throw new Error('workspace.access_denied')
    const key = teamCacheScope()
    if (!key) throw new Error('workspace.locked')
    const stored = await mutateTeamCache(key, data => ({
      ...data,
      pending: [...data.pending.filter(row => row.id !== item.id), item],
    }))
    if (key !== teamCacheScope() || owner !== scope())
      throw new Error('workspace.cancelled')
    projectTeams(stored)
    changed()
    // Local durable commit is the UI acknowledgment. Network delivery is
    // independent and can be slow/offline without holding the editor open.
    const priorFlush = sendingTeams?.scope === key ? sendingTeams.promise : undefined
    scheduleTeamFlush()
    if (priorFlush) void priorFlush.then(() => {
      if (key === teamCacheScope() && pendingTeamIds.value.includes(item.id))
        scheduleTeamFlush()
    }).catch(() => {})
    return item
  }
  const saved = await repository.save(owner, 'teams', item, value.revision)
  if (owner === scope()) {
    generation++
    teams.value = [...teams.value.filter(team => team.id !== saved.id), saved]
  }
  changed()
  return saved
}
export async function removeItem(
  collection: 'presets' | 'tasks' | 'teams',
  item: Preset | Task | Team,
) {
  if (account.value)
    await workspace.remove(
      collection === 'tasks'
        ? 'task'
        : collection === 'teams'
          ? 'team'
          : 'preset',
      item,
    )
  else await repository.remove(scope(), collection, item)
  await loadStudio()
  changed()
}
export async function savePersonalCategories(names: string[]) {
  const owner = scope(),
    clean = [...new Set(names.map((name) => name.trim()).filter(Boolean))]
  if (clean.length > 100 || clean.some((name) => name.length > 80))
    throw new Error('categories.invalid')
  const saved = account.value
    ? await workspace.request<{ names: string[]; revision: number }>(
        '/categories',
        'PUT',
        { revision: categoryRevision, names: clean },
      )
    : await repository.save(
        owner,
        'categories',
        { id: 'personal', revision: categoryRevision, names: clean },
        categoryRevision,
      )
  if (owner === scope()) {
    personalCategories.value = saved.names
    categoryRevision = saved.revision
  }
  changed()
}
export function choosePreset(preset: Preset | null) {
  studioSession.value = sessionFor(undefined, preset)
  studioSession.value.category = selectedCategory.value
  persistSession()
}
export function startTask(task: Task) {
  studioSession.value = sessionFor(task)
  studioSession.value.category =
    !task.rules.particularCategory ||
    task.rules.categories.includes(selectedCategory.value)
      ? selectedCategory.value
      : ''
  persistSession()
}
export function clearStudioSession() {
  studioSession.value = null
  persistSession()
}
export function updateSessionCategory(category: string) {
  selectedCategory.value = category
  try {
    localStorage.setItem(`photobunker-category:${scope()}`, category)
  } catch {}
  if (studioSession.value) {
    studioSession.value.category = category
    persistSession()
  }
}
function persistSession() {
  try {
    localStorage.setItem(
      `photobunker-ui-session:${scope()}`,
      JSON.stringify(studioSession.value),
    )
  } catch {
    /* Capture works; context may need selecting after reload. */
  }
}
function readSession() {
  studioSession.value = null
  try {
    selectedCategory.value =
      localStorage.getItem(`photobunker-category:${scope()}`) ?? ''
  } catch {}
  try {
    const item = JSON.parse(
      localStorage.getItem(`photobunker-ui-session:${scope()}`) ?? 'null',
    )
    if (
      item &&
      typeof item.taskId === 'string' &&
      item.rules &&
      Array.isArray(item.shots)
    )
      studioSession.value = item
  } catch {}
}
readSession()
export function asLocalPreset(id: string): Preset | undefined {
  const item = presetChoices.value.find((item) => item.id === id)
  return item
    ? 'uiOnly' in item
      ? clone(item as Preset)
      : newPreset(item.name, item)
    : undefined
}
export function startStudio() {
  if ('BroadcastChannel' in window) {
    channel = new BroadcastChannel('photobunker-ui-workspace')
    channel.onmessage = () => {
      void loadStudio()
    }
  }
  const focus = () => {
    void loadStudio()
  }
  window.addEventListener('focus', focus)
  window.addEventListener('online', focus)
  void loadStudio()
  return () => {
    channel?.close()
    channel = undefined
    window.removeEventListener('focus', focus)
    window.removeEventListener('online', focus)
  }
}
watch(sessionState, state => {
  if (state === 'authenticated') void loadStudio()
})
watch(teamCacheScope, key => {
  if (key) void loadStudio()
})
watch(accessLibraryId, () => {
  generation++
  localPresets.value = []
  localTasks.value = []
  teams.value = []
  studioReady.value = false
  readSession()
  void loadStudio()
})

watch(profiles, () => {
  if (!categoryRevision) void loadStudio()
})

watch(
  () => account.value?.id,
  () => {
    if (teamRetryTimer) clearTimeout(teamRetryTimer)
    teamRetryTimer = undefined
    teamRetryAttempt = 0
    generation++
    localPresets.value = []
    localTasks.value = []
    teams.value = []
    cachedTeamTasks.value = []
    pendingTeamIds.value = []
    teamSyncErrors.value = []
    personalCategories.value = []
    invitations.value = []
    taskGrants.value = []
    categoryRevision = 0
    studioReady.value = false
    readSession()
    void loadStudio()
  },
)
