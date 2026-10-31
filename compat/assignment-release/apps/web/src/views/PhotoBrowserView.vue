<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'
import ScreenHeader from '../components/ScreenHeader.vue'
import AppIcon from '../components/AppIcon.vue'
import PhotoThumbnail from '../components/PhotoThumbnail.vue'
import { account, deviceId, sessionState, offlineCaptureIdentity, hasConfirmedIdentity } from '../identity/store'
import { appLockReady, appLocked } from '../app/lock'
import { protectionEnabled, protectionReady, strongUnlocked, warmLocked, photoReadAllowed } from '../crypto/store'
import { photos, refreshLibrary, libraryError, serverError } from '../local/library'
import { request } from '../workspace/api'
import { photoCardPath } from '../studio/private-photo-card'
import { eraseBrowser, readBrowser, saveBrowser } from '../photo-browser/cache'
import { visibleBrowserPhotos, type BrowserCollection, type BrowserSnapshot } from '../photo-browser/model'
import { bt } from '../photo-browser/text'
import { locale, formatNumber } from '../i18n'
import { downloadBrowser, chooseZipDestination, releaseTemporaryDownloads } from '../photo-browser/download'
import { lockGeneration } from '../crypto/state'

const route = useRoute()
const id = computed(() => String(route.params.id ?? ''))
const snapshot = ref<BrowserSnapshot>()
const status = ref<'loading' | 'ready' | 'offline' | 'pending' | 'locked' | 'denied' | 'revoked' | 'unavailable' | 'failed'>('loading')
const selected = ref<string[]>([])
const choosing = ref(false)
const query = ref('')
const assignment = ref('')
const display = ref<'grid' | 'list' | 'tree'>('grid')
const sort = ref<'newest' | 'oldest' | 'name'>('newest')
const copyStatus = ref('')
const busy = ref(false)
const exporting = ref(false)
const exportStopping = ref(false)
const exportDone = ref(0)
const exportTotal = ref(0)
const exportNotice = ref<'' | 'exportWritten' | 'exportDispatched' | 'exportCancelled' | 'exportDenied' | 'exportSize' | 'exportVersion' | 'exportFailed'>('')
let exportController: AbortController | undefined
const online = ref(navigator.onLine)
const now = ref(Date.now())
let generation = 0
const gate = () => !!account.value && !!deviceId.value &&
  appLockReady.value && !appLocked.value && protectionReady.value &&
  (!protectionEnabled.value || photoReadAllowed()) &&
  (hasConfirmedIdentity() || (sessionState.value === 'offline' && offlineCaptureIdentity.value))
const alive = (epoch: number, owner: string, device: string, collectionId: string) =>
  epoch === generation && account.value?.id === owner && deviceId.value === device &&
  id.value === collectionId && gate()

const collection = computed(() => status.value === 'ready' || status.value === 'offline'
  ? snapshot.value?.collection : undefined)
