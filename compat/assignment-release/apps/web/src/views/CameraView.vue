<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import AppSheet from '../components/AppSheet.vue'
import ScreenHeader from '../components/ScreenHeader.vue'
import {
  activeAssignment as legacyAssignment,
  refreshAssignments,
  selectAssignment,
  replacesId,
  taskId,
} from '../collaboration/store'
import { canCapture } from '../collaboration/access'
import { c } from '../collaboration/text'
import { pendingCount as accountPending } from '../workspace/state'
import { w } from '../workspace/text'
import { account, deviceId, identityReady, offlineCaptureIdentity, publicCaptureUnknown } from '../identity/store'
import { appLockReady, appLocked } from '../app/lock'
import { checkCapture } from '../crypto/protocol'
import * as encryptedPhotos from '../crypto/photos'
import { protectionEnabled, protectionReady, photoReadAllowed, cachedContext, planReview, untrustedKeys } from '../crypto/store'
import { cameraContext } from '../crypto/camera'
import { pendingAccess } from '../workspace/access'
import { sessionFor } from '../studio/model'
import { captureRetention } from '../delivery/clock'
import { warmNames } from '../local/photo-names'
import { nameText } from '../local/photo-name-text'
import { delivery, refreshClock, retryDelivery } from '../delivery/queue'
import { d } from '../delivery/text'
import { t, formatNumber } from '../i18n'
import { q } from '../crypto/text'
import { p } from '../profiles/text'
import {
  activeProfile as legacyProfile,
  refreshProfiles,
  selectProfile,
} from '../profiles/store'
import {
  asLocalPreset,
  choosePreset,
  clearStudioSession,
  personalCategories,
  savePersonalCategories,
  selectedCategory,
  loadStudio,
  localTasks,
  presetChoices,
  studioReady,
  studioSession,
  updateSessionCategory,
} from '../studio/store'
import {
  captureProfile,
  clone,
  imageRules,
  lines,
  retentionSeconds,
  type Preset,
} from '../studio/model'
import { s } from '../studio/text'
import {
  aspectRatio,
  defaultRules,
  snapshot,
  type Location,
  type PhotoMetadata,
} from '../profiles/model'
import { applyProfile, ResolutionError } from '../profiles/image'
import { locationAt, locationState, locationEnabled, requestLocation, subscribeLocation } from '../profiles/location'
import { locationText } from '../profiles/location-text'
import {
  cameraController,
  captureDemo,
  drawDemo,
  type CameraFeatures,
} from '../local/camera'
import {
  localPrototype,
  savePhoto,
  readMetadata,
  type Capture,
  type Photo,
} from '../local/photos'
import { updatePhoto } from '../server/photos'
import { accessLibraryId } from '../server/api'
import { libraryChanged } from '../local/library'

const router = useRouter()
const route = useRoute()
const connectionOffline = ref(!navigator.onLine)
function connectionChanged() {
  connectionOffline.value = !navigator.onLine
  if (navigator.onLine && account.value) {
    void warmNames(studioSession.value?.taskId && studioSession.value.rules.useAssignmentPhotoId !== false
      ? studioSession.value.taskId : null).catch(() => {})
    if (!offlineCaptureReady.value) void prepareCamera()
  }
}
const hardware = ref<CameraFeatures>(),
  hardwareOpen = ref(false),
  hardwareError = ref(false)
async function configureHardware(value: { zoom?: number; torch?: boolean }) {
  hardwareError.value = false
  try {
    hardware.value = await controller!.configure(value)
  } catch {
    hardwareError.value = true
  }
}
const video = ref<HTMLVideoElement>()
const demo = ref<HTMLCanvasElement>()
const stage = ref<HTMLElement>(),
  stageSize = ref({ width: 0, height: 0 })
const presetOpen = ref(false),
  contextOpen = ref(false),
  categoryEdit = ref(false),
  infoOpen = ref(false),
  quickHidden = ref(false),
  showGrid = ref(false),
  categoriesText = ref('')
