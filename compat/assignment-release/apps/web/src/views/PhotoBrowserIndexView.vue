<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ScreenHeader from '../components/ScreenHeader.vue'
import AppIcon from '../components/AppIcon.vue'
import AppSheet from '../components/AppSheet.vue'
import PhotoThumbnail from '../components/PhotoThumbnail.vue'
import { account, deviceId, hasConfirmedIdentity } from '../identity/store'
import { appLockReady, appLocked } from '../app/lock'
import { protectionReady, protectionEnabled, photoReadAllowed } from '../crypto/store'
import { photos, libraryError, libraryLoading, refreshLibrary, libraryChanged } from '../local/library'
import { localTasks, loadStudio } from '../studio/store'
import { readOrganizer, saveBrowser, saveOrganizer, type BrowserFolder } from '../photo-browser/cache'
import { deletePhoto as deleteStoredPhoto } from '../server/photos'
import { bt } from '../photo-browser/text'
import { formatDate, formatNumber } from '../i18n'
import { s } from '../studio/text'

type Display = 'grid' | 'list' | 'tree'
type FolderRow = {
  id: string
  name: string
  count: number
  assignment?: string
  photos: typeof photos.value
}

const router = useRouter()
const route = useRoute()
const query = ref('')
const searchOpen = ref(false)
const settingsOpen = ref(false)
const shareOpen = ref(false)
const display = ref<Display>('list')
const tag = ref('')
const shareSelected = ref<string[]>([])
const photoSelected = ref<string[]>([])
const folderSelected = ref<string[]>([])
const selectMode = ref(false)
const folders = ref<BrowserFolder[]>([])
const organizerOpen = ref(false)
const moveOpen = ref(false)
const folderName = ref('')
const working = ref(false)
const operationError = ref('')

try {
  const saved = localStorage.getItem('photobunker.browser.view')
  if (saved === 'grid' || saved === 'list' || saved === 'tree') display.value = saved
} catch { /* Device preferences are optional. */ }

const assignmentNode = (id: string) => `assignment:${id}`
const assignmentFromNode = (id: string) => id.startsWith('assignment:') ? id.slice(11) : ''
const legacyAssignmentId = computed(() => typeof route.query.assignment === 'string'
  ? route.query.assignment : '')
const currentNodeId = computed(() => typeof route.query.folder === 'string'
  ? route.query.folder : legacyAssignmentId.value ? assignmentNode(legacyAssignmentId.value) : '')
const currentAssignmentId = computed(() => assignmentFromNode(currentNodeId.value))
const currentFolder = computed(() => folders.value.find(folder => folder.id === currentNodeId.value))
const photoAssignment = (photo: typeof photos.value[number]) =>
  photo.workspaceAssignmentId || photo.uiAssignmentId || photo.assignmentId || ''
const assignments = computed(() => localTasks.value.filter(task =>
  task.accountId === account.value?.id || !task.accountId,
))
const assignmentMap = computed(() => new Map(assignments.value.map(task => [task.id, task])))
const currentAssignment = computed(() => assignmentMap.value.get(currentAssignmentId.value))
const tags = computed(() => [...new Set(photos.value.flatMap(photo => photo.tags ?? []))]
  .sort((a, b) => a.localeCompare(b)))
