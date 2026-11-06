<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ScreenHeader from '../components/ScreenHeader.vue'
import AppIcon from '../components/AppIcon.vue'
import AppSheet from '../components/AppSheet.vue'
import PhotoThumbnail from '../components/PhotoThumbnail.vue'
import { account, deviceId } from '../identity/store'
import { usePageLoad } from '../app/page-load'
import { photos, libraryError, libraryLoading, serverError, refreshLibrary } from '../local/library'
import { localTasks, loadStudio } from '../studio/store'
import { readOrganizer, saveBrowser, type BrowserOrganizer } from '../photo-browser/cache'
import { buildExplorer, ancestors, descendants, explorerRows, writable, canMove, folderKey,
  isSection, type BrowserSection, type BrowserSort, type ExplorerEntry, type OrganizerAction } from '../photo-browser/explorer'
import { browserReadable, browserTasks, organize, editBrowserPhoto, deleteBrowserPhotos } from '../photo-browser/organizer'
import { photoCardPath } from '../studio/private-photo-card'
import { PhotoDetailsError } from '../studio/details'
import { metadataEditable } from '../collaboration/access'
import { bt } from '../photo-browser/text'
import { formatDate, formatNumber } from '../i18n'
import '../styles/photo-explorer.css'

const route = useRoute(), router = useRouter()
type Display = 'grid' | 'list' | 'tree'
const display = ref<Display>('list'), sort = ref<BrowserSort>('newest'), start = ref<BrowserSection>('all')
try {
  const saved = localStorage.getItem('photobunker.browser.view')
  if (saved === 'grid' || saved === 'list' || saved === 'tree') display.value = saved
  const order = localStorage.getItem('photobunker.browser.sort')
  if (order === 'name' || order === 'newest' || order === 'oldest') sort.value = order
  const initial = localStorage.getItem('photobunker.browser.start') ?? ''
  if (isSection(initial)) start.value = initial
} catch { /* Preferences do not block the local Browser. */ }
watch([display, sort, start], () => {
  try {
    localStorage.setItem('photobunker.browser.view', display.value)
    localStorage.setItem('photobunker.browser.sort', sort.value)
    localStorage.setItem('photobunker.browser.start', start.value)
  } catch { /* Device preferences are optional. */ }
})
const ready = computed(browserReadable)
const organizer = ref<BrowserOrganizer>({ version: 1, folders: [] })
const organizerLoading = ref(false), organizerLoaded = ref(false), organizerFailed = ref(false)
usePageLoad(organizerLoading)
const working = ref(false), error = ref('')
const query = ref(''), tag = ref(''), searchOpen = ref(false), settingsOpen = ref(false)
const selectionMode = ref(false), selected = ref(new Set<string>()), expanded = ref(new Set<string>())
const pageSize = ref(50), menuKey = ref(''), moveOpen = ref(false), deleteOpen = ref(false)
const selectionActionsOpen = ref(false), pathOpen = ref(false)
const editOpen = ref(false), editKind = ref<'create' | 'rename' | 'tags'>('create')
const editKey = ref(''), editValue = ref('')
const createLocationOpen = ref(false)
const shareOpen = ref(false), shareSelected = ref<string[]>([])
const tree = ref<HTMLElement>(), pathBar = ref<HTMLElement>()
const now = ref(Date.now())
const timer = setInterval(() => { now.value = Date.now() }, 1000)
onBeforeUnmount(() => clearInterval(timer))
const labels = computed(() => ({ all: bt('all'), personal: bt('mine'), assignments: bt('assignments'),
  archive: bt('archive'), assignment: bt('assignmentFolders'), photo: bt('photo') }))
const model = computed(() => {
  void now.value // Re-evaluate visibility when an existing TTL elapses; never extend it.
  return buildExplorer(account.value?.id ?? '', browserTasks(), organizer.value,
    ready.value ? photos.value : [], labels.value)
})
const location = computed(() => {
  const folder = typeof route.query.folder === 'string' ? route.query.folder : ''
  if (folder) return isSection(folder) ? folder : folder.startsWith('assignment:') ? folder : folderKey(folder)
  if (typeof route.query.assignment === 'string') return 'assignment:' + route.query.assignment
  const section = typeof route.query.section === 'string' ? route.query.section : 'all'
  return isSection(section) ? section : 'invalid'
})
const current = computed(() => {
  const entry = model.value.entries.get(location.value)
  return entry?.kind === 'photo' ? undefined : entry
})
const section = computed<BrowserSection | undefined>(() => {
  if (!current.value) return undefined
  if (current.value?.key === 'archive') return 'archive'
  if (current.value?.scope?.startsWith('assignment:') || location.value === 'assignments') return 'assignments'
  if (current.value?.scope === 'personal') return 'personal'
  return 'all'
})
const sections: BrowserSection[] = ['all', 'personal', 'assignments', 'archive']
const crumbs = computed(() => current.value ? ancestors(model.value, current.value.key) : [])
const showPath = computed(() => !!current.value && ['folder', 'assignment'].includes(current.value.kind))
const shortCrumbs = computed(() => crumbs.value.slice(-2))
const canOrganize = computed(() => ready.value && organizerLoaded.value && !organizerFailed.value)
const mayCreate = computed(() => canOrganize.value && writable(current.value))
const createTargets = computed(() => [...model.value.entries.values()].filter(entry =>
  entry.key === 'personal' || entry.kind === 'assignment'))