const activeAssignment = computed(() =>
  account.value || studioSession.value ? undefined : legacyAssignment.value,
)
const activeProfile = computed(() =>
  account.value
    ? captureProfile(studioSession.value ?? sessionFor(), s('standard'))
    : studioSession.value
      ? captureProfile(studioSession.value, s('standard'))
      : legacyProfile.value,
)
const uiOnly = computed(
  () =>
    !!account.value ||
    !!studioSession.value ||
    (!activeProfile.value && !activeAssignment.value),
)
let pendingPreset: Preset | null = null
let observer: ResizeObserver | undefined
const mode = ref<'off' | 'live' | 'demo'>('off')
const starting = ref(false)
const ready = ref(false)
const saving = ref(false)
const taking = ref(false)
const facing = ref<'environment' | 'user'>('environment')
const status = ref<Parameters<typeof t>[0]>()
const captureDescription=ref('')
const pending = ref<Capture>()
const pendingUrl = ref('')
const rawPending = ref<Capture>()
const sizeError = ref<ResolutionError>()
const category = ref(studioSession.value?.category ?? selectedCategory.value)
const shot = ref('')
const locationStatus = ref<'pending' | 'unavailable'>()
const savedWithoutGps = ref(false)
const lastPhoto = ref<Photo>()
const sourceRatio = ref(4 / 3)
const rules = computed(() => activeProfile.value?.rules ?? defaultRules())
const offlineCaptureReady=ref(false)
const cameraPreparing = ref(false), cameraError = ref(''), cameraReview = ref(false), cameraNeedsReview = ref(false)
let preparation = 0
function participantRole(role: string) { return c(role === 'owner' || role === 'curator' || role === 'contributor' ? role : 'viewer') }
async function prepareCamera(approve = false) {
  const generation = ++preparation, owner = account.value?.id
  offlineCaptureReady.value = false; cameraError.value = ''; cameraReview.value = false; cameraNeedsReview.value = false
  if (!owner) return
  cameraPreparing.value = true
  try {
    await cameraContext(studioSession.value?.taskId || undefined, approve)
    if (alive && generation === preparation) offlineCaptureReady.value = true
  } catch (error) {
    if (!alive || generation !== preparation) return
    const code = error instanceof Error ? error.message : ''
    cameraReview.value = code === 'crypto.review_required' || code === 'crypto.review_changed'
    cameraNeedsReview.value = cameraReview.value
    cameraError.value = q(code === 'crypto.participants_not_ready' ? 'Участник задания ещё не подключил фотографии. Попросите его открыть приложение.' : code === 'crypto.owner_must_prepare' ? 'Владелец задания должен подтвердить участников перед общей съёмкой.' : cameraReview.value ? 'Подтвердите участников задания перед общей съёмкой.' : 'Не удалось подготовить съёмку. Проверьте соединение и повторите.')
  } finally { if (generation === preparation) cameraPreparing.value = false }
}
const captureAllowed = computed(() =>
  !identityReady.value || !protectionReady.value || (account.value && !offlineCaptureReady.value) ? false : offlineCaptureIdentity.value ? offlineCaptureReady.value : !account.value&&publicCaptureUnknown.value ? false : studioSession.value
    ? !studioSession.value.taskId ||
      (studioReady.value &&
        !!localTasks.value.find(
          (task) =>
            task.id === studioSession.value!.taskId &&
            !task.completed &&
            (!task.accountId ||
              ['owner', 'curator', 'contributor'].includes(task.role || '')) &&
            (!task.finishesAt || task.finishesAt > Date.now()) &&
            (!task.startsAt || task.startsAt <= Date.now()),
        ))
    : !taskId.value || !!activeAssignment.value,
)
const categoryOptions = computed(() =>
  studioSession.value?.taskId && studioSession.value.rules.particularCategory
    ? studioSession.value.rules.categories
    : personalCategories.value,
)
const categorySaveError = ref(false)
const requiredShots = computed(
  () =>
    studioSession.value?.shots ??
    activeAssignment.value?.shots ??
    activeProfile.value?.rules.shotList ??
    [],
)
let details: Parameters<typeof savePhoto>[1]
let controller: ReturnType<typeof cameraController> | undefined
let alive = true
const ratio = computed(() => aspectRatio(rules.value) ?? sourceRatio.value)
const frameStyle = computed(() => {
  if (mode.value === 'off' || !stageSize.value.height)
    return { width: '100%', height: '100%' }
  const width = Math.min(
    stageSize.value.width,
    stageSize.value.height * ratio.value,
  )
  return { width: `${width}px`, height: `${width / ratio.value}px` }
})
function measure() {
  if (stage.value)
    stageSize.value = {
      width: stage.value.clientWidth,
      height: stage.value.clientHeight,
    }
}
function choose(item?: Parameters<typeof selectProfile>[0]) {
  stop()
  if (!item) choosePreset(null)
  else if (
    presetChoices.value.find((value) => value.id === item && 'uiOnly' in value)
  )
    choosePreset(asLocalPreset(item)!)
  else {
    clearStudioSession()
    selectProfile(item)
  }
  presetOpen.value = false
  category.value = studioSession.value?.category ?? selectedCategory.value
  shot.value = ''
  status.value = undefined
}
function editCategories() {
  categoriesText.value = personalCategories.value.join('\n')
  categorySaveError.value = false
  contextOpen.value = false
  categoryEdit.value = true
}
async function saveCategories() {
  categorySaveError.value = false
  try {
    await savePersonalCategories(lines(categoriesText.value))
    categoryEdit.value = false
    contextOpen.value = true
  } catch {
    categorySaveError.value = true
  }
}
function hide() {
  stop()
  captureDescription.value = ''
  presetOpen.value =
    contextOpen.value =
    infoOpen.value =
    hardwareOpen.value =
      false
  if (pendingUrl.value) URL.revokeObjectURL(pendingUrl.value)
  pendingUrl.value = ''
  quickHidden.value = true
  window.dispatchEvent(
    new CustomEvent('photobunker-privacy-screen', { detail: true }),
  )
}
function resume() {
  quickHidden.value = false
  if (pending.value) pendingUrl.value = URL.createObjectURL(pending.value.blob)
  window.dispatchEvent(
    new CustomEvent('photobunker-privacy-screen', { detail: false }),
  )
  void nextTick(measure)
}
const waiting = new Map<
  string,
  {
    timer: ReturnType<typeof setTimeout>
    owner?: string
    busy: boolean
    next?: { location?: Location }
  }