const normalizedParent = (folder: BrowserFolder) => folder.parentId || ''
const foldersForPhoto = (id: string) => folders.value.filter(folder => folder.photoIds.includes(id))
function isDescendant(folder: BrowserFolder, parentId: string) {
  const seen = new Set<string>()
  let node: BrowserFolder | undefined = folder
  while (node && !seen.has(node.id)) {
    seen.add(node.id)
    if (normalizedParent(node) === parentId) return true
    const parent = normalizedParent(node)
    node = folders.value.find(candidate => candidate.id === parent)
  }
  return false
}
const directChildren = computed(() => folders.value.filter(folder =>
  normalizedParent(folder) === currentNodeId.value,
))
const folderRows = computed<FolderRow[]>(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  const custom = directChildren.value.map(folder => ({
    id: folder.id,
    name: folder.name,
    count: folder.photoIds.length,
    photos: photos.value.filter(photo => folder.photoIds.includes(photo.id)).slice(0, 4),
  }))
  const taskRows = currentNodeId.value ? [] : assignments.value.map(task => {
    const items = photos.value.filter(photo => photoAssignment(photo) === task.id)
    return {
      id: assignmentNode(task.id),
      name: task.name,
      count: items.length,
      assignment: task.id,
      photos: items.slice(0, 4),
    }
  })
  return [...custom, ...taskRows]
    .filter(row => !needle || row.name.toLocaleLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name))
})
const visible = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  return photos.value.filter(photo => {
    const assignment = photoAssignment(photo)
    if (currentAssignmentId.value) {
      if (assignment !== currentAssignmentId.value) return false
      if (foldersForPhoto(photo.id).some(folder => isDescendant(folder, currentNodeId.value))) return false
    } else if (currentFolder.value) {
      if (!currentFolder.value.photoIds.includes(photo.id)) return false
    } else if (assignment || foldersForPhoto(photo.id).length) return false
    if (tag.value && !(photo.tags ?? []).includes(tag.value)) return false
    if (!needle) return true
    return `${photo.title} ${photo.note} ${photo.shortId ?? ''} ${(photo.tags ?? []).join(' ')}`
      .toLocaleLowerCase().includes(needle)
  }).sort((a, b) => b.createdAt - a.createdAt)
})
const breadcrumbs = computed(() => {
  const result: { id: string; name: string }[] = [{ id: '', name: bt('root') }]
  if (!currentNodeId.value) return result
  if (currentAssignment.value) {
    result.push({ id: currentNodeId.value, name: currentAssignment.value.name })
    return result
  }
  const chain: BrowserFolder[] = []
  const seen = new Set<string>()
  let folder = currentFolder.value
  while (folder && !seen.has(folder.id)) {
    seen.add(folder.id)
    chain.unshift(folder)
    const parent = normalizedParent(folder)
    if (assignmentFromNode(parent)) {
      const task = assignmentMap.value.get(assignmentFromNode(parent))
      if (task) result.push({ id: parent, name: task.name })
      break
    }
    folder = folders.value.find(candidate => candidate.id === parent)
  }
  result.push(...chain.map(item => ({ id: item.id, name: item.name })))
  return result
})
const loading = computed(() => libraryLoading.value ||
  !photos.value.length && !protectionReady.value)
const collectionReady = computed(() =>
  appLockReady.value && !appLocked.value && hasConfirmedIdentity() &&
  protectionReady.value && (!protectionEnabled.value || photoReadAllowed()) &&
  !!deviceId.value,
)
const availableForShare = computed(() => assignments.value.filter(task =>
  task.canManage || task.role === 'owner' || task.role === 'curator',
))
const moveTargets = computed(() => folders.value.map(folder => ({
  id: folder.id,
  name: folderPath(folder.id),
})).sort((a, b) => a.name.localeCompare(b.name)))