const scopedPhotos = computed(() => current.value ? descendants(model.value, current.value.key)
  .filter(entry => entry.kind === 'photo' && entry.readable) : [])
const tags = computed(() => [...new Set(scopedPhotos.value.flatMap(entry => entry.photo?.tags ?? []))]
  .sort((a, b) => a.localeCompare(b)))
const rows = computed(() => {
  if (!current.value) return []
  const children = explorerRows(model.value, current.value.key, {
    tree: display.value === 'tree', expanded: expanded.value, sort: sort.value,
    query: query.value, tag: tag.value,
  })
  // Inside a folder the tree keeps the current node as its visible root.
  if (display.value !== 'tree' || !showPath.value) return children
  const open = expanded.value.has(current.value.key) || !!query.value || !!tag.value
  return [{ entry: current.value, depth: 0, expanded: open,
    expandable: (model.value.children.get(current.value.key)?.length ?? 0) > 0 },
    ...(open ? children.map(row => ({ ...row, depth: row.depth + 1 })) : [])]
})
const shownRows = computed(() => rows.value.slice(0, pageSize.value))
const selectedEntries = computed(() => [...selected.value].map(key => model.value.entries.get(key))
  .filter((entry): entry is ExplorerEntry => !!entry && ['folder', 'photo'].includes(entry.kind)))
const selectedPhotos = computed(() => selectedEntries.value.filter(entry => entry.kind === 'photo'))
const selectedFolders = computed(() => selectedEntries.value.filter(entry => entry.kind === 'folder'))
const menuEntry = computed(() => model.value.entries.get(menuKey.value))
const editEntry = computed(() => model.value.entries.get(editKey.value))
const canDelete = computed(() => selectedEntries.value.length > 0 && selectedPhotos.value.every(entry => entry.deletable))
const canArchive = computed(() => selectedEntries.value.length > 0 &&
  selectedEntries.value.every(entry => entry.kind === 'photo' && entry.scope === 'personal'))
const restoreSelection = computed(() => selectedPhotos.value.length > 0 && selectedPhotos.value.every(entry => entry.archived))
const targets = computed(() => [...model.value.entries.values()]
  .filter(entry => canMove(model.value, selectedEntries.value.map(item => item.key), entry.key))
  .sort((a, b) => entryPath(a).localeCompare(entryPath(b))))
const availableForShare = computed(() => localTasks.value.filter(task =>
  (!task.accountId || task.accountId === account.value?.id) &&
  (task.canManage || task.role === 'owner' || task.role === 'curator')))
const editTitle = computed(() => bt(editKind.value === 'create' ? 'newFolder' : editKind.value === 'tags' ? 'editTags' : 'rename'))
const recovered = computed(() => !!current.value && ancestors(model.value, current.value.key).some(entry => entry.recovered))

