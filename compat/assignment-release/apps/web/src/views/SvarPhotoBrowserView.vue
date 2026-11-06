<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Filemanager, Willow, WillowDark, type IApi, type TMode } from '@svar-ui/vue-filemanager'
import '@svar-ui/vue-filemanager/all.css'
import { Locale } from '@svar-ui/vue-core'
import '../styles/svar-icons.css'
import ScreenHeader from '../components/ScreenHeader.vue'
import AppIcon from '../components/AppIcon.vue'
import AppSheet from '../components/AppSheet.vue'
import PhotoThumbnail from '../components/PhotoThumbnail.vue'
import { account, deviceId, hasConfirmedIdentity } from '../identity/store'
import { appLockReady, appLocked } from '../app/lock'
import { protectionEnabled, protectionReady, photoReadAllowed } from '../crypto/store'
import { photos, libraryError, libraryLoading, refreshLibrary, libraryChanged } from '../local/library'
import { localTasks, loadStudio } from '../studio/store'
import { theme } from '../app/preferences'
import { readOrganizer, saveOrganizer, saveBrowser, type BrowserFolder } from '../photo-browser/cache'
import { buildSvarProjection, type BrowserEntry, type BrowserScope } from '../photo-browser/svar-projection'
import { deletePhoto as deleteStoredPhoto, readThumbnail } from '../server/photos'
import { bt } from '../photo-browser/text'
import { locale } from '../i18n'
import { svarRussianWords } from '../photo-browser/svar-locale'
import { photoCardPath } from '../studio/private-photo-card'
import '../styles/svar-browser.css'

const route = useRoute(), router = useRouter()
const folders = ref<BrowserFolder[]>([])
const organizerLoading = ref(true)
const working = ref(false), error = ref('')
const selectedPath = ref('')
const editOpen = ref(false), editMode = ref<'create' | 'rename'>('create')
const folderName = ref('')
const moveOpen = ref(false)
const shareOpen = ref(false), shareSelected = ref<string[]>([])
let api: IApi | undefined
let organizerEpoch = 0

const tasks = computed(() => localTasks.value.filter(task =>
  !!account.value && (!task.accountId || task.accountId === account.value.id)))
const taskById = computed(() => new Map(tasks.value.map(task => [task.id, task])))
const projection = computed(() => buildSvarProjection(
  account.value?.id ?? '', tasks.value, folders.value, photos.value,
  { personal: bt('mine'), assignments: bt('assignments'), photo: bt('photo') },
))
const accountReady = computed(() => !!account.value && !!deviceId.value &&
  appLockReady.value && !appLocked.value && hasConfirmedIdentity())
const canRead = computed(() => accountReady.value && protectionReady.value &&
  (!protectionEnabled.value || photoReadAllowed()))
const isDark = computed(() => theme.value === 'dark' ||
  (theme.value === 'system' && !globalThis.matchMedia?.('(prefers-color-scheme: light)').matches))

// The URL stores immutable application ids, never SVAR's mutable display path.
const activePath = computed(() => {
  const value = typeof route.query.folder === 'string' ? route.query.folder :
    typeof route.query.assignment === 'string' ? 'assignment:' + route.query.assignment : ''
  if (value === 'personal') return projection.value.paths.get('personal:personal') ?? '/'
  if (value === 'assignments') return projection.value.paths.get('assignments:assignments') ?? '/'
  if (value.startsWith('assignment:'))
    return projection.value.paths.get('assignment:' + value.slice('assignment:'.length)) ?? '/'
  if (value) return projection.value.paths.get('folder:' + value) ?? '/'
  return '/'
})
const current = computed(() => projection.value.byPath.get(activePath.value))
const selected = computed(() => projection.value.byPath.get(selectedPath.value))
const selectedPhoto = computed(() => selected.value?.kind === 'photo'
  ? photos.value.find(item => item.id === selected.value!.id) : undefined)
const canOpenPhoto = computed(() => selected.value?.kind === 'photo' &&
  selected.value.readable && canRead.value)
const canDeletePhoto = computed(() => canOpenPhoto.value &&
  (selectedPhoto.value?.workspaceAccess?.delete ?? true))
const mayCreate = computed(() => canRead.value && current.value !== undefined &&
  current.value.kind !== 'assignments')
const canShare = computed(() => canRead.value && tasks.value.some(task =>
  task.canManage || task.role === 'owner' || task.role === 'curator'))