>()
async function finishLocation(id: string, location?: Location) {
  const job = waiting.get(id)
  if (!job) return
  // Never apply a late GPS update from one account into another scope.
  if (job.owner !== account.value?.id) {
    clearTimeout(job.timer)
    waiting.delete(id)
    return
  }
  if (job.busy) {
    job.next = { location }
    return
  }
  job.busy = true
  try {
    const current = account.value && protectionEnabled.value ? encryptedPhotos.recentCapture(id) : await readMetadata(id)
    if (job.owner !== account.value?.id || !waiting.has(id)) return
    if (!current || current.deleteRequested) return
    if (
      current.metadata?.locationEditedAt ||
      current.metadata?.location?.source === 'manual'
    ) {
      clearTimeout(job.timer)
      waiting.delete(id)
      return
    }
    const previous = current.metadata?.location
    const score = (value: Location) =>
      value.accuracy +
      (Math.abs(value.measuredAt - current.createdAt) / 1000) * 3
    const eligible = location && location.accuracy <= current.profile!.rules.accuracy
      ? location : undefined
    const prior = previous && previous.accuracy <= current.profile!.rules.accuracy
      ? previous : undefined
    const use =
      eligible &&
      Math.abs(eligible.measuredAt - current.createdAt) <=
        current.profile!.rules.locationWindow * 1000 &&
      (!prior || score(eligible) < score(prior))
        ? eligible
        : prior
    const complete =
      !location || (!!use && use.accuracy <= current.profile!.rules.accuracy)
    const metadata: PhotoMetadata = {
      ...current.metadata,
      location: use,
      locationStatus: complete
        ? (use && use.accuracy <= current.profile!.rules.accuracy ? undefined : 'unavailable')
        : 'pending',
    }
    if (account.value && protectionEnabled.value) {
      if (complete) await encryptedPhotos.recordGps(id, metadata)
      else encryptedPhotos.rememberCaptureMetadata(id, metadata)
    } else {
    await updatePhoto(
      id,
      {
        title: current.title,
        note: current.note,
        favorite: current.favorite,
        metadata,
      },
      current.remoteRevision,
      current,
    )
    }
    if (lastPhoto.value?.id === id) {
      lastPhoto.value = { ...lastPhoto.value, metadata }
      if (use && use.accuracy <= current.profile!.rules.accuracy)
        savedWithoutGps.value = false
    }
    if (complete) {
      clearTimeout(job.timer)
      waiting.delete(id)
    }
    libraryChanged()
  } catch {
    /* The photo stays saved; a later sample or timeout can retry. */
  } finally {
    job.busy = false
    if (job.next && waiting.has(id)) {
      const next = job.next
      job.next = undefined
      void finishLocation(id, next.location)
    }
  }
}
// App owns the single watchPosition; Camera observes the same cached fix and
// remains free to capture before it arrives. Never start a second GPS watch.
let unsubscribeLocation: (() => void) | undefined
function locationChanged(location?: Location, permanent?: boolean) {
  if (rules.value.location !== 'off' && locationEnabled.value) {
    const accurate = locationAt(Date.now(), rules.value.locationWindow, rules.value.accuracy)
    locationStatus.value = accurate
      ? undefined
      : (permanent || ['denied', 'unavailable', 'permission'].includes(locationState.value))
        ? 'unavailable' : 'pending'
  } else locationStatus.value = undefined
  if (location || permanent)
    for (const id of waiting.keys()) void finishLocation(id, location)
}
function enableCameraLocation() {
  if (!account.value || !deviceId.value || !appLockReady.value || appLocked.value ||
      !locationEnabled.value) return
  requestLocation(account.value.id + ':' + deviceId.value)
}
function stop() {
  controller?.stop()
  for (const id of waiting.keys()) void finishLocation(id)
  mode.value = 'off'
  ready.value = false
  hardware.value = undefined
}
function startLocation() {
  locationChanged()
}
function releasePending() {
  pending.value = rawPending.value = undefined
  sizeError.value = undefined
  details = undefined
  if (pendingUrl.value) URL.revokeObjectURL(pendingUrl.value)
  pendingUrl.value = ''
}
async function start() {
  if (
    starting.value ||
    !localPrototype ||
    !captureAllowed.value ||
    (activeProfile.value && !canCapture(activeProfile.value))
  )
    return
  if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    status.value = 'cameraNeedsSecure'
    return
  }
  starting.value = true
  status.value = undefined
  stop()
  const settings = rules.value
  try {
    await controller!.start(
      facing.value,
      settings.resolution === 'fixed'
        ? { width: settings.width, height: settings.height }
        : undefined,
    )
    if (alive) {
      mode.value = 'live'
      hardware.value = controller!.features?.()
      startLocation()
    }
  } catch (error) {
    if (alive && error instanceof DOMException)
      status.value =
        error.name === 'NotAllowedError'
          ? 'cameraDenied'
          : error.name === 'NotFoundError'
            ? 'cameraMissing'
            : 'cameraBusy'
    else if (alive) status.value = 'cameraBusy'
  } finally {
    starting.value = false
  }
}
async function showDemo() {
  if (
    !captureAllowed.value ||
    (activeProfile.value && !canCapture(activeProfile.value))
  )
    return
  stop()
  await nextTick()
  drawDemo(demo.value!)
  mode.value = 'demo'
  ready.value = true
  status.value = undefined
  startLocation()
}
async function flip() {
  facing.value = facing.value === 'environment' ? 'user' : 'environment'
  await start()
}
async function persist() {
  if (!pending.value || saving.value) return
  saving.value = true
  status.value = 'saving'
  try {
    const photo = await savePhoto(pending.value, details)
    captureDescription.value=''
    lastPhoto.value = !account.value || photoReadAllowed() ? photo : undefined
    savedWithoutGps.value = !!(photo.profile && photo.profile.rules.location !== 'off' && !photo.metadata?.location)
    if (
      photo.profile &&
      photo.profile.rules.location !== 'off' &&
      photo.metadata?.locationStatus === 'pending'
    ) {
      const remaining = Math.max(
        0,
        photo.createdAt +
          photo.profile!.rules.locationWindow * 1000 -
          Date.now(),
      )
      const timer = setTimeout(() => {
        void finishLocation(photo.id)
      }, remaining)
      waiting.set(photo.id, { timer, owner: account.value?.id, busy: false })
      const location = locationAt(photo.createdAt, photo.profile.rules.locationWindow,
        photo.profile.rules.accuracy)
      if (location) void finishLocation(photo.id, location)
    }
    if (details?.replacesId) selectAssignment(details.assignmentId ?? '')
    const local = details?.uiOnly
    const accountCapture = !!details?.accountId
    releasePending()
    libraryChanged()
    if (!local || accountCapture)
      window.dispatchEvent(new Event('photobunker-outbox'))
    status.value = 'saved'
  } catch {
    status.value = 'saveFailed'
  } finally {
    saving.value = false
  }
}
async function process(allowSmaller = false) {
  if (!rawPending.value || !details) return
  try {
    const originalRules = details.profile?.rules ?? defaultRules()
    const applied = details.uiOnly
      ? imageRules(
          details.profile ?? {
            id: '',
            version: 1,
            name: '',
            description: '',
            rules: originalRules,
          },
          pendingPreset,
          rawPending.value.width,
          rawPending.value.height,
        )
      : originalRules
    const context = details
    const processed = await applyProfile(
      rawPending.value,
      applied,
      details.metadata,
      allowSmaller,
    )
    if (
      !alive ||
      context !== details ||
      context.accountId !== account.value?.id
    )
      return
    pending.value = processed
    rawPending.value = undefined
    sizeError.value = undefined
    pendingUrl.value = URL.createObjectURL(pending.value.blob)
    await persist()
  } catch (error) {
    if (alive) {
      if (error instanceof ResolutionError) sizeError.value = error
      else {
        status.value = 'captureFailed'
        releasePending()
      }
    }
  }
}
async function useAvailable() {
  taking.value = true
  try {
    await process(true)
  } finally {
    taking.value = false
  }
}
async function capture() {
  if (
    !ready.value ||
    taking.value ||
    saving.value ||
    pending.value ||
    rawPending.value ||
    !captureAllowed.value ||
    (activeProfile.value && !canCapture(activeProfile.value))
  )
    return
  if (account.value) {
    try { const prepared=await cachedContext(studioSession.value?.taskId || undefined);checkCapture(prepared.plan,account.value.id) } catch { await prepareCamera(); return }
  }
  taking.value = true
  status.value = undefined
  const captureOwner = account.value?.id
  const profile = activeProfile.value
    ? snapshot(activeProfile.value)
    : undefined
  const settings = profile?.rules ?? defaultRules()
  const createdAt = Date.now()
  const candidate = settings.location === 'off'
    ? undefined : locationAt(createdAt, settings.locationWindow, settings.accuracy)
  const location =
    candidate &&
    Math.abs(candidate.measuredAt - createdAt) <= settings.locationWindow * 1000
      ? candidate
      : undefined
  const metadata: PhotoMetadata = {}
  if (settings.keepDate) metadata.capturedAt = createdAt
  pendingPreset = studioSession.value?.preset
    ? clone(studioSession.value.preset)
    : null
  if (pendingPreset) {
    const time = new Date(createdAt)
    if (pendingPreset.options.date)
      metadata.date = `${time.getFullYear()}-${String(time.getMonth() + 1).padStart(2, '0')}-${String(time.getDate()).padStart(2, '0')}`
    if (pendingPreset.options.time)
      metadata.time = time.toTimeString().slice(0, 8)
  }
  if (settings.keepCamera)
    metadata.camera =
      mode.value === 'demo'
        ? 'PhotoBunker DEMO'
        : controller?.source() || 'Camera'
  if (settings.location !== 'off') {
    if (location) metadata.location = location
    metadata.locationStatus =
      location && location.accuracy <= settings.accuracy
        ? undefined
        : !locationEnabled.value || locationStatus.value === 'unavailable'
          ? 'unavailable'
          : 'pending'
  }
  const seconds = studioSession.value
    ? retentionSeconds(studioSession.value.preset)
    : (settings.retentionSeconds ?? 1209600)
  const retention = uiOnly.value
    ? seconds
      ? {
          retentionSeconds: seconds,
          retentionAnchor: undefined,
          expiresAt: createdAt + seconds * 1000,
        }
      : undefined
    : captureRetention(accessLibraryId.value, createdAt, seconds)
  details = {
    accountId: account.value?.id,
    note:captureDescription.value,
    workspaceAssignmentId: account.value
      ? studioSession.value?.taskId || undefined
      : undefined,
    nameAssignmentId: studioSession.value?.taskId &&
      studioSession.value.rules.useAssignmentPhotoId !== false
      ? studioSession.value.taskId : null,
    uploadOnly:
      account.value && studioSession.value?.taskId
        ? !pendingAccess({
            accountId: account.value.id,
            workspaceAssignmentId: studioSession.value.taskId,
          })
        : false,
    captureContext: uiOnly.value
      ? {
          presetName: profile?.name || s('standard'),
          presetVersion: profile?.version,
          standard: !studioSession.value?.preset,
          teamId: studioSession.value?.teamId,
          teamName: studioSession.value?.teamName,
          author: account.value
            ? { kind: 'account', publicId: account.value.publicId }
            : { kind: 'device' },
        }
      : undefined,
    profile,
    createdAt,
    metadata,
    category: category.value,
    shot: shot.value,
    libraryId: account.value ? '' : accessLibraryId.value,
    assignmentId: activeAssignment.value?.id,
    replacesId: replacesId.value || undefined,
    retention,
    initialCapture: !uiOnly.value && !profile && !retention?.retentionAnchor,
    uiOnly: uiOnly.value,
    uiAssignmentId: studioSession.value?.taskId || undefined,
    uiTaskRevision: studioSession.value?.taskRevision || undefined,
    uiRules: studioSession.value?.rules
      ? {
          descriptionRequired: studioSession.value.rules.descriptionRequired,
          minLength: studioSession.value.rules.minLength,
          particularCategory: studioSession.value.rules.particularCategory,
        }
      : undefined,
  }
  try {
    const result =
      mode.value === 'demo'
        ? await captureDemo(demo.value!)
        : await controller!.capture()
    if (alive && captureOwner === account.value?.id) {
      rawPending.value = result
      await process()
    }
  } catch {
    if (alive) {
      releasePending()
      status.value = 'captureFailed'
    }
  } finally {
    taking.value = false
  }
}
function discard() {
  releasePending()
  status.value = undefined
}
function pause() {
  if (document.hidden) {
    stop()
    if(account.value)captureDescription.value=''
    if(account.value&&pendingUrl.value){URL.revokeObjectURL(pendingUrl.value);pendingUrl.value=''}
    status.value = 'cameraPaused'
  }
}
function pagehide() {
  stop()
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (pending.value || rawPending.value || saving.value) {
    event.preventDefault()
    event.returnValue = ''
  }
}
onMounted(async () => {
  if (account.value) void warmNames(studioSession.value?.taskId && studioSession.value.rules.useAssignmentPhotoId !== false ? studioSession.value.taskId : null).catch(() => {})
  unsubscribeLocation = subscribeLocation(locationChanged)
  controller = cameraController(video.value!)
  window.addEventListener('online', connectionChanged)
  window.addEventListener('offline', connectionChanged)
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure)
    if (stage.value) observer.observe(stage.value)
  }
  measure()
  document.addEventListener('visibilitychange', pause)
  window.addEventListener('pagehide', pagehide)
  window.addEventListener('beforeunload', beforeUnload)
  void refreshClock(true).catch(() => {})
  await Promise.all([refreshProfiles(), refreshAssignments(), loadStudio()])
  if (alive) void prepareCamera()
  if (
    route.query.shot &&
    requiredShots.value.includes(String(route.query.shot))
  )
    shot.value = String(route.query.shot)
  if (alive && activeProfile.value && !canCapture(activeProfile.value))
    await router.replace('/camera/presets')
})
watch(
  () =>
    `${activeProfile.value?.id ?? ''}|${activeProfile.value?.access?.role ?? ''}|${studioSession.value?.taskId ?? ''}`,
  () => {
    stop()
    category.value = studioSession.value?.category ?? selectedCategory.value
    shot.value = ''
  },
)
watch(
  [() => account.value?.id, () => studioSession.value?.taskId,
    () => studioSession.value?.rules.useAssignmentPhotoId],
  () => {
    if (account.value)
      void warmNames(studioSession.value?.taskId &&
        studioSession.value.rules.useAssignmentPhotoId !== false
          ? studioSession.value.taskId : null).catch(() => {})
  },
)
watch(category, (value) => {
  updateSessionCategory(value)
})
// An opt-out applies to in-flight late fixes too, not just future captures.
watch(locationEnabled, enabled => {
  if (!enabled) for (const id of waiting.keys()) void finishLocation(id)
  locationChanged()
})
watch(mode, () => {
  void nextTick(measure)
})
watch(
  () => account.value?.id,
  () => {
    stop()
    releasePending()
    lastPhoto.value = undefined
  },
)
watch([()=>account.value?.id,()=>studioSession.value?.taskId], () => { void prepareCamera() })
watch(photoReadAllowed, (allowed) => { if (!allowed) lastPhoto.value = undefined })
onBeforeRouteLeave(() => {
  if (saving.value || taking.value) return false
  return !(pending.value || rawPending.value) || confirm(t('discardQuestion'))
})
onBeforeUnmount(() => {
  alive = false
  unsubscribeLocation?.()
  unsubscribeLocation = undefined
  stop()
  releasePending()
  waiting.forEach((job) => clearTimeout(job.timer))
  observer?.disconnect()
  window.dispatchEvent(
    new CustomEvent('photobunker-privacy-screen', { detail: false }),
  )
  window.removeEventListener('online', connectionChanged)
  window.removeEventListener('offline', connectionChanged)
  document.removeEventListener('visibilitychange', pause)
  window.removeEventListener('pagehide', pagehide)
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>
<template>
  <section
    v-show="!quickHidden"
    class="native-camera"
    :data-protection="account&&protectionEnabled?'encrypted':'prototype'"
    :aria-label="s('camera')"
  >
    <ScreenHeader :title="s('camera')"
      ><button
        class="app-icon-button"
        :aria-label="s('grid')"
        :aria-pressed="showGrid"
        @click="showGrid = !showGrid"
      >
        <AppIcon name="grid" /></button
      ><button
        class="app-icon-button"
        :aria-label="t('cameraFlip')"
        :disabled="mode !== 'live' || starting || saving || taking"
        @click="flip"
      >
        <AppIcon name="flip" /></button
      ><button
        v-if="mode === 'live'"
        class="app-icon-button"
        :aria-label="s('cameraSettings')"
        @click="hardwareOpen = true"
      >
        <AppIcon name="settings" /></button
      ><button
        class="app-icon-button"
        :aria-label="s('quickExit')"
        @click="hide"
      >
        <AppIcon name="eye-off" /></button
    ></ScreenHeader>
    <div class="camera-status-row">
      <button class="camera-state-chip" @click="infoOpen = true">
        <AppIcon :name="'device'" />{{
          connectionOffline
            ? s('offline')
            : account
              ? accountPending
                ? `${s('unsent')} · ${accountPending}`
                : w('account')
              : uiOnly
                ? s('device')
                : delivery.pending
                  ? `${s('unsent')} · ${delivery.pending}`
                  : s('device')
        }}</button
      ><button
        v-if="studioSession?.taskId || activeAssignment"
        class="camera-task-chip"
        @click="infoOpen = true"
      >
        {{ studioSession?.taskName || activeAssignment?.name }}</button
      ><span
        v-if="mode !== 'off' && rules.location !== 'off' && locationEnabled"
        class="camera-gps-state"
        >{{
          locationStatus
            ? s(locationStatus === 'pending' ? 'gpsPending' : 'gpsUnavailable')
            : 'GPS'
        }}</span
      ><button
        v-if="mode !== 'off' && rules.location !== 'off' && locationEnabled &&
          locationState === 'permission' && !!account"
        type="button" class="quiet-button" @click="enableCameraLocation"
        >{{ locationText('enable') }}</button
      >
    </div>
    <div ref="stage" class="camera-preview-stage">
      <div
        :class="['viewfinder', { 'viewfinder-live': mode !== 'off' }]"
        :style="frameStyle"
      >
        <video
          ref="video"
          v-show="mode === 'live'"
          class="camera-video"
          :class="{ mirrored: facing === 'user' }"
          :style="{ objectFit: rules.fit === 'contain' ? 'contain' : 'cover' }"
          muted
          playsinline
          @loadeddata="
            () => {
              ready = true
              sourceRatio = video!.videoWidth / video!.videoHeight
              measure()
            }
          "
          :aria-label="q('Предпросмотр камеры')"
        /><canvas
          ref="demo"
          v-show="mode === 'demo'"
          class="camera-video"
          :style="{ objectFit: rules.fit === 'contain' ? 'contain' : 'cover' }"
        />
        <span v-if="mode === 'demo'" class="camera-demo-tag">{{ q('ДЕМО') }}</span>
        <div
          v-if="showGrid && mode !== 'off'"
          class="viewfinder-grid"
          aria-hidden="true"
        />
        <div v-if="mode === 'off'" class="camera-message">
          <span class="camera-emblem"><AppIcon name="camera" /></span>
          <p class="supporting-copy">
            {{
              localPrototype ? t('cameraDescription') : t('prototypeDisabled')
            }}
          </p>
          <div v-if="localPrototype" class="camera-start-actions">
            <button
              class="primary-button"
              :disabled="starting || saving || taking || !captureAllowed"
              @click="start"
            >
              {{ t(starting ? 'cameraStarting' : 'enableCamera') }}</button
            ><button
              class="quiet-button"
              :disabled="starting || saving || taking || !captureAllowed"
              @click="showDemo"
            >
              {{ t('tryDemo') }}
            </button>
          </div>
        </div>
        <div v-if="pendingUrl" class="pending-capture">
          <img :src="pendingUrl" alt="" /><span>{{
            t(saving ? 'saving' : 'saveFailed')
          }}</span>
        </div>
      </div>
    </div>
    <div class="native-camera-controls">
      <p class="camera-format">
        {{
          rules.aspect === 'native'
            ? s('native')
            : rules.aspect === 'custom'
              ? `${rules.aspectWidth}:${rules.aspectHeight}`
              : rules.aspect
        }}<span v-if="studioSession?.preset">
          ·
          {{
            s(
              studioSession.preset.options.size === 'custom'
                ? 'custom'
                : studioSession.preset.options.size,
            )
          }}</span
        >
      </p>
      <div class="capture-controls">
        <button
          class="camera-context-button"
          :aria-label="s('preset')"
          :disabled="saving || taking || !!pending || !!rawPending"
          @click="presetOpen = true"
        >
          <AppIcon name="settings" /><span>{{
            activeProfile?.name || s('standard')
          }}</span></button
        ><button
          class="shutter"
          :disabled="
            !localPrototype ||
            (activeProfile && !canCapture(activeProfile)) ||
            !captureAllowed ||
            mode === 'off' ||
            !ready ||
            starting ||
            taking ||
            saving ||
            !!pending ||
            !!rawPending
          "
          :aria-label="t('capture')"
          :aria-busy="saving || taking"
          @click="capture"
        >
          <span /></button
        ><button
          class="camera-context-button"
          :aria-label="s('category')"
          :disabled="saving || taking || !!pending || !!rawPending"
          @click="contextOpen = true"
        >
          <AppIcon name="filter" /><span>{{
            category || shot || s('category')
          }}</span>
        </button>
      </div>
      <p v-if="cameraPreparing" class="capture-feedback" role="status">{{ q('Готовим съёмку…') }}</p>
      <div v-if="cameraError" class="form-error" role="alert">
        <p>{{ cameraError }}</p>
        <button class="secondary-button" :disabled="cameraPreparing" @click="prepareCamera()">{{ t('retry') }}</button>
        <button v-if="cameraNeedsReview" class="secondary-button" @click="cameraReview = true">{{ q('Проверить участников') }}</button>
      </div>
      <p v-if="status" class="capture-feedback" role="status">
        {{ t(status)
        }}<span v-if="status === 'saved' && lastPhoto">
          · {{ lastPhoto.shortId || nameText('pending') }}</span
        ><span v-if="status === 'saved' && savedWithoutGps">
          · {{ locationText('photoWithoutGps') }}</span
        >
      </p>
      <p v-else class="capture-note">
        {{ account ? q('Снимок сохраняется на устройстве и синхронизируется с аккаунтом при наличии сети.') : uiOnly ? s('localShort') : t('captureNote') }}
      </p>
      <div v-if="pending && !saving" class="inline-actions">
        <button class="primary-button" @click="persist">{{ t('retry') }}</button
        ><button class="quiet-button" @click="discard">
          {{ t('discard') }}
        </button>
      </div>
    </div>
    <AppSheet :open="cameraReview && !!planReview" :title="q('Участники общей съёмки')" :busy="cameraPreparing" @close="cameraReview = false">
      <p>{{ q('Эти участники получат доступ к снимкам в соответствии с правами задания. Сверьте их перед подтверждением.') }}</p>
      <p v-for="member in planReview?.members" :key="member.accountId"><strong>{{ member.publicId }}</strong> · {{ participantRole(member.role) }}</p>
      <p v-for="key in untrustedKeys" :key="key.publicId"><strong>{{ key.publicId }}</strong><br /><code>{{ key.fingerprint }}</code></p>
      <button class="primary-button" :disabled="cameraPreparing" @click="prepareCamera(true)">{{ q('Подтвердить участников') }}</button>
    </AppSheet>
    <AppSheet
      :open="hardwareOpen"
      :title="s('cameraSettings')"
      @close="hardwareOpen = false"
      ><div class="native-form">
        <p class="field-hint">
          {{ hardware?.width }} × {{ hardware?.height }} ·
          {{ s(hardware?.still ? 'stillCamera' : 'videoCamera') }}
        </p>
        <label v-if="hardware?.zoom"
          >{{ s('zoom') }} · {{ formatNumber(hardware.zoomValue, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }}×<input
            type="range"
            :min="hardware.zoom.min"
            :max="hardware.zoom.max"
            :step="hardware.zoom.step || 0.1"
            :value="hardware.zoomValue"
            @change="
              ($event) => {
                configureHardware({
                  zoom: Number(($event.target as HTMLInputElement).value),
                })
              }
            " /></label
        ><button
          v-if="hardware?.torch"
          class="secondary-button"
          :aria-pressed="hardware.torchValue"
          @click="configureHardware({ torch: !hardware?.torchValue })"
        >
          {{ s('torch') }}
        </button>
        <p class="field-hint">{{ s('cameraHardwareHint') }}</p>
        <p v-if="hardwareError" class="form-error" role="alert">
          {{ s('cameraHardwareError') }}
        </p>
      </div></AppSheet
    >
    <AppSheet
      :open="presetOpen"
      :title="s('preset')"
      @close="presetOpen = false"
      ><button class="picker-row" @click="choose()">
        <AppIcon name="camera" /><span>{{ s('standard') }}</span
        ><AppIcon
          v-if="
            !activeProfile ||
            (studioSession && !studioSession.preset && !studioSession.taskId)
          "
          name="check"
        /></button
      ><button
        v-for="preset in presetChoices.filter(
          (item) => !item.archived && canCapture(item),
        )"
        :key="preset.id"
        class="picker-row"
        @click="choose(preset.id)"
      >
        <AppIcon name="settings" /><span>{{ preset.name }}</span
        ><AppIcon v-if="activeProfile?.id === preset.id" name="check" /></button
      ><button
        class="row-add"
        @click="
          () => {
            presetOpen = false
            router.push('/camera/presets')
          }
        "
      >
        <AppIcon name="edit" />{{ s('presets') }}
      </button></AppSheet
    >
    <AppSheet
      :open="contextOpen"
      :title="s('photoData')"
      @close="contextOpen = false"
      ><div class="native-form"><label>{{s('description')}}<textarea v-model="captureDescription" maxlength="2000" :aria-label="s('description')" rows="3"/></label><p v-if="studioSession?.rules.descriptionRequired" class="field-hint">{{s('descriptionRequired')}} · {{studioSession.rules.minLength}}</p></div><div v-if="requiredShots.length" class="native-form">
        <label
          >{{ s('shot')
          }}<select :aria-label="s('shot')" v-model="shot">
            <option value="">{{ s('freeShot') }}</option>
            <option v-for="item in requiredShots" :key="item">
              {{ item }}
            </option>
          </select></label
        >
      </div>
      <div
        v-if="uiOnly && !studioSession?.rules.particularCategory"
        class="native-form"
      >
        <label
          >{{ s('enterCategory')
          }}<input v-model="category" maxlength="80" /></label
        ><button class="primary-button" @click="contextOpen = false">
          {{ s('done') }}
        </button>
      </div>
      <div class="category-picker">
        <button
          class="picker-row"
          @click="
            () => {
              category = ''
              contextOpen = false
            }
          "
        >
          <span>{{ s('noCategory') }}</span
          ><AppIcon v-if="!category" name="check" /></button
        ><button
          v-for="item in categoryOptions"
          :key="item"
          class="picker-row"
          @click="
            () => {
              category = item
              contextOpen = false
            }
          "
        >
          <span>{{ item }}</span
          ><AppIcon v-if="category === item" name="check" /></button
        ><button
          v-if="
            !studioSession?.taskId || !studioSession.rules.particularCategory
          "
          class="row-add"
          @click="editCategories"
        >
          <AppIcon name="edit" />{{ s('editCategories') }}
        </button>
      </div></AppSheet
    >
    <AppSheet
      :open="categoryEdit"
      :title="s('categories')"
      @close="categoryEdit = false"
      ><form class="native-form" @submit.prevent="saveCategories">
        <label
          >{{ s('categories')
          }}<textarea
            v-model="categoriesText"
            rows="6"
            maxlength="2430"
            :placeholder="s('onePerLine')"
          />
        </label>
        <p class="field-hint">{{ s('globalCategories') }}</p>
        <p v-if="categorySaveError" class="form-error" role="alert">
          {{ s('failed') }}
        </p>
        <button class="primary-button full-button">{{ s('done') }}</button>
      </form></AppSheet
    >
    <AppSheet :open="infoOpen" :title="s('info')" @close="infoOpen = false"
      ><p v-if="uiOnly" class="field-hint">
        {{ account ? w('taskHint') : s('localShort') }}
      </p>
      <p class="field-hint">{{ protectionEnabled ? q('Фотографии шифруются на устройстве. Камера и геолокация зависят от разрешений браузера.') : t('prototypeNote') }}</p>
      <p v-if="studioSession?.taskId" class="task-instructions">
        {{
          localTasks.find((item) => item.id === studioSession?.taskId)
            ?.instructions
        }}
      </p>
      <p v-if="activeAssignment" class="task-instructions">
        {{ activeAssignment.instructions }}
      </p>
      <p v-if="locationStatus">
        {{ s(locationStatus === 'pending' ? 'gpsPending' : 'gpsUnavailable') }}
      </p>
      <button
        v-if="delivery.pending"
        class="secondary-button full-button"
        @click="retryDelivery"
      >
        {{ d('retry') }} · {{ delivery.pending }}</button
      ><button
        v-if="studioSession?.taskId || activeAssignment"
        class="row-add"
        @click="
          () => {
            infoOpen = false
            selectAssignment('')
            choosePreset(null)
            stop()
          }
        "
      >
        {{ c('clearTask') }}
      </button></AppSheet
    >
    <AppSheet
      :open="!!sizeError"
      :title="p('resolutionLimited')"
      :busy="taking"
      @close="discard"
      ><template v-if="sizeError"
        ><p>{{ sizeError.width }} × {{ sizeError.height }}</p>
        <p class="field-hint">{{ p('resolutionHint') }}</p>
        <button
          class="primary-button full-button"
          :disabled="taking"
          @click="useAvailable"
        >
          {{ p('useAvailable') }}</button
        ><button class="quiet-button full-button" @click="discard">
          {{ t('discard') }}
        </button></template
      ></AppSheet
    >
  </section>
  <section v-if="quickHidden" class="quick-exit-screen">
    <AppIcon name="eye-off" />
    <h1>{{ s('hidden') }}</h1>
    <p>{{ s('hiddenHint') }}</p>
    <p v-if="delivery.pending">{{ s('unsent') }} · {{ delivery.pending }}</p>
    <button class="secondary-button" @click="resume">{{ s('resume') }}</button>
  </section>
</template>