function folderPath(id: string) {
  const parts: string[] = []
  const seen = new Set<string>()
  let folder = folders.value.find(item => item.id === id)
  while (folder && !seen.has(folder.id)) {
    seen.add(folder.id)
    parts.unshift(folder.name)
    const parent = normalizedParent(folder)
    const assignment = assignmentMap.value.get(assignmentFromNode(parent))
    if (assignment) { parts.unshift(assignment.name); break }
    folder = folders.value.find(item => item.id === parent)
  }
  return parts.join(' / ')
}
function navigate(id = '') {
  selectMode.value = false
  photoSelected.value = []
  folderSelected.value = []
  operationError.value = ''
  void router.replace({ path: '/browser', query: id ? { folder: id } : {} })
}
function setDisplay(value: Display) {
  display.value = value
  try { localStorage.setItem('photobunker.browser.view', value) } catch { /* optional */ }
}
function openShare() {
  shareSelected.value = currentAssignmentId.value && availableForShare.value.some(task => task.id === currentAssignmentId.value)
    ? [currentAssignmentId.value] : []
  operationError.value = ''
  settingsOpen.value = false
  shareOpen.value = true
}
function toggleShare(id: string) {
  shareSelected.value = shareSelected.value.includes(id)
    ? shareSelected.value.filter(value => value !== id) : [...shareSelected.value, id]
}
async function createCollection() {
  if (!collectionReady.value || working.value || !shareSelected.value.length || shareSelected.value.length > 20) return
  const owner = account.value!.id
  const device = deviceId.value
  const tasks = availableForShare.value.filter(task => shareSelected.value.includes(task.id))
  if (tasks.length !== shareSelected.value.length) return
  working.value = true
  operationError.value = ''
  const id = crypto.randomUUID()
  try {
    await saveBrowser(owner, device, {
      collection: {
        id,
        assignments: tasks.map(task => ({ id: task.id, name: task.name })),
        expiresAt: Date.now() + 7 * 86400000,
        canRevoke: true,
      },
      photos: [],
      pending: { assignmentIds: tasks.map(task => task.id) },
    })
    if (account.value?.id !== owner || deviceId.value !== device) return
    shareOpen.value = false
    await router.push('/browser/' + id)
  } catch { operationError.value = bt('loadFailed') }
  finally { working.value = false }
}
function togglePhoto(id: string) {
  photoSelected.value = photoSelected.value.includes(id)
    ? photoSelected.value.filter(value => value !== id) : [...photoSelected.value, id]
}
function toggleFolder(id: string) {
  folderSelected.value = folderSelected.value.includes(id)
    ? folderSelected.value.filter(value => value !== id) : [...folderSelected.value, id]
}
function toggleSelection() {
  selectMode.value = !selectMode.value
  if (!selectMode.value) { photoSelected.value = []; folderSelected.value = [] }
}
function folderClicked(folder: FolderRow) {
  if (selectMode.value && !folder.assignment) { toggleFolder(folder.id); return }
  navigate(folder.id)
}
function openPhoto(id: string) {
  if (selectMode.value) { togglePhoto(id); return }
  const query = currentAssignmentId.value ? { assignment: currentAssignmentId.value }
    : currentFolder.value ? { folder: currentFolder.value.id } : { personal: '1' }
  void router.push({ path: `/gallery/${id}`, query })
}
async function persistFolders(next = folders.value) {
  if (!account.value || !deviceId.value) return
  await saveOrganizer(account.value.id, deviceId.value, { version: 1, folders: next })
}
async function createFolder() {
  const name = folderName.value.trim()
  if (!name || name.length > 80 || working.value) return
  working.value = true
  operationError.value = ''
  const next = [...folders.value, {
    id: crypto.randomUUID(),
    name,
    photoIds: [],
    createdAt: Date.now(),
    ...(currentNodeId.value ? { parentId: currentNodeId.value } : {}),
  }]
  try {
    await persistFolders(next)
    folders.value = next
    folderName.value = ''
    organizerOpen.value = false
  } catch { operationError.value = bt('folderFailed') }
  finally { working.value = false }
}
async function moveSelected(target: string) {
  if (!(photoSelected.value.length || folderSelected.value.length) || working.value || !canMoveTo(target)) return
  working.value = true
  operationError.value = ''
  const selectedSet = new Set(photoSelected.value)
  const next = folders.value.map(folder => ({ ...folder,
    photoIds: folder.photoIds.filter(id => !selectedSet.has(id)) }))
  const destination = next.find(folder => folder.id === target)
  if (destination) destination.photoIds = [...new Set([...destination.photoIds, ...photoSelected.value])]
  for (const folder of next)
    if (folderSelected.value.includes(folder.id))
      folder.parentId = target || undefined
  try {
    await persistFolders(next)
    folders.value = next
    moveOpen.value = false
    selectMode.value = false
    photoSelected.value = []
    folderSelected.value = []
  } catch { operationError.value = bt('folderFailed') }
  finally { working.value = false }
}
function canMoveTo(target: string) {
  if (!target) return true
  if (folderSelected.value.includes(target)) return false
  const targetFolder = folders.value.find(folder => folder.id === target)
  return !targetFolder || !folderSelected.value.some(id => isDescendant(targetFolder, id))
}
async function deleteSelected() {
  if (!(photoSelected.value.length || folderSelected.value.length) || working.value ||
      !confirm(folderSelected.value.length ? bt('deleteItemsConfirm') : bt('deleteConfirm'))) return
  working.value = true
  operationError.value = ''
  const ids = [...photoSelected.value]
  try {
    for (const id of ids) await deleteStoredPhoto(id)
    const removed = new Set(ids)
    const removedFolders = new Set(folderSelected.value)
    const liftedPhotos = folders.value.filter(folder => removedFolders.has(folder.id))
      .flatMap(folder => folder.photoIds).filter(id => !removed.has(id))
    const next = folders.value.filter(folder => !removedFolders.has(folder.id)).map(folder => ({
      ...folder,
      parentId: removedFolders.has(folder.parentId || '')
        ? currentNodeId.value || undefined : folder.parentId,
      photoIds: folder.photoIds.filter(id => !removed.has(id)),
    }))
    if (currentFolder.value && !removedFolders.has(currentFolder.value.id)) {
      const destination = next.find(folder => folder.id === currentFolder.value!.id)
      if (destination) destination.photoIds = [...new Set([...destination.photoIds, ...liftedPhotos])]
    }
    await persistFolders(next)
    folders.value = next
    libraryChanged()
    selectMode.value = false
    photoSelected.value = []
    folderSelected.value = []
  } catch { operationError.value = bt('deleteFailed') }
  finally { working.value = false }
}