const mode = ref<TMode>('table')
const thumbnails = ref(new Map<string, string>())
let previewEpoch = 0
function clearThumbnails() {
  previewEpoch++
  for (const url of thumbnails.value.values()) URL.revokeObjectURL(url)
  thumbnails.value = new Map()
}
function previewFor(item: { id?: string }): string | null {
  return item.id ? thumbnails.value.get(item.id) ?? null : null
}
async function refreshThumbnails() {
  clearThumbnails()
  if (!canRead.value) return
  const generation = previewEpoch, owner = account.value?.id
  const targets = [...projection.value.byPath.entries()].filter(([path, item]) =>
    item.kind === 'photo' && projection.value.parent.get(path) === activePath.value).slice(0, 32)
  const photoMap = new Map(photos.value.map(photo => [photo.id, photo]))
  let next = 0
  async function worker() {
    while (next < targets.length) {
      const [path, item] = targets[next++]!
      if (item.kind !== 'photo' || generation !== previewEpoch) break
      const photo = photoMap.get(item.id)
      if (!photo) continue
      try {
        const blob = await readThumbnail(item.id,
          `${photo.remoteRevision}:${photo.thumbnailOnly}`, photo.expiresAt)
        if (generation !== previewEpoch || account.value?.id !== owner) break
        const url = URL.createObjectURL(blob)
        thumbnails.value = new Map(thumbnails.value).set(path, url)
      } catch { /* Missing thumbnail does not expose another photo or block navigation. */ }
    }
  }
  await Promise.allSettled(Array.from({ length: Math.min(3, targets.length) }, () => worker()))
}
watch([projection, activePath, canRead], () => { void refreshThumbnails() }, { immediate: true })
onBeforeUnmount(clearThumbnails)

function routeForPath(path: string) {
  const entry = projection.value.byPath.get(path)
  const folder = !entry ? '' : entry.kind === 'folder' ? entry.id :
    entry.kind === 'assignment' ? 'assignment:' + entry.id :
    entry.kind === 'personal' ? 'personal' :
    entry.kind === 'assignments' ? 'assignments' : ''
  const old = typeof route.query.folder === 'string' ? route.query.folder : ''
  if (folder !== old || route.query.assignment)
    void router.replace({ path: '/browser', query: folder ? { folder } : {} })
}
function openPhoto(entry: BrowserEntry | undefined) {
  if (!canRead.value || entry?.kind !== 'photo' || !entry.readable) return
  const query = entry.scope === 'personal' ? { personal: '1' } :
    { assignment: entry.scope.slice('assignment:'.length) }
  void router.push({ path: '/gallery/' + encodeURIComponent(entry.id), query })
}
function initManager(manager: IApi) {
  api = manager
  manager.on('set-mode', event => { mode.value = event.mode })
  manager.on('set-path', ({ id }) => {
    selectedPath.value = ''
    if (id) routeForPath(id)
  })
  manager.on('select-file', ({ id }) => { selectedPath.value = id ?? '' })
  manager.on('open-file', ({ id }) => { openPhoto(projection.value.byPath.get(id ?? '')) })
  // SVAR's built-in operations act on its mutable paths, not on PhotoBunker's
  // immutable ids, ACL and encrypted outbox. Disable them entirely. The buttons
  // outside SVAR use the scoped, durable application adapter below.
  for (const action of ['create-file','rename-file','delete-files','move-files',
    'copy-files','download-file','upload-file'])
    manager.intercept(action, () => false)
}
watch(activePath, async path => {
  selectedPath.value = ''
  await nextTick()
  if (api && canRead.value) api.exec('set-path', { id: path })
})
watch(canRead, async ready => {
  if (ready) {
    await nextTick()
    if (api) api.exec('set-path', { id: activePath.value })
  } else {
    selectedPath.value = ''
    api = undefined
  }
})