const ordered = computed(() => {
  const records = (status.value === 'ready' || status.value === 'offline') && snapshot.value
    ? snapshot.value.photos.filter(row =>
      row.expiresAt > now.value &&
      (!assignment.value || row.assignmentId === assignment.value) &&
      (row.label || bt('photo')).toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()))
    : []
  return [...records].sort((a, b) => sort.value === 'name'
    ? (a.label || bt('photo')).localeCompare(b.label || bt('photo'), locale.value)
    : sort.value === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt)
})
const selectedSet = computed(() => new Set(selected.value))
const expiry = computed(() => collection.value?.expiresAt ?? 0)
const date = (time: number) => new Intl.DateTimeFormat(locale.value, {
  dateStyle: 'medium', timeStyle: 'short',
}).format(time)
function stopExport() {
  if (exportController && !exportController.signal.aborted) {
    exportStopping.value = true
    exportController.abort()
  }
}
function clear() {
  stopExport()
  releaseTemporaryDownloads()
  generation++
  snapshot.value = undefined
  selected.value = []
  choosing.value = false
  query.value = ''
  assignment.value = ''
  copyStatus.value = ''
  exportNotice.value = ''
  status.value = 'locked'
}
async function load() {
  const epoch = ++generation, owner = account.value?.id, device = deviceId.value
  const collectionId = id.value
  snapshot.value = undefined
  copyStatus.value = ''
  if (!owner || !device || !gate()) { status.value = 'locked'; return }
  status.value = 'loading'
  try {
    let cached: BrowserSnapshot | undefined
    try { cached = await readBrowser(owner, device, collectionId) }
    catch {
      // Corrupted or stale local ciphertext must not permanently block
      // reauthorization online; it never becomes a source of permission.
      if (online.value) await eraseBrowser(owner, device, collectionId).catch(() => {})
      else throw new Error('browser.offline_cache_unavailable')
    }
    if (!alive(epoch, owner, device, collectionId)) return
    if (!online.value) {
      if (cached && !cached.pending &&
        (hasConfirmedIdentity() || (sessionState.value === 'offline' && offlineCaptureIdentity.value))) {
        snapshot.value = cached
        status.value = 'offline'
      } else status.value = cached?.pending ? 'pending' : 'unavailable'
      return
    }
    if (!hasConfirmedIdentity()) { status.value = 'locked'; return }
    if (cached?.pending) {
      // Stable collection ID and payload: lost ACK cannot duplicate shares.
      await request<BrowserCollection>('/browser/' + encodeURIComponent(collectionId),
        'PUT', { assignmentIds: cached.pending.assignmentIds,
          expiresAt: cached.collection.expiresAt }, owner)
    }
    const authorized = await request<BrowserCollection>('/browser/' + encodeURIComponent(collectionId), 'GET', undefined, owner)
    if (!alive(epoch, owner, device, collectionId)) return
    // Never trust a stale decrypted list while online. The photo index has its
    // own E2EE verification and per-photo server ACL/TTL filtering.
    await refreshLibrary()
    if (!alive(epoch, owner, device, collectionId)) return
    if (serverError.value || libraryError.value) throw new Error('browser.photo_index_unavailable')
    const list = visibleBrowserPhotos(authorized, photos.value, owner)
    const verified: BrowserSnapshot = { collection: authorized, photos: list }
    await saveBrowser(owner, device, verified)
    if (!alive(epoch, owner, device, collectionId)) return
    snapshot.value = verified
    status.value = 'ready'
  } catch (failure) {
    if (!alive(epoch, owner, device, collectionId)) return
    const code = (failure as { status?: number })?.status
    if (code === 403 || code === 404 || code === 410) {
      await eraseBrowser(owner, device, collectionId).catch(() => {})
      if (!alive(epoch, owner, device, collectionId)) return
    }
    status.value = code === 403 || code === 404 ? 'denied'
      : code === 410 ? 'unavailable' : 'failed'
  }
}
watch([id, () => account.value?.id, deviceId, sessionState, offlineCaptureIdentity,
  appLockReady, appLocked, protectionReady, protectionEnabled, strongUnlocked, warmLocked], () => {
  clear()
  if (gate()) void load()
}, { immediate: true, flush: 'sync' })
function onlineChanged() {
  online.value = navigator.onLine
  clear()
  if (gate()) void load()
}
function toggle(id: string) {
  selected.value = selectedSet.value.has(id)
    ? selected.value.filter(value => value !== id)
    : [...selected.value, id]
}
function selectAll() { selected.value = [...new Set(ordered.value.map(x => x.id))] }
// Selection survives search/folder/display changes. Export exactly what the
// counter shows, while dropping rows that expired since they were selected.
const selection = computed(() => status.value === 'ready' && snapshot.value
  ? snapshot.value.photos.filter(item => selectedSet.value.has(item.id) && item.expiresAt > now.value)
  : [])