function errorText(reason: unknown) {
  if (reason instanceof PhotoDetailsError) return reason.message
  const code = reason instanceof Error ? reason.message : ''
  const key = {
    'browser.location': 'locationUnavailable', 'browser.scope': 'scopeConflict',
    'browser.duplicate': 'duplicateName', 'browser.name': 'invalidName',
    'browser.limit': 'folderLimit', 'browser.locked': 'locked',
    'browser.account_changed': 'locked', 'browser.denied': 'denied',
  }[code] as Parameters<typeof bt>[0] | undefined
  return bt(key ?? 'folderFailed')
}
function entryPath(entry: ExplorerEntry) { return ancestors(model.value, entry.key).map(item => item.name).join(' / ') }
function selectable(entry: ExplorerEntry) {
  return entry.key !== location.value && (entry.kind === 'folder' || entry.kind === 'photo')
}
function navigate(key: string) {
  const entry = model.value.entries.get(key)
  if (!entry || entry.kind === 'photo') return
  const query = entry.kind === 'folder' ? { folder: entry.id }
    : entry.kind === 'assignment' ? { assignment: entry.id } : { section: entry.key }
  return router.push({ path: '/browser', query })
}
function photoQuery(entry: ExplorerEntry) {
  return {
    ...(entry.scope?.startsWith('assignment:') ? { assignment: entry.scope.slice(11) } : { personal: '1' }),
    ...(entry.parent?.startsWith('folder:') ? { folder: model.value.entries.get(entry.parent)?.id } : {}),
  }
}
function openEntry(entry: ExplorerEntry, force = false) {
  if (display.value === 'tree' && entry.key === location.value) { toggleTree(entry.key); return }
  if (!force && selectionMode.value && selectable(entry)) { toggleSelection(entry.key); return }
  if (entry.kind !== 'photo') navigate(entry.key)
  else if (entry.readable) void router.push({ path: '/gallery/' + encodeURIComponent(entry.id), query: photoQuery(entry) })
}
function toggleSelection(key: string) {
  const entry = model.value.entries.get(key)
  if (!entry || !selectable(entry)) return
  const next = new Set(selected.value)
  if (next.has(key)) next.delete(key); else next.add(key)
  selected.value = next
}
function selectAll() {
  selectionMode.value = true
  selected.value = new Set(shownRows.value.filter(row => selectable(row.entry)).map(row => row.entry.key))
}
function toggleTree(key: string) {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key); else next.add(key)
  expanded.value = next
}
function treeKey(event: KeyboardEvent, entry: ExplorerEntry) {
  if (display.value !== 'tree') return
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    if (!expanded.value.has(entry.key)) expanded.value = new Set([...expanded.value, entry.key])
    else {
      const child = shownRows.value.find(row => row.entry.parent === entry.key)
      if (child) [...tree.value?.querySelectorAll<HTMLElement>('[data-entry-key]') ?? []]
        .find(row => row.dataset.entryKey === child.entry.key)?.querySelector<HTMLButtonElement>('.explorer-open')?.focus()
    }
  }
  else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    if (expanded.value.has(entry.key)) toggleTree(entry.key)
    else [...tree.value?.querySelectorAll<HTMLElement>('[data-entry-key]') ?? []]
      .find(row => row.dataset.entryKey === entry.parent)?.querySelector<HTMLButtonElement>('.explorer-open')?.focus()
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    const controls = [...tree.value!.querySelectorAll<HTMLButtonElement>('.explorer-open')]
    const index = controls.indexOf(event.currentTarget as HTMLButtonElement)
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1
      : index + (event.key === 'ArrowDown' ? 1 : -1)
    controls[target]?.focus()
  }
}
function cover(entry: ExplorerEntry) {
  return descendants(model.value, entry.key).filter(item => item.kind === 'photo').slice(0, 4)
}
function clearSelection() { selected.value = new Set(); selectionMode.value = false }
function startEdit(kind: 'create' | 'rename' | 'tags', entry?: ExplorerEntry) {
  if (!canOrganize.value) return
  if (kind === 'create' && !mayCreate.value) { createLocationOpen.value = true; return }
  editKind.value = kind
  editKey.value = entry?.key ?? ''
  editValue.value = kind === 'create' ? '' : kind === 'tags' ? (entry?.photo?.tags ?? []).join(', ') : entry?.name ?? ''
  menuKey.value = ''; error.value = ''; editOpen.value = true
}
async function chooseCreateLocation(key: string) {
  createLocationOpen.value = false
  await navigate(key)
  await nextTick()
  startEdit('create')
}
function closeEdit() { editOpen.value = false; editValue.value = ''; editKey.value = ''; error.value = '' }
async function mutate(action: OrganizerAction) {
  if (!canOrganize.value || working.value) return false
  working.value = true; error.value = ''
  try { organizer.value = await organize(action, labels.value); return true }
  catch (reason) { error.value = errorText(reason); return false }
  finally { working.value = false }
}
async function saveEdit() {
  if (working.value || !canOrganize.value) return
  if (editKind.value === 'create') {
    if (await mutate({ type: 'create', parent: location.value, name: editValue.value, id: crypto.randomUUID() })) closeEdit()
  } else if (editEntry.value?.kind === 'folder') {
    if (await mutate({ type: 'rename', key: editEntry.value.key, name: editValue.value })) closeEdit()
  } else if (editEntry.value?.kind === 'photo') {
    working.value = true; error.value = ''
    try {
      await editBrowserPhoto(editEntry.value.id, editKind.value === 'tags'
        ? { tags: editValue.value } : { title: editValue.value })
      closeEdit()
    } catch (reason) { error.value = errorText(reason) }
    finally { working.value = false }
  } else error.value = bt('locationUnavailable')
}
function selectForAction(entry: ExplorerEntry) {
  selected.value = new Set([entry.key]); selectionMode.value = true; menuKey.value = ''
}
function startMove(entry?: ExplorerEntry) {
  if (entry) selectForAction(entry)
  error.value = ''; moveOpen.value = true
}
async function moveTo(key: string) {
  if (await mutate({ type: 'move', keys: selectedEntries.value.map(entry => entry.key), target: key })) {
    moveOpen.value = false; clearSelection()
  }
}
async function archive(restore: boolean, entry?: ExplorerEntry) {
  const keys = entry ? [entry.key] : selectedEntries.value.map(item => item.key)
  if (await mutate({ type: 'archive', keys, archived: !restore })) { menuKey.value = ''; clearSelection() }
}
function startDelete(entry?: ExplorerEntry) {
  if (entry) selectForAction(entry)
  error.value = ''; deleteOpen.value = true
}
async function removeSelection() {
  if (!canDelete.value || !canOrganize.value || working.value) return
  working.value = true; error.value = ''
  const folderKeys = selectedFolders.value.map(entry => entry.key)
  try {
    await deleteBrowserPhotos(selectedPhotos.value.map(entry => entry.id), labels.value)
    if (folderKeys.length) organizer.value = await organize({ type: 'removeFolders', keys: folderKeys }, labels.value)
    else organizer.value = await readOrganizer(account.value!.id, deviceId.value)
    deleteOpen.value = false; clearSelection()
  } catch (reason) { error.value = errorText(reason) }
  finally { working.value = false }
}
function photoAction(entry: ExplorerEntry, action: 'card' | 'share' | 'original' | 'edit') {
  menuKey.value = ''
  if (entry.kind !== 'photo') return
  if (action === 'card' || action === 'share') {
    if (action === 'share' && !entry.shareable) return
    void router.push({ path: photoCardPath(entry.id), state: action === 'share' ? { openCardShare: true } : {} })
  } else if (action === 'edit' && entry.editable)
    void router.push({ path: '/gallery/' + encodeURIComponent(entry.id) + '/edit', query: photoQuery(entry) })
  else if (action === 'original' && entry.readable)
    void router.push({ path: '/gallery/' + encodeURIComponent(entry.id), query: { ...photoQuery(entry), action: 'original' } })
}
async function createCollection() {
  if (!ready.value || working.value || !shareSelected.value.length) return
  const tasks = availableForShare.value.filter(task => shareSelected.value.includes(task.id))
  if (tasks.length !== shareSelected.value.length || tasks.length > 20) return
  const owner = account.value!.id, device = deviceId.value, id = crypto.randomUUID()
  working.value = true; error.value = ''
  try {
    await saveBrowser(owner, device, { collection: { id, assignments: tasks.map(task => ({ id: task.id, name: task.name })),
      expiresAt: Date.now() + 7 * 86400000, canRevoke: true }, photos: [], pending: { assignmentIds: tasks.map(task => task.id) } })
    if (owner === account.value?.id && device === deviceId.value) { shareOpen.value = false; await router.push('/browser/' + id) }
  } catch { error.value = bt('loadFailed') }
  finally { working.value = false }
}
let organizerEpoch = 0
async function loadOrganizer() {
  const epoch = ++organizerEpoch, owner = account.value?.id, device = deviceId.value
  if (!ready.value || !owner || !device) return
  organizerLoading.value = true; organizerFailed.value = false
  try {
    const saved = await readOrganizer(owner, device)
    if (epoch === organizerEpoch && owner === account.value?.id && device === deviceId.value && ready.value) {
      organizer.value = saved; organizerLoaded.value = true
    }
  } catch { if (epoch === organizerEpoch) organizerFailed.value = true }
  finally { if (epoch === organizerEpoch) organizerLoading.value = false }
}
watch([() => account.value?.id, deviceId, ready], () => {
  organizerEpoch++
  organizer.value = { version: 1, folders: [] }; organizerLoaded.value = false; organizerFailed.value = false
  organizerLoading.value = false; selected.value = new Set(); menuKey.value = ''
  editOpen.value = false; editValue.value = ''; editKey.value = ''; moveOpen.value = false
  deleteOpen.value = false; shareOpen.value = false; shareSelected.value = []; query.value = ''; tag.value = ''
  createLocationOpen.value = false
  selectionActionsOpen.value = false; pathOpen.value = false
  if (ready.value) void loadOrganizer()
}, { immediate: true, flush: 'sync' })
watch(location, async () => {
  clearSelection(); menuKey.value = ''; query.value = ''; tag.value = ''; error.value = ''; pageSize.value = 50
  moveOpen.value = false; closeEdit()
  selectionActionsOpen.value = false; pathOpen.value = false
  await nextTick()
  if (pathBar.value) pathBar.value.scrollLeft = pathBar.value.scrollWidth
  document.getElementById('main')?.scrollTo({ top: 0 })
})
watch([location, display], () => {
  if (display.value === 'tree') expanded.value = new Set([...expanded.value, location.value])
}, { immediate: true })
watch([query, tag, display, sort], () => { pageSize.value = 50 })
onMounted(() => {
  window.addEventListener('focus', loadOrganizer)
  // Local organizer loading is independent of HTTP/photo reconciliation.
  void Promise.allSettled([loadStudio(), refreshLibrary()])
  if (!route.query.folder && !route.query.assignment && !route.query.section)
    void router.replace({ path: '/browser', query: { section: start.value } })
})
onBeforeUnmount(() => window.removeEventListener('focus', loadOrganizer))
</script>