function parentFor(entry: BrowserEntry | undefined): string | undefined {
  if (!entry || entry.kind === 'personal') return undefined
  if (entry.kind === 'assignment') return 'assignment:' + entry.id
  if (entry.kind === 'folder') return entry.id
  return undefined
}
function parentScope(entry: BrowserEntry | undefined): BrowserScope | undefined {
  if (entry?.kind === 'personal') return 'personal'
  if (entry?.kind === 'assignment' || entry?.kind === 'folder') return entry.scope
  return undefined
}
function validFolderName(value: string): boolean {
  return value.length > 0 && value.length <= 80 && !/[\\/\x00-\x1f\x7f]/.test(value) &&
    value !== '.' && value !== '..'
}
function nameTaken(name: string, parentId: string | undefined, excluding?: string) {
  return folders.value.some(folder => folder.id !== excluding &&
    (folder.parentId || '') === (parentId || '') &&
    folder.name.toLocaleLowerCase() === name.toLocaleLowerCase())
}
async function persist(next: BrowserFolder[]): Promise<boolean> {
  const owner = account.value?.id, device = deviceId.value
  if (!owner || !device || !canRead.value || working.value) return false
  working.value = true
  error.value = ''
  try {
    await saveOrganizer(owner, device, { version: 1, folders: next })
    if (owner !== account.value?.id || device !== deviceId.value) return false
    folders.value = next
    return true
  } catch {
    error.value = bt('folderFailed')
    return false
  } finally {
    working.value = false
  }
}
function startCreate() {
  if (!mayCreate.value) return
  editMode.value = 'create'
  folderName.value = ''
  error.value = ''
  editOpen.value = true
}
function startRename() {
  const entry = selected.value
  if (!canRead.value || entry?.kind !== 'folder') return
  folderName.value = folders.value.find(row => row.id === entry.id)?.name ?? ''
  editMode.value = 'rename'
  error.value = ''
  editOpen.value = true
}
async function saveFolder() {
  const name = folderName.value.trim()
  const entry = editMode.value === 'create' ? current.value : selected.value
  if (!validFolderName(name) || !entry || !canRead.value) {
    error.value = bt('folderFailed')
    return
  }
  let next: BrowserFolder[]
  if (editMode.value === 'create') {
    const parentId = parentFor(entry)
    if (!parentScope(entry) || nameTaken(name, parentId) || folders.value.length >= 200) {
      error.value = bt('folderFailed'); return
    }
    next = [...folders.value, {
      id: crypto.randomUUID(), name, photoIds: [], createdAt: Date.now(),
      ...(parentId ? { parentId } : {}),
    }]
  } else {
    if (entry.kind !== 'folder') return
    const old = folders.value.find(row => row.id === entry.id)
    if (!old || nameTaken(name, old.parentId, old.id)) { error.value = bt('folderFailed'); return }
    next = folders.value.map(row => row.id === old.id ? { ...row, name } : row)
  }
  if (await persist(next)) {
    editOpen.value = false
    folderName.value = ''
  }
}
function containsFolder(source: string, destination: string): boolean {
  const seen = new Set<string>()
  let id: string | undefined = destination
  while (id && !seen.has(id)) {
    if (id === source) return true
    seen.add(id)
    const parentId: string | undefined = folders.value.find(folder => folder.id === id)?.parentId
    id = parentId?.startsWith('assignment:') ? undefined : parentId
  }
  return false
}
const moveTargets = computed(() => {
  const entry = selected.value
  if (!entry || !['folder','photo'].includes(entry.kind)) return []
  return [...projection.value.byPath.entries()].filter(([path, candidate]) =>
    path !== selectedPath.value && candidate.scope === entry.scope &&
    (candidate.kind === 'personal' || candidate.kind === 'assignment' ||
      candidate.kind === 'folder') &&
    !(entry.kind === 'folder' && candidate.kind === 'folder' &&
      containsFolder(entry.id, candidate.id)))
})
async function moveSelection(targetPath: string) {
  const entry = selected.value, target = projection.value.byPath.get(targetPath)
  if (!entry || !target || !canRead.value || entry.scope !== target.scope ||
      !['folder','photo'].includes(entry.kind) || !moveTargets.value.some(([p]) => p === targetPath))
    return
  const parentId = parentFor(target)
  let next: BrowserFolder[]
  if (entry.kind === 'folder') {
    if (target.kind === 'folder' && containsFolder(entry.id, target.id)) return
    const folder = folders.value.find(row => row.id === entry.id)
    if (!folder || nameTaken(folder.name, parentId, folder.id)) {
      error.value = bt('folderFailed'); return
    }
    next = folders.value.map(row => row.id === entry.id
      ? { ...row, parentId } : row)
  } else {
    const id = entry.id
    next = folders.value.map(row => ({
      ...row, photoIds: row.photoIds.filter(photoId => photoId !== id),
    }))
    if (target.kind === 'folder')
      next = next.map(row => row.id === target.id
        ? { ...row, photoIds: [...row.photoIds, id] } : row)
  }
  if (await persist(next)) {
    moveOpen.value = false
    selectedPath.value = ''
  }
}
async function deleteSelection() {
  const entry = selected.value
  const owner = account.value?.id, device = deviceId.value
  if (!entry || !canRead.value || working.value) return
  if (entry.kind === 'folder') {
    const folder = folders.value.find(row => row.id === entry.id)
    if (!folder || folder.photoIds.length || folders.value.some(row => row.parentId === entry.id)) {
      error.value = bt('folderFailed'); return
    }
    if (!window.confirm(bt('deleteEmptyFolder'))) return
    if (await persist(folders.value.filter(row => row.id !== entry.id))) selectedPath.value = ''
  } else if (entry.kind === 'photo' && canDeletePhoto.value) {
    if (!window.confirm(bt('deleteConfirm'))) return
    working.value = true
    error.value = ''
    try {
      await deleteStoredPhoto(entry.id)
      if (owner && device && account.value?.id === owner && deviceId.value === device) {
        const next = folders.value.map(folder =>
          ({ ...folder, photoIds: folder.photoIds.filter(id => id !== entry.id) }))
        await saveOrganizer(owner, device, { version: 1, folders: next })
        if (account.value?.id === owner && deviceId.value === device) folders.value = next
      }
      libraryChanged()
      selectedPath.value = ''
    } catch { error.value = bt('deleteFailed') }
    finally { working.value = false }
  }
}
async function createCollection() {
  if (!canShare.value || working.value || !shareSelected.value.length) return
  const allowed = tasks.value.filter(task =>
    shareSelected.value.includes(task.id) &&
    (task.canManage || task.role === 'owner' || task.role === 'curator'))
  if (allowed.length !== shareSelected.value.length || allowed.length > 20) return
  const owner = account.value!.id, device = deviceId.value, id = crypto.randomUUID()
  working.value = true
  error.value = ''
  try {
    await saveBrowser(owner, device, {
      collection: { id, assignments: allowed.map(t => ({ id: t.id, name: t.name })),
        expiresAt: Date.now() + 7 * 86400000, canRevoke: true },
      photos: [], pending: { assignmentIds: allowed.map(t => t.id) },
    })
    if (owner === account.value?.id && device === deviceId.value)
      await router.push('/browser/' + id)
  } catch { error.value = bt('loadFailed') }
  finally { working.value = false }
}
let didLoad = false
async function loadOrganizer() {
  const owner = account.value?.id, device = deviceId.value, generation = ++organizerEpoch
  folders.value = []
  organizerLoading.value = true
  if (!owner || !device || !accountReady.value) return
  try {
    const saved = await readOrganizer(owner, device)
    if (generation === organizerEpoch && account.value?.id === owner && deviceId.value === device)
      folders.value = saved.folders
  } catch { if (generation === organizerEpoch) error.value = bt('folderFailed') }
  finally { if (generation === organizerEpoch) organizerLoading.value = false }
}
watch([() => account.value?.id, deviceId, accountReady], () => {
  selectedPath.value = ''
  shareSelected.value = []
  editOpen.value = false
  moveOpen.value = false
  shareOpen.value = false
  folderName.value = ''
  void loadOrganizer()
})
onMounted(() => {
  if (!didLoad) {
    didLoad = true
    void Promise.allSettled([loadStudio(), refreshLibrary(), loadOrganizer()])
  }
})
</script>

