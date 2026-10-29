import { account } from '../identity/store'
import { identityRequest } from '../identity/api'
import { accessCode, accessLibraryId } from '../server/api'
import * as repository from '../studio/repository'
import {
  clone,
  newPreset,
  newTask,
  type Preset,
  type Task,
  type Team,
} from '../studio/model'
import * as local from '../local/photos'
import { isExpired } from '../delivery/clock'
import * as api from './api'
import { upload } from './photos'
import type { Profile } from '../profiles/model'
export type LegacyData = {
  teams: { id: string; name: string; libraryId: string }[]
  presets: { libraryId: string; profile: Profile }[]
  tasks: {
    id: string
    spaceId: string
    name: string
    instructions: string
    profile: Profile
    shots: string[]
    finishesAt: number | null
    completed: boolean
  }[]
  photos: { id: string; libraryId: string; expiresAt: number | null }[]
}
export async function localPreview() {
  const scope = accessLibraryId.value || 'device'
  const [presets, tasks, teams, photos, categories] = await Promise.all([
    repository.list<Preset>(scope, 'presets'),
    repository.list<Task>(scope, 'tasks'),
    repository.list<Team>(scope, 'teams'),
    local.listPhotos(),
    repository.list<{ names: string[] }>(scope, 'categories'),
  ])
  return {
    scope,
    presets,
    tasks,
    teams,
    categories: categories[0]?.names ?? [],
    photos: photos.filter(
      (photo) =>
        !photo.accountId &&
        !photo.uiVersionOf &&
        !photo.deleteRequested &&
        !photo.uploadOnly &&
        !photo.deliveryOnly &&
        !isExpired(photo) &&
        (!photo.remoteLibraryId ||
          photo.remoteLibraryId === accessLibraryId.value),
    ),
  }
}
export async function legacyPreview(prove = false) {
  if (prove) {
    if (!accessCode.value) throw new Error('workspace.no_library')
    await identityRequest('/legacy-proof', 'POST', {
      libraryCode: accessCode.value,
    })
  }
  return api.request<LegacyData>('/legacy')
}
export async function importData(
  source: Awaited<ReturnType<typeof localPreview>>,
  legacy: LegacyData | undefined,
  includePhotos: boolean,
) {
  const owner = account.value?.id
  if (!owner) throw new Error('workspace.no_account')
  const current = () => {
    if (owner !== account.value?.id) throw new Error('workspace.cancelled')
  }
  const teams = new Map<string, Team>(),
    tasks = new Map<string, Task>()
  async function record<T extends Task | Team | Preset>(
    kind: string,
    sourceKey: string,
    value: T,
  ) {
    current()
    return api.request<T>(
      '/import-record',
      'POST',
      { kind, source: sourceKey, value },
      owner,
    )
  }
  for (const preset of source.presets)
    await record('preset', `local:${source.scope}:${preset.id}`, preset)
  for (const team of source.teams)
    teams.set(
      team.id,
      await record('team', `local:${source.scope}:${team.id}`, team),
    )
  for (const task of source.tasks)
    tasks.set(
      task.id,
      await record('task', `local:${source.scope}:${task.id}`, {
        ...clone(task),
        teamId: teams.get(task.teamId)?.id ?? '',
      }),
    )
  if (legacy) {
    for (const preset of legacy.presets) {
      const value = newPreset(preset.profile.name, preset.profile)
      await record(
        'preset',
        `legacy:${preset.libraryId}:${preset.profile.id}`,
        value,
      )
    }
    for (const team of legacy.teams)
      teams.set(
        team.id,
        await record('team', `legacy:${team.libraryId}:${team.id}`, {
          id: team.id,
          name: team.name,
          participants: [],
          revision: 0,
        }),
      )
    for (const task of legacy.tasks) {
      const value = {
        ...newTask(task.name),
        instructions: task.instructions,
        finishesAt: task.finishesAt,
        shots: task.shots,
        targetCount: Math.max(1, task.shots.length),
        completed: task.completed,
        presetId: task.profile.id,
        preset: newPreset(task.profile.name, task.profile),
        teamId: teams.get(task.spaceId)?.id ?? '',
      }
      tasks.set(task.id, await record('task', `legacy-task:${task.id}`, value))
    }
  }
  if (source.categories.length) {
    current()
    const data = await api.index()
    await api.request(
      '/categories',
      'PUT',
      {
        revision: data.categories.revision,
        names: [...new Set([...data.categories.names, ...source.categories])],
      },
      owner,
    )
  }
  if (includePhotos) {
    for (const photo of source.photos.map(clone)) {
      current()
      const mapped = await api.request<{ id: string; committed: boolean }>(
        '/import-photo-id',
        'POST',
        { source: `local:${source.scope}:${photo.id}` },
        owner,
      )
      if (mapped.committed) continue
      const exists = await local.readMetadata(mapped.id)
      if (!exists) {
        const data = await local.readPhoto(photo.id, true),
          thumbnail = await local.readThumbnail(photo.id, true)
        current()
        const task = tasks.get(photo.uiAssignmentId || '')
        const expiresAt = Math.min(
          photo.expiresAt ?? Infinity,
          Date.now() + 1209600000,
        )
        await local.savePhoto(
          {
            blob: data.blob,
            thumbnail,
            width: photo.width,
            height: photo.height,
            method: photo.method,
          },
          {
            id: mapped.id,
            accountId: owner,
            workspaceAssignmentId: task?.id,
            uiAssignmentId: task?.id,
            uiTaskRevision: task?.revision,
            uiOnly: true,
            libraryId: '',
            createdAt: photo.createdAt,
            profile: photo.profile,
            metadata: photo.metadata ?? {},
            category: photo.category ?? '',
            shot: photo.shot ?? '',
            retention: {
              retentionAnchor: undefined,
              retentionSeconds: Math.max(
                3600,
                Math.min(1209600, photo.retentionSeconds || 1209600),
              ),
              expiresAt,
            },
            captureContext: photo.captureContext ?? {
              presetName: photo.profile?.name || 'Standard',
              standard: !photo.profile,
              author: { kind: 'device' },
            },
          },
        )
        await local.patchPhoto(mapped.id, {
          title: photo.title,
          note: photo.note,
          tags: photo.tags,
          favorite: photo.favorite,
        })
      }
      await upload(mapped.id)
    }
    if (legacy)
      for (const photo of legacy.photos) {
        current()
        await api.request(
          `/legacy/photos/${photo.id}/import`,
          'POST',
          { libraryId: photo.libraryId },
          owner,
        )
      }
  }
  current()
}