<template>
  <section class="native-screen photo-explorer">
    <ScreenHeader :title="bt('browser')">
      <button class="app-icon-button" type="button" :aria-label="bt('newFolder')" :title="bt('newFolder')"
        :disabled="!canOrganize || !current || working" @click="startEdit('create')"><AppIcon name="plus" /></button>
      <button class="app-icon-button" type="button" :aria-label="bt(selectionMode ? 'cancelSelection' : 'selectionMode')"
        :title="bt('selectionMode')" :aria-pressed="selectionMode" :disabled="!ready || !current"
        @click="selectionMode = !selectionMode; selected = new Set()"><AppIcon name="check" /></button>
      <button class="app-icon-button" :aria-label="bt('searchShort')" :aria-pressed="searchOpen"
        @click="searchOpen = !searchOpen; query = ''"><AppIcon name="search" /></button>
      <button class="app-icon-button" :aria-label="bt('settings')" @click="settingsOpen = true"><AppIcon name="settings" /></button>
    </ScreenHeader>
    <nav class="explorer-sections" :aria-label="bt('showFirst')">
      <button v-for="item in sections" :key="item" type="button" :aria-current="section === item ? 'page' : undefined"
        @click="navigate(item)">{{ labels[item] }}</button>
    </nav>
    <div class="screen-body explorer-body">
      <template v-if="ready">
        <div v-if="showPath" class="explorer-location">
          <button class="app-icon-button" :aria-label="bt('up')" :disabled="!current?.parent"
            @click="current?.parent && navigate(current.parent)"><AppIcon name="back" /></button>
          <nav ref="pathBar" class="explorer-path" :aria-label="bt('currentPath')">
            <button v-if="crumbs.length > shortCrumbs.length" class="explorer-ancestors" type="button"
              :aria-label="bt('currentPath')" @click="pathOpen = true"><AppIcon name="more" /></button>
            <template v-for="(crumb, index) in shortCrumbs" :key="crumb.key">
              <AppIcon v-if="index" name="chevron" />
              <button type="button" :aria-current="index === shortCrumbs.length - 1 ? 'page' : undefined" :title="crumb.name"
                @click="navigate(crumb.key)">{{ crumb.name }}</button>
            </template>
          </nav>
        </div>
        <div v-if="selectionMode" class="explorer-selection" role="toolbar" :aria-label="bt('selectionMode')">
          <strong>{{ bt('selected') }}: {{ formatNumber(selectedEntries.length) }}</strong>
          <button type="button" @click="selectAll">{{ bt('selectAll') }}</button>
          <button class="app-icon-button" type="button" :aria-label="bt('actions')" :disabled="!selectedEntries.length"
            @click="selectionActionsOpen = true"><AppIcon name="more" /></button>
        </div>
        <label v-if="searchOpen" class="explorer-search">
          <AppIcon name="search" /><input v-model="query" type="search" :aria-label="bt('searchShort')" :placeholder="bt('searchPlaceholder')" />
        </label>
        <div v-if="searchOpen && tags.length" class="explorer-tags" :aria-label="bt('chooseTag')">
          <button type="button" :aria-pressed="!tag" @click="tag = ''">{{ bt('allTags') }}</button>
          <button v-for="item in tags" :key="item" type="button" :aria-pressed="tag === item" @click="tag = item">#{{ item }}</button>
        </div>
        <button v-if="tag && !searchOpen" class="quiet-button" type="button" :aria-label="bt('clear') + ': ' + tag" @click="tag = ''">#{{ tag }} ×</button>
        <p v-if="current?.key === 'archive'" class="field-hint">{{ bt('archiveHint') }}</p>
        <p v-if="recovered" class="field-hint" role="status">{{ bt('recovered') }}</p>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <div v-if="organizerFailed" class="explorer-notice" role="alert">
          <span>{{ bt('storageUnavailable') }}</span><button type="button" @click="loadOrganizer">{{ bt('retryFolders') }}</button>
        </div>
        <div v-if="libraryError || serverError" class="explorer-notice" role="status">
          <span>{{ bt('libraryRefreshFailed') }}</span><button type="button" :disabled="libraryLoading" @click="refreshLibrary">{{ bt('retry') }}</button>
        </div>
        <div v-if="organizerLoading && !organizerLoaded" class="browser-skeleton" aria-busy="true" aria-label="Loading">
          <span v-for="index in 4" :key="index" />
        </div>
        <div v-else-if="!current" class="native-empty">
          <AppIcon name="folder" /><p role="alert">{{ bt('locationUnavailable') }}</p>
          <button class="secondary-button" type="button" @click="navigate('all')">{{ bt('all') }}</button>
        </div>
        <template v-else>
          <div ref="tree" :class="['explorer-entries', 'explorer-' + display]" :role="display === 'tree' ? 'tree' : 'list'" :aria-label="current.name">
            <div v-for="row in shownRows" :key="row.entry.key" :data-entry-key="row.entry.key"
              :class="['explorer-entry', { 'is-photo': row.entry.kind === 'photo', 'is-selected': selected.has(row.entry.key), 'is-current': row.entry.key === location }]"
              @contextmenu.prevent="menuKey = selectable(row.entry) ? row.entry.key : ''"
              :role="display === 'tree' ? 'treeitem' : 'listitem'"
              :aria-level="display === 'tree' ? row.depth + 1 : undefined"
              :aria-expanded="display === 'tree' && row.expandable ? row.expanded : undefined"
              :aria-selected="display === 'tree' ? selected.has(row.entry.key) : undefined"
              :style="display === 'tree' ? { '--entry-depth': row.depth } : undefined">
              <button v-if="display === 'tree'" class="explorer-expand app-icon-button" type="button" :disabled="!row.expandable"
                :aria-label="bt(row.expanded ? 'collapse' : 'expand') + ' ' + row.entry.name" @click="toggleTree(row.entry.key)">
                <AppIcon v-if="row.expandable" :class="{ rotated: row.expanded }" name="chevron" />
              </button>
              <input v-if="selectionMode && selectable(row.entry)" class="explorer-check" type="checkbox"
                :aria-label="bt('select') + ' ' + row.entry.name" :checked="selected.has(row.entry.key)" @change="toggleSelection(row.entry.key)" />
              <button class="explorer-open" type="button" :aria-label="row.entry.name" :disabled="row.entry.kind === 'photo' && !row.entry.readable && !selectionMode" @click="openEntry(row.entry)" @keydown="treeKey($event, row.entry)">
                <PhotoThumbnail v-if="row.entry.kind === 'photo'" class="explorer-thumbnail" :id="row.entry.id"
                  :access-key="String(row.entry.photo?.remoteRevision) + ':' + String(row.entry.photo?.thumbnailOnly)"
                  :expires-at="row.entry.photo?.expiresAt" :alt="row.entry.name" />
                <span v-else class="explorer-folder">
                  <template v-if="display === 'grid' && row.entry.count">
                    <PhotoThumbnail v-for="item in cover(row.entry)" :key="item.key" :id="item.id"
                      :access-key="String(item.photo?.remoteRevision) + ':' + String(item.photo?.thumbnailOnly)"
                      :expires-at="item.photo?.expiresAt" alt="" />
                  </template>
                  <AppIcon v-else :name="row.entry.key === 'archive' ? 'archive' : 'folder'" />
                </span>
                <span class="explorer-copy">
                  <strong>{{ row.entry.name }}</strong>
                  <template v-if="row.entry.kind === 'photo'">
                    <small v-if="row.entry.createdAt">{{ formatDate(row.entry.createdAt) }}</small>
                    <small class="explorer-expiry">{{ row.entry.photo?.expiresAt ? bt('until') + ' ' + formatDate(row.entry.photo.expiresAt) : bt('noExpiry') }}</small>
                    <span v-if="row.entry.readable && row.entry.photo?.tags?.length" class="explorer-row-tags">{{ row.entry.photo.tags.map(item => '#' + item).join(' ') }}</span>
                  </template>
                  <small v-else>{{ formatNumber(row.entry.count) }} {{ bt('photoCount') }}<span v-if="row.entry.kind === 'folder'"> · {{ formatDate(row.entry.createdAt) }}</span></small>
                  <small v-if="query || tag" class="explorer-result-path">{{ ancestors(model, row.entry.key).slice(0, -1).map(item => item.name).join(' / ') }}</small>
                </span>
              </button>
              <button v-if="selectable(row.entry)" class="app-icon-button explorer-more" type="button"
                :aria-label="bt('actions') + ': ' + row.entry.name" @click="menuKey = row.entry.key"><AppIcon name="more" /></button>
            </div>
          </div>
          <div v-if="!shownRows.length && !libraryLoading" class="native-empty explorer-empty">
            <AppIcon name="folder" /><h2>{{ bt('emptyFolder') }}</h2><p>{{ query || tag ? bt('searchPlaceholder') : bt('emptyFolderHint') }}</p>
            <button v-if="mayCreate" class="secondary-button" type="button" @click="startEdit('create')"><AppIcon name="plus" />{{ bt('newFolder') }}</button>
          </div>
          <div v-if="libraryLoading && !photos.length" class="browser-skeleton explorer-photo-loading" aria-busy="true" aria-label="Loading photos"><span /><span /></div>
          <button v-if="rows.length > shownRows.length" class="secondary-button full-button" type="button" @click="pageSize += 50">{{ bt('loadMore') }} ({{ formatNumber(shownRows.length) }} / {{ formatNumber(rows.length) }})</button>
        </template>
      </template>
      <div v-else class="native-empty"><AppIcon name="lock" /><p>{{ bt('locked') }}</p><RouterLink class="secondary-button" to="/profile/photos-security">{{ bt('retry') }}</RouterLink></div>
    </div>

    <AppSheet :open="pathOpen" :title="bt('currentPath')" @close="pathOpen = false">
      <div class="action-list explorer-destinations">
        <button v-for="crumb in crumbs" :key="crumb.key" type="button" :aria-current="crumb.key === location ? 'location' : undefined"
          @click="pathOpen = false; navigate(crumb.key)"><AppIcon name="folder" />{{ crumb.name }}</button>
      </div>
    </AppSheet>
    <AppSheet :open="selectionActionsOpen" :title="bt('actions')" @close="selectionActionsOpen = false">
      <div class="action-list">
        <button type="button" :disabled="!canOrganize || !targets.length || working" @click="selectionActionsOpen = false; startMove()"><AppIcon name="folder" />{{ bt('move') }}</button>
        <button v-if="canArchive" type="button" :disabled="!canOrganize || working" @click="selectionActionsOpen = false; archive(restoreSelection)"><AppIcon name="archive" />{{ bt(restoreSelection ? 'restore' : 'archiveAction') }}</button>
        <button class="subtle-danger" type="button" :disabled="!canOrganize || !canDelete || working" @click="selectionActionsOpen = false; startDelete()"><AppIcon name="trash" />{{ bt('delete') }}</button>
        <button type="button" @click="selectionActionsOpen = false; clearSelection()"><AppIcon name="check" />{{ bt('cancelSelection') }}</button>
      </div>
    </AppSheet>
    <AppSheet :open="!!menuEntry" :title="menuEntry?.name || bt('actions')" @close="menuKey = ''">
      <div v-if="menuEntry" class="action-list explorer-menu">
        <button type="button" :disabled="menuEntry.kind === 'photo' && !menuEntry.readable" @click="openEntry(menuEntry, true); menuKey = ''"><AppIcon :name="menuEntry.kind === 'photo' ? 'gallery' : 'folder'" />{{ bt(menuEntry.kind === 'photo' ? 'openPhoto' : 'currentPath') }}</button>
        <template v-if="menuEntry.kind === 'photo'">
          <button type="button" @click="photoAction(menuEntry, 'card')"><AppIcon name="profiles" />{{ bt('card') }}</button>
          <button v-if="menuEntry.readable" type="button" @click="photoAction(menuEntry, 'original')"><AppIcon name="gallery" />{{ bt('original') }}</button>
          <button v-if="menuEntry.editable" type="button" @click="photoAction(menuEntry, 'edit')"><AppIcon name="edit" />{{ bt('editPhoto') }}</button>
          <button v-if="menuEntry.editable" type="button" @click="startEdit('tags', menuEntry)"><AppIcon name="edit" />{{ bt('editTags') }}</button>
          <button v-if="menuEntry.shareable" type="button" @click="photoAction(menuEntry, 'share')"><AppIcon name="share" />{{ bt('shareCard') }}</button>
          <button v-if="menuEntry.scope === 'personal'" type="button" :disabled="working" @click="archive(!!menuEntry.archived, menuEntry)"><AppIcon name="archive" />{{ bt(menuEntry.archived ? 'restore' : 'archiveAction') }}</button>
        </template>
        <button v-if="menuEntry.kind === 'folder' || (menuEntry.editable && menuEntry.photo && (metadataEditable(menuEntry.photo) || !menuEntry.photo.title))" type="button" @click="startEdit('rename', menuEntry)"><AppIcon name="edit" />{{ bt('rename') }}</button>
        <button v-if="!menuEntry.archived" type="button" @click="startMove(menuEntry)"><AppIcon name="folder" />{{ bt('move') }}</button>
        <button v-if="menuEntry.kind === 'folder' || menuEntry.deletable" type="button" class="subtle-danger" @click="startDelete(menuEntry)"><AppIcon name="trash" />{{ bt('delete') }}</button>
      </div>
    </AppSheet>
    <AppSheet :open="editOpen" :title="editTitle" :busy="working" @close="closeEdit">
      <form class="native-form" @submit.prevent="saveEdit">
        <p v-if="editKind === 'create'" class="field-hint">{{ bt('currentPath') }}: {{ crumbs.map(item => item.name).join(' / ') }}</p>
        <label>{{ bt(editKind === 'tags' ? 'tags' : editEntry?.kind === 'photo' ? 'name' : 'folderName') }}<input v-model="editValue" :maxlength="editKind === 'tags' ? 820 : editEntry?.kind === 'photo' ? 120 : 80" autofocus :required="editKind !== 'tags'" /></label>
        <p v-if="editKind === 'tags'" class="field-hint">{{ bt('tagsHint') }}</p>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button class="primary-button full-button" :disabled="working || (editKind !== 'tags' && !editValue.trim())">{{ bt(editKind === 'create' ? 'createFolder' : 'save') }}</button>
      </form>
    </AppSheet>
    <AppSheet :open="createLocationOpen" :title="bt('chooseLocation')" @close="createLocationOpen = false">
      <div class="action-list explorer-destinations">
        <button v-for="target in createTargets" :key="target.key" type="button" @click="chooseCreateLocation(target.key)"><AppIcon name="folder" />{{ entryPath(target) }}</button>
      </div>
    </AppSheet>
    <AppSheet :open="moveOpen" :title="bt('moveTo')" :busy="working" @close="moveOpen = false; error = ''">
      <div class="action-list explorer-destinations">
        <button v-for="target in targets" :key="target.key" type="button" :disabled="working || selectedEntries.every(entry => entry.parent === target.key)" @click="moveTo(target.key)"><AppIcon name="folder" />{{ entryPath(target) }}</button>
      </div>
      <p v-if="!targets.length" class="field-hint">{{ bt('scopeConflict') }}</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    </AppSheet>
    <AppSheet :open="deleteOpen" :title="bt('delete')" :busy="working" @close="deleteOpen = false; error = ''">
      <ul class="explorer-delete-names"><li v-for="entry in selectedEntries" :key="entry.key">{{ entry.name }}</li></ul>
      <p v-if="selectedPhotos.length" class="field-hint">{{ bt('deleteConfirm') }}</p>
      <p v-if="selectedFolders.length" class="field-hint">{{ bt('folderDeleteHint') }}</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <button class="danger-button full-button" :disabled="working || !canDelete" type="button" @click="removeSelection">{{ bt('delete') }}</button>
    </AppSheet>
    <AppSheet :open="settingsOpen" :title="bt('settings')" @close="settingsOpen = false">
      <div class="native-form">
        <label>{{ bt('showFirst') }}<select v-model="start"><option v-for="item in sections" :key="item" :value="item">{{ labels[item] }}</option></select></label>
        <label>{{ bt('view') }}<select v-model="display"><option v-for="item in ['grid', 'list', 'tree'] as const" :key="item" :value="item">{{ bt(item) }}</option></select></label>
        <label>{{ bt('sort') }}<select v-model="sort"><option value="newest">{{ bt('sortNewest') }}</option><option value="oldest">{{ bt('sortOldest') }}</option><option value="name">{{ bt('sortName') }}</option></select></label>
        <label v-if="tags.length">{{ bt('chooseTag') }}<select v-model="tag"><option value="">{{ bt('allTags') }}</option><option v-for="item in tags" :key="item" :value="item">#{{ item }}</option></select></label>
        <p class="field-hint">{{ bt('tagsManageHint') }}</p>
        <button class="secondary-button" type="button" :disabled="!availableForShare.length" @click="settingsOpen = false; shareSelected = []; shareOpen = true"><AppIcon name="share" />{{ bt('newCollection') }}</button>
      </div>
    </AppSheet>
    <AppSheet :open="shareOpen" :title="bt('newCollection')" :busy="working" @close="shareOpen = false; error = ''">
      <form class="native-form" @submit.prevent="createCollection">
        <p class="field-hint">{{ bt('sharedWith') }}</p>
        <label v-for="task in availableForShare" :key="task.id" class="browser-share-choice"><input v-model="shareSelected" type="checkbox" :value="task.id" />{{ task.name }}</label>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button class="primary-button full-button" :disabled="working || !shareSelected.length">{{ bt('openCollection') }}</button>
      </form>
    </AppSheet>
  </section>
</template>