<template>
  <section class="native-screen svar-browser">
    <ScreenHeader :title="bt('browser')" />
    <div class="screen-body svar-browser-body">
      <div class="svar-browser-bar">
        <strong>{{ current?.kind === 'folder'
          ? folders.find(item => item.id === current?.id)?.name
          : current?.kind === 'assignment' ? taskById.get(current.id)?.name
          : current?.kind === 'personal' ? bt('mine')
          : current?.kind === 'assignments' ? bt('assignments') : bt('root') }}</strong>
        <div class="svar-browser-actions">
          <button class="secondary-button" type="button" :disabled="!mayCreate || working"
            @click="startCreate"><AppIcon name="plus" />{{ bt('newFolder') }}</button>
          <button class="quiet-button" type="button" :disabled="!canShare || working"
            @click="shareSelected = []; shareOpen = true"><AppIcon name="share" />{{ bt('newCollection') }}</button>
        </div>
      </div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-if="canRead && libraryError" role="alert" class="field-hint">
        {{ bt('libraryUnavailable') }}
        <button class="secondary-button" type="button" @click="refreshLibrary">{{ bt('retry') }}</button>
      </p>
      <p v-if="!canRead" class="native-empty" role="status">{{ bt('locked') }}</p>
      <div v-else-if="organizerLoading || (libraryLoading && !photos.length)"
        class="browser-skeleton" aria-busy="true">
        <span v-for="index in 6" :key="index" />
      </div>
      <template v-else>
        <div class="svar-browser-skin">
        <Locale :key="locale" :words="locale === 'ru' ? svarRussianWords : undefined">
        <component :is="isDark ? WillowDark : Willow" :fonts="false">
          <Filemanager :key="account?.id + ':' + deviceId" :data="projection.data"
            :readonly="true" :menuOptions="() => []" :previews="previewFor" :init="initManager"
            :icons="() => ''"
            :panels="[{ path: activePath, selected: [] }]" :mode="mode" />
        </component>
        </Locale>
        </div>
        <div v-if="selected" class="svar-browser-selected" role="group" :aria-label="bt('selected')">
          <template v-if="selected.kind === 'photo'">
            <PhotoThumbnail v-if="canOpenPhoto" :id="selected.id"
              :access-key="selectedPhoto?.accountId ? String(selectedPhoto.remoteRevision) : undefined"
              :expires-at="selectedPhoto?.expiresAt" :alt="selectedPhoto?.title || bt('photo')" />
            <strong>{{ selected.readable ? (selectedPhoto?.title || selectedPhoto?.shortId || bt('photo')) : (selectedPhoto?.shortId || bt('photo')) }}</strong>
            <button type="button" class="primary-button" :disabled="!canOpenPhoto"
              @click="openPhoto(selected)">{{ bt('openPhoto') }}</button>
            <button type="button" class="secondary-button" :disabled="!canOpenPhoto"
              @click="router.push(photoCardPath(selected.id))">{{ bt('card') }}</button>
          </template>
          <strong v-else>{{ selected.kind === 'folder'
            ? folders.find(item => item.id === selected?.id)?.name
            : selected.kind === 'assignment' ? taskById.get(selected.id)?.name : bt('currentPath') }}</strong>
          <button v-if="selected.kind === 'folder'" type="button" class="secondary-button"
            @click="startRename">{{ bt('renameFolder') }}</button>
          <button v-if="selected.kind === 'folder' || selected.kind === 'photo'" type="button"
            class="secondary-button" @click="moveOpen = true">{{ bt('move') }}</button>
          <button v-if="selected.kind === 'folder' || canDeletePhoto" type="button"
            class="quiet-button subtle-danger" :disabled="working" @click="deleteSelection">{{ bt('delete') }}</button>
        </div>
      </template>
    </div>

    <AppSheet :open="editOpen" :title="editMode === 'create' ? bt('newFolder') : bt('renameFolder')"
      :busy="working" @close="editOpen = false">
      <form class="native-form" @submit.prevent="saveFolder">
        <label>{{ bt('folderName') }}
          <input v-model="folderName" maxlength="80" autofocus required /></label>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button class="primary-button full-button" :disabled="working || !folderName.trim()">
          {{ editMode === 'create' ? bt('createFolder') : bt('renameFolder') }}</button>
      </form>
    </AppSheet>

    <AppSheet :open="moveOpen" :title="bt('moveTo')" :busy="working" @close="moveOpen = false">
      <div class="action-list">
        <button v-for="[path, target] in moveTargets" :key="path" type="button" :disabled="working"
          @click="moveSelection(path)"><AppIcon name="folder" />{{
            target.kind === 'folder' ? folders.find(item => item.id === target.id)?.name :
            target.kind === 'assignment' ? taskById.get(target.id)?.name : bt('mine')
          }}</button>
      </div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    </AppSheet>

    <AppSheet :open="shareOpen" :title="bt('newCollection')" :busy="working" @close="shareOpen = false">
      <form class="native-form" @submit.prevent="createCollection">
        <p class="field-hint">{{ bt('sharedWith') }}</p>
        <label v-for="task in tasks.filter(task => task.canManage || task.role === 'owner' || task.role === 'curator')"
          :key="task.id" class="browser-share-choice">
          <input type="checkbox" :checked="shareSelected.includes(task.id)"
            @change="shareSelected = shareSelected.includes(task.id)
              ? shareSelected.filter(id => id !== task.id) : [...shareSelected, task.id]" />
          <span>{{ task.name }}</span>
        </label>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button class="primary-button full-button"
          :disabled="working || !shareSelected.length">{{ bt('openCollection') }}</button>
      </form>
    </AppSheet>
  </section>
</template>