watch(() => account.value?.id, () => {
  query.value = ''
  shareSelected.value = []
  photoSelected.value = []
  folderSelected.value = []
  shareOpen.value = false
  operationError.value = ''
  folders.value = []
})
let organizerEpoch = 0
async function loadOrganizer() {
  const owner = account.value?.id, device = deviceId.value, epoch = ++organizerEpoch
  if (!owner || !device) { folders.value = []; return }
  try {
    const value = await readOrganizer(owner, device)
    if (epoch === organizerEpoch && owner === account.value?.id && device === deviceId.value)
      folders.value = value.folders
  } catch { if (epoch === organizerEpoch) operationError.value = bt('folderFailed') }
}
watch([() => account.value?.id, deviceId], () => { void loadOrganizer() })
onMounted(async () => {
  await Promise.allSettled([loadStudio(), refreshLibrary()])
  await loadOrganizer()
  if (legacyAssignmentId.value)
    await router.replace({ path: '/browser', query: { folder: assignmentNode(legacyAssignmentId.value) } })
})
</script>

<template>
  <section class="native-screen browser-home">
    <ScreenHeader :title="bt('browser')" :subtitle="breadcrumbs.at(-1)?.name">
      <button class="app-icon-button" :aria-label="bt('newFolder')" @click="folderName = ''; operationError = ''; organizerOpen = true">
        <AppIcon name="plus" />
      </button>
      <button class="app-icon-button" :aria-label="bt('selectionMode')" :aria-pressed="selectMode"
        @click="toggleSelection"><AppIcon name="check" /></button>
      <button class="app-icon-button" :aria-label="bt('searchShort')" :aria-pressed="searchOpen"
        @click="searchOpen = !searchOpen; query = ''"><AppIcon name="search" /></button>
      <button class="app-icon-button" :aria-label="bt('settings')" @click="settingsOpen = true">
        <AppIcon name="settings" />
      </button>
    </ScreenHeader>

    <div class="screen-body browser-home-body">
      <div class="browser-commandbar">
        <nav class="browser-breadcrumbs" aria-label="Path">
          <template v-for="(crumb, index) in breadcrumbs" :key="crumb.id || 'root'">
            <AppIcon v-if="index" name="chevron" />
            <button type="button" :aria-current="index === breadcrumbs.length - 1 ? 'page' : undefined"
              @click="navigate(crumb.id)">{{ crumb.name }}</button>
          </template>
        </nav>
        <div class="browser-view-switch" role="group" :aria-label="bt('view')">
          <button v-for="value in ['grid', 'list', 'tree'] as const" :key="value"
            type="button" :aria-label="bt(value)" :aria-pressed="display === value" @click="setDisplay(value)">
            <AppIcon :name="value === 'grid' ? 'grid' : value === 'list' ? 'gallery' : 'folder'" />
          </button>
        </div>
      </div>
      <div v-if="selectMode" class="browser-selection-bar" role="toolbar" :aria-label="bt('selectionMode')">
        <strong>{{ bt('selected') }}: {{ photoSelected.length + folderSelected.length }}</strong>
        <button type="button" :disabled="!(photoSelected.length || folderSelected.length)" @click="operationError = ''; moveOpen = true"><AppIcon name="folder" />{{ bt('move') }}</button>
        <button type="button" class="subtle-danger" :disabled="!(photoSelected.length || folderSelected.length) || working" @click="deleteSelected"><AppIcon name="trash" />{{ bt('delete') }}</button>
        <button type="button" @click="toggleSelection">{{ bt('cancelSelection') }}</button>
      </div>
      <div v-if="searchOpen" class="browser-search-row">
        <AppIcon name="search" />
        <input v-model="query" autofocus type="search" :aria-label="bt('searchShort')"
          :placeholder="bt('searchPlaceholder')" />
        <button v-if="query" class="app-icon-button" :aria-label="bt('clear')" @click="query = ''">
          <AppIcon name="close" />
        </button>
      </div>
      <div v-if="tags.length" class="browser-tags" :aria-label="bt('tags')">
        <button :aria-pressed="!tag" @click="tag = ''">{{ bt('allTags') }}</button>
        <button v-for="value in tags" :key="value" :aria-pressed="tag === value" @click="tag = value">#{{ value }}</button>
      </div>
      <p v-if="operationError" class="form-error browser-operation-error" role="alert">{{ operationError }}</p>

      <div v-if="loading" class="browser-skeleton" aria-label="Loading" aria-busy="true">
        <span v-for="index in 8" :key="index" />
      </div>
      <div v-else-if="libraryError" class="native-empty">
        <AppIcon name="offline" /><h2>{{ bt('libraryUnavailable') }}</h2>
        <button class="secondary-button" @click="refreshLibrary">{{ bt('retry') }}</button>
      </div>
      <template v-else>
        <div v-if="folderRows.length || visible.length"
          :class="['browser-unified', `browser-unified-${display}`]">
          <button v-for="folder in folderRows" :key="`folder:${folder.id}`" type="button"
            :class="['browser-entry','browser-entry-folder',{ selected: folderSelected.includes(folder.id), selectable: selectMode && !folder.assignment }]" @click="folderClicked(folder)">
            <span v-if="selectMode && !folder.assignment" class="browser-photo-check"><AppIcon v-if="folderSelected.includes(folder.id)" name="check" /></span>
            <span class="browser-entry-preview browser-folder-cover">
              <PhotoThumbnail v-for="photo in folder.photos" :key="photo.id" :id="photo.id"
                :access-key="photo.accountId ? `${photo.remoteRevision}:${photo.thumbnailOnly}` : undefined"
                :expires-at="photo.expiresAt" alt="" />
              <span v-for="index in Math.max(0, 4 - folder.photos.length)" :key="`empty-${index}`" class="browser-folder-empty" />
              <AppIcon v-if="!folder.photos.length" name="folder" />
            </span>
            <span class="browser-entry-copy"><strong>{{ folder.name }}</strong>
              <small>{{ formatNumber(folder.count) }} {{ bt('photoCount') }}</small></span>
            <AppIcon class="browser-entry-chevron" name="chevron" />
          </button>
          <button v-for="photo in visible" :key="`photo:${photo.id}`" type="button"
            :class="['browser-entry', 'browser-entry-photo', { selected: photoSelected.includes(photo.id), selectable: selectMode }]"
            @click="openPhoto(photo.id)">
            <span v-if="selectMode" class="browser-photo-check"><AppIcon v-if="photoSelected.includes(photo.id)" name="check" /></span>
            <PhotoThumbnail class="browser-entry-preview" :id="photo.id"
              :access-key="photo.accountId ? `${photo.remoteRevision}:${photo.thumbnailOnly}` : undefined"
              :expires-at="photo.expiresAt" :alt="photo.title || photo.shortId || bt('photo')" />
            <span class="browser-entry-copy"><strong>{{ photo.title || photo.shortId || bt('photo') }}</strong>
              <small>{{ formatDate(photo.createdAt) }}</small>
              <small>{{ photo.expiresAt ? formatDate(photo.expiresAt) : '—' }}</small>
              <span class="browser-photo-tags">{{ photo.tags?.length ? photo.tags.map(value => `#${value}`).join(' ') : '' }}</span>
            </span>
          </button>
        </div>
        <div v-else class="native-empty browser-empty">
          <AppIcon name="folder" /><h2>{{ bt('emptyFolder') }}</h2>
          <p>{{ bt('emptyFolderHint') }}</p>
          <button class="secondary-button" @click="folderName = ''; organizerOpen = true"><AppIcon name="plus" />{{ bt('newFolder') }}</button>
          <RouterLink to="/camera" class="primary-button"><AppIcon name="camera" />{{ s('capture') }}</RouterLink>
        </div>
      </template>
    </div>

    <AppSheet :open="settingsOpen" :title="bt('settings')" @close="settingsOpen = false">
      <div class="native-form">
        <div><p class="section-caption">{{ bt('view') }}</p>
          <div class="browser-setting-options">
            <button v-for="value in ['grid', 'list', 'tree'] as const" :key="value"
              :aria-pressed="display === value" @click="setDisplay(value)"><AppIcon :name="value === 'grid' ? 'grid' : value === 'list' ? 'gallery' : 'folder'" />{{ bt(value) }}</button>
          </div>
        </div>
        <button class="secondary-button full-button" :disabled="!availableForShare.length" @click="openShare">
          <AppIcon name="share" />{{ bt('newCollection') }}
        </button>
      </div>
    </AppSheet>

    <AppSheet :open="organizerOpen" :title="bt('newFolder')" :busy="working" @close="organizerOpen = false; folderName = ''; operationError = ''">
      <form class="native-form" @submit.prevent="createFolder">
        <p class="field-hint">{{ bt('currentPath') }}: {{ breadcrumbs.map(item => item.name).join(' / ') }}</p>
        <label>{{ bt('folderName') }}<input v-model="folderName" maxlength="80" autofocus /></label>
        <p v-if="operationError" class="form-error" role="alert">{{ operationError }}</p>
        <button class="primary-button full-button" :disabled="working || !folderName.trim()">{{ bt('createFolder') }}</button>
      </form>
    </AppSheet>

    <AppSheet :open="moveOpen" :title="bt('moveTo')" :busy="working" @close="moveOpen = false; operationError = ''">
      <div class="action-list">
        <button type="button" @click="moveSelected('')"><AppIcon name="gallery" />{{ bt('root') }}</button>
        <button v-for="folder in moveTargets" :key="folder.id" type="button"
          :disabled="folder.id === currentFolder?.id || !canMoveTo(folder.id)" @click="moveSelected(folder.id)">
          <AppIcon name="folder" />{{ folder.name }}
        </button>
      </div>
      <p v-if="operationError" class="form-error" role="alert">{{ operationError }}</p>
    </AppSheet>

    <AppSheet :open="shareOpen" :title="bt('newCollection')" :busy="working" @close="shareOpen = false; operationError = ''">
      <form class="native-form" @submit.prevent="createCollection">
        <p class="field-hint">{{ bt('sharedWith') }}</p>
        <label v-for="task in availableForShare" :key="task.id" class="browser-share-choice">
          <input type="checkbox" :checked="shareSelected.includes(task.id)" :disabled="working" @change="toggleShare(task.id)" />
          <span>{{ task.name }}</span>
        </label>
        <p v-if="operationError" class="form-error" role="alert">{{ operationError }}</p>
        <button class="primary-button full-button" :disabled="working || !shareSelected.length || !collectionReady">
          {{ bt('openCollection') }}
        </button>
      </form>
    </AppSheet>
  </section>
</template>