function exportSelection(mode: 'single' | 'zip') {
  if (exporting.value || status.value !== 'ready' || !collection.value ||
      !hasConfirmedIdentity() || !online.value) return
  const items = selection.value
  if (!items.length || (mode === 'single' && items.length !== 1)) return
  const current = ++generation
  const owner = account.value!.id, device = deviceId.value
  const browserId = id.value
  const lock = lockGeneration.value
  const selectedCollection = collection.value
  const controller = new AbortController()
  exportController = controller
  exporting.value = true
  exportStopping.value = false
  exportDone.value = 0
  exportTotal.value = items.length
  exportNotice.value = ''
  // Save-file picker must be opened in the user's click event, before fetch.
  const destination = mode === 'zip' ? chooseZipDestination() : undefined
  void (async () => {
    try {
      const result = await downloadBrowser({
        collection: selectedCollection, selected: items, mode,
        owner, device, signal: controller.signal,
        stillCurrent: () => current === generation &&
          id.value === browserId && lockGeneration.value === lock &&
          document.visibilityState === 'visible' && !exportStopping.value &&
          status.value === 'ready',
        onProgress: (done, total) => {
          if (current === generation) {
            exportDone.value = done
            exportTotal.value = total
          }
        },
      }, destination)
      if (current === generation) exportNotice.value =
        result === 'written' ? 'exportWritten' : 'exportDispatched'
    } catch (error) {
      if (current !== generation) return
      const statusCode = (error as { status?: number })?.status
      const code = error instanceof Error ? error.message : ''
      exportNotice.value = controller.signal.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
        ? 'exportCancelled' :
        statusCode === 403 || statusCode === 404 || statusCode === 410 ||
          code === 'browser.denied' ? 'exportDenied' :
        code === 'browser.zip_limit' || code === 'browser.image_limit' ? 'exportSize' :
        code === 'browser.version_required' ? 'exportVersion' : 'exportFailed'
      if (exportNotice.value === 'exportDenied') {
        snapshot.value = undefined
        status.value = 'denied'
        void eraseBrowser(owner, device, browserId).catch(() => {})
      }
    } finally {
      if (exportController === controller) exportController = undefined
      exporting.value = false
      exportStopping.value = false
    }
  })()
}
async function copy() {
  if (status.value !== 'ready' || !online.value) return
  try {
    await navigator.clipboard.writeText(window.location.origin + '/browser/' + encodeURIComponent(id.value))
    copyStatus.value = bt('copied')
  } catch { copyStatus.value = bt('copyFailed') }
}
async function revoke() {
  if (!collection.value?.canRevoke || !hasConfirmedIdentity() || !online.value ||
      busy.value || !confirm(bt('revokeConfirm'))) return
  const epoch = generation, owner = account.value!.id, device = deviceId.value, collectionId = id.value
  busy.value = true
  stopExport()
  exportNotice.value = ''
  try {
    await request('/browser/' + encodeURIComponent(collectionId), 'DELETE', undefined, owner)
    await eraseBrowser(owner, device, collectionId)
    if (alive(epoch, owner, device, collectionId)) {
      snapshot.value = undefined
      status.value = 'revoked'
    }
  } catch { if (alive(epoch, owner, device, collectionId)) copyStatus.value = bt('loadFailed') }
  finally { busy.value = false }
}
const tick = setInterval(() => {
  now.value = Date.now()
  if (snapshot.value?.collection.expiresAt && snapshot.value.collection.expiresAt <= now.value) {
    stopExport(); releaseTemporaryDownloads(); snapshot.value = undefined; status.value = 'unavailable'
  }
}, 5000)
function exportVisibility() { if (document.hidden) stopExport() }
document.addEventListener('visibilitychange', exportVisibility)
window.addEventListener('online', onlineChanged)
window.addEventListener('offline', onlineChanged)
onBeforeRouteLeave(() => { stopExport() })
onBeforeUnmount(() => {
  clear()
  clearInterval(tick)
  document.removeEventListener('visibilitychange', exportVisibility)
  window.removeEventListener('online', onlineChanged)
  window.removeEventListener('offline', onlineChanged)
})
</script>

<template>
  <section class="native-screen protected-browser">
    <ScreenHeader :title="bt('browser')" back="/assignments">
      <RouterLink to="/browser" class="app-icon-button" :aria-label="bt('newCollection')">
        <AppIcon name="plus" /></RouterLink>
    </ScreenHeader>
    <div class="screen-body browser-body">
      <div v-if="status === 'loading'" class="native-empty" role="status">
        <AppIcon name="lock" /><p>{{ bt('waiting') }}</p>
      </div>
      <div v-else-if="!collection" class="native-empty" role="status">
        <AppIcon name="lock" />
        <p>{{ bt(status === 'pending' ? 'pending' :
          status === 'locked' ? 'locked' : status === 'denied' ? 'denied' :
          status === 'revoked' ? 'revoked' :
          status === 'failed' ? 'loadFailed' : 'unavailable') }}</p>
        <p v-if="exportNotice" class="field-hint">{{ bt(exportNotice) }}</p>
        <button class="primary-button" type="button" @click="load">{{ bt('retry') }}</button>
      </div>
      <template v-else>
        <header class="browser-intro">
          <div><h2>{{ bt('collection') }}</h2>
            <p class="field-hint">{{ bt('expires') }}: {{ date(expiry) }}</p>
            <p v-if="status === 'offline'" role="status" class="field-hint">{{ bt('offline') }}</p>
          </div>
          <div v-if="status === 'ready'" class="browser-actions">
            <button class="secondary-button" type="button" @click="copy"><AppIcon name="copy" />{{ bt('copy') }}</button>
            <button v-if="collection.canRevoke" class="quiet-button subtle-danger"
              :disabled="busy" type="button" @click="revoke">{{ bt('revoke') }}</button>
          </div>
        </header>
        <p v-if="copyStatus" role="status" class="field-hint">{{ copyStatus }}</p>
        <div class="browser-toolbar">
          <label>{{ bt('search') }}<input v-model="query" type="search" :placeholder="bt('search')" /></label>
          <label>{{ bt('sort') }}<select v-model="sort">
            <option value="newest">{{ bt('newest') }}</option>
            <option value="oldest">{{ bt('oldest') }}</option>
            <option value="name">{{ bt('name') }}</option>
          </select></label>
          <label>{{ bt('back') }}<select v-model="assignment">
            <option value="">{{ bt('all') }}</option>
            <option v-for="task in collection.assignments" :key="task.id" :value="task.id">{{ task.name }}</option>
          </select></label>
        </div>
        <div class="browser-modes" role="group" :aria-label="bt('browser')">
          <button v-for="mode in ['grid', 'list', 'tree'] as const" :key="mode" type="button"
            class="secondary-button" :aria-pressed="display === mode" @click="display = mode">{{ bt(mode) }}</button>
          <button type="button" class="quiet-button" :aria-pressed="choosing"
            @click="choosing = !choosing; selected = []">{{ bt('select') }}</button>
        </div>
        <div v-if="choosing" class="browser-selection" role="status">
          {{ bt('selectedCount') }}: {{ formatNumber(selection.length) }}
          <button class="quiet-button" type="button" @click="selectAll">{{ bt('selectAll') }}</button>
          <button class="quiet-button" type="button" @click="selected = []">{{ bt('clear') }}</button>
          <button type="button" class="secondary-button"
            :disabled="exporting || status !== 'ready' || selection.length !== 1"
            @click="exportSelection('single')">{{ bt('downloadOne') }}</button>
          <button type="button" class="primary-button"
            :disabled="exporting || status !== 'ready' || selection.length < 1"
            @click="exportSelection('zip')">{{ bt('downloadZip') }}</button>
        </div>
        <div v-if="exporting || exportNotice" class="browser-export-status" role="status" aria-live="polite">
          <p v-if="exporting">{{ bt(exportStopping ? 'exportCancelling' : 'exportProgress') }}:
            {{ exportDone }} / {{ exportTotal }}</p>
          <progress v-if="exporting" :value="exportDone" :max="Math.max(1, exportTotal)"></progress>
          <button v-if="exporting && !exportStopping" type="button"
            class="secondary-button" @click="stopExport">{{ bt('exportCancel') }}</button>
          <p v-if="exportNotice">{{ bt(exportNotice) }}</p>
          <button v-if="exportNotice && exportNotice !== 'exportWritten' &&
            exportNotice !== 'exportDispatched'" type="button"
            class="quiet-button" :disabled="exporting || status !== 'ready'"
            @click="exportSelection(selection.length === 1 ? 'single' : 'zip')">
            {{ bt('retry') }}</button>
        </div>
        <p v-if="status === 'ready'" class="field-hint">{{ bt('exportLimit') }}</p>
        <p v-if="!ordered.length" class="native-empty">{{ bt('noPhotos') }}</p>
        <div v-else-if="display === 'grid'" class="native-photo-grid browser-grid">
          <div v-for="item in ordered" :key="item.id" class="browser-photo">
            <label v-if="choosing" class="browser-check"><input type="checkbox" :checked="selectedSet.has(item.id)"
              @change="toggle(item.id)" /></label>
            <RouterLink :to="photoCardPath(item.id)" class="native-photo-tile">
              <PhotoThumbnail v-if="status === 'ready'" :id="item.id" :alt="item.label || bt('photo')" />
              <span v-else class="thumbnail-placeholder" />
              <span class="tile-caption">{{ item.label || bt('photo') }}</span>
            </RouterLink>
          </div>
        </div>
        <ul v-else-if="display === 'list'" class="browser-list">
          <li v-for="item in ordered" :key="item.id">
            <input v-if="choosing" type="checkbox" :aria-label="item.label || bt('photo')"
              :checked="selectedSet.has(item.id)" @change="toggle(item.id)" />
            <RouterLink :to="photoCardPath(item.id)">
              <AppIcon name="gallery" />{{ item.label || bt('photo') }}</RouterLink>
          </li>
        </ul>
        <ul v-else class="browser-tree">
          <li v-for="task in collection.assignments" :key="task.id">
            <details :open="!assignment || assignment === task.id">
              <summary><AppIcon name="folder" />{{ task.name }}</summary>
              <ul><li v-for="item in ordered.filter(photo => photo.assignmentId === task.id)" :key="item.id">
                <input v-if="choosing" type="checkbox" :checked="selectedSet.has(item.id)"
                  :aria-label="item.label || bt('photo')" @change="toggle(item.id)" />
                <RouterLink :to="photoCardPath(item.id)">{{ item.label || bt('photo') }}</RouterLink>
              </li></ul>
            </details>
          </li>
        </ul>
      </template>
    </div>
  </section>
</template>
