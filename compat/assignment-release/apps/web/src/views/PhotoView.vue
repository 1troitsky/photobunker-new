<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRoute,
  useRouter,
} from 'vue-router'
import PhotoLinks from '../components/PhotoLinks.vue'
import ReviewPanel from '../components/ReviewPanel.vue'
import { c } from '../collaboration/text'
import { serverPhoto } from '../server/api'
import AppIcon from '../components/AppIcon.vue'
import { locale, t, formatNumber } from '../i18n'
import {
  deletePhoto,
  readPhoto,
  saveOnServer,
  updatePhoto,
  reloadFromServer,
} from '../server/photos'
import { belongsToServer, ServerError } from '../server/api'
import type { Photo } from '../local/photos'
import {
  formatBytes,
  libraryChanged,
  libraryLoading,
  serverError,
  libraryError,
} from '../local/library'
import { missingRequirements } from '../profiles/model'
import { isExpired } from '../delivery/clock'
import { retryDelivery } from '../delivery/queue'
import { d } from '../delivery/text'
import { photos } from '../local/library'
import { p, type ProfileText } from '../profiles/text'
import ScreenHeader from '../components/ScreenHeader.vue'
import AppSheet from '../components/AppSheet.vue'
import { account } from '../identity/store'
import { photo as workspacePhoto } from '../workspace/api'
import { w } from '../workspace/text'
import { s } from '../studio/text'
import PhotoDetailsFields from '../components/PhotoDetailsFields.vue'
import {
  detailsFor,
  detailsDirty,
  detailsChanges,
  PhotoDetailsError,
} from '../studio/details'
import {
  capturePresetLabel,
  internalAuthor,
  externalPhotoData,
} from '../studio/disclosure'
import { downloadFile, externalPhotoFile, shareFile } from '../studio/export'
import { nameText } from '../local/photo-name-text'
import { photoCardText } from '../studio/photo-card-text'
import { photoCardPath } from '../studio/private-photo-card'
import { listPhotoVersions, type PhotoVersion } from '../studio/versions'
const infoOpen = ref(false),
  editDataOpen = ref(false),
  shareOpen = ref(false),
  deleteOpen = ref(false),
  versionsOpen = ref(false),
  zoom = ref(false)
const versions = ref<PhotoVersion[]>([]),
  versionId = ref(''),
  versionError = ref('')
const shortenOpen = ref(false),
  deadline = ref('')
function openShorten() {
  infoOpen.value = false
  status.value = undefined
  const time = Math.min(
    photo.value?.expiresAt ?? Infinity,
    Date.now() + 3600000,
  )
  const date = new Date(time)
  deadline.value = new Date(time - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
  shortenOpen.value = true
}
async function shorten() {
  if (!photo.value || busy.value) return
  const time = new Date(deadline.value).getTime()
  if (
    !Number.isFinite(time) ||
    time <= Date.now() ||
    time >= (photo.value.expiresAt ?? Infinity)
  ) {
    status.value = 'changeFailed'
    return
  }
  busy.value = true
  try {
    setPhoto(
      await updatePhoto(
        photo.value.id,
        {
          title: photo.value.title,
          note: photo.value.note,
          favorite: photo.value.favorite,
          expiresAt: time,
        },
        photo.value.remoteRevision,
        photo.value,
      ),
    )
    libraryChanged()
    shortenOpen.value = false
    status.value = 'changesSaved'
  } catch {
    status.value = 'changeFailed'
  } finally {
    busy.value = false
  }
}
const selectedVersion = computed(() =>
  versions.value.find((item) => item.id === versionId.value),
)
const siblings = computed(() =>
  photos.value.filter((item) => !item.uiVersionOf),
)
const position = computed(() =>
  siblings.value.findIndex((item) => item.id === photo.value?.id),
)
function sibling(offset: number) {
  const item = siblings.value[position.value + offset]
  if (item) void router.push(`/gallery/${item.id}`)
}
async function syncVersions() {
  if (!photo.value || busy.value) return
  busy.value = true
  versionError.value = ''
  try {
    versions.value = await listPhotoVersions(photo.value)
    showVersion(versionId.value)
  } catch {
    versionError.value = s('linkError')
  } finally {
    busy.value = false
  }
}
function showVersion(id: string) {
  versionId.value = id
  if (url.value) URL.revokeObjectURL(url.value)
  const blob = id ? selectedVersion.value?.blob : original.value
  if (id && !blob) versionError.value = s('versionUnavailable')
  url.value = blob ? URL.createObjectURL(blob) : ''
  versionsOpen.value = false
}
function closeData() {
  if (!busy.value && (!dirty.value || confirm(s('leave')))) {
    if (photo.value) setPhoto(photo.value)
    editDataOpen.value = false
  }
}
const publicPreview = ref(false),
  publicUrl = ref(''),
  publicFile = ref<File>(),
  dataError = ref('')
const publicDetails = computed(() =>
  photo.value ? externalPhotoData(photo.value) : undefined,
)
const author = computed(() =>
  photo.value ? internalAuthor(photo.value) : undefined,
)
async function share() {
  if (!photo.value || busy.value || !original.value || !canShare.value) return
  busy.value = true
  const source = photo.value
  try {
    if (versionId.value && !selectedVersion.value)
      throw new Error('version.unavailable')
    const file = await externalPhotoFile(
      source,
      selectedVersion.value?.blob ?? original.value,
    )
    const latest = (await readPhoto(source.id)).photo
    if (latest.workspaceAccess && !latest.workspaceAccess.shareExternal)
      throw new Error('Sharing unavailable')
    if (photo.value?.id !== source.id) return
    releasePublic()
    publicFile.value = file
    publicUrl.value = URL.createObjectURL(file)
    shareOpen.value = true
  } catch {
    status.value = 'changeFailed'
  } finally {
    busy.value = false
  }
}
async function sendFile() {
  if (!publicFile.value || !photo.value) return
  if (isExpired(photo.value)) {
    shareOpen.value = false
    return
  }
  try {
    if (!(await verifySharing()) || !publicFile.value) return
    const result = await shareFile(publicFile.value)
    if (result === 'shared') shareOpen.value = false
    else if (result === 'download') downloadFile(publicFile.value!)
  } catch {
    status.value = 'changeFailed'
  }
}
function releasePublic() {
  if (publicUrl.value) URL.revokeObjectURL(publicUrl.value)
  publicUrl.value = ''
  publicFile.value = undefined
  publicPreview.value = false
}
watch(shareOpen, (open) => {
  if (!open) releasePublic()
})
let touchX = 0

const route = useRoute()
const router = useRouter()
const photo = ref<Photo>()
const original = ref<Blob>()
const url = ref('')
const data = ref(detailsFor())
const loading = ref(true)
const busy = ref(false)
const deleted = ref(false)
const status = ref<Parameters<typeof t>[0]>()
const dirty = computed(() => detailsDirty(photo.value, data.value))
const missing = computed(() =>
  photo.value ? missingRequirements(photo.value) : [],
)
const requirementLabels: Record<string, ProfileText> = {
  description: 'missingDescription',
  category: 'missingCategory',
  location: 'missingLocation',
  resolution: 'missingResolution',
}
const onServer = computed(
  () =>
    !!photo.value &&
    (!!photo.value.accountId || belongsToServer(photo.value)) &&
    photo.value.remoteRevision !== undefined,
)
const canEdit = computed(() =>
  photo.value?.workspaceAccess
    ? photo.value.workspaceAccess.edit
    : photo.value?.access?.role !== 'viewer',
)
const canDelete = computed(() =>
  photo.value?.workspaceAccess
    ? photo.value.workspaceAccess.delete
    : canEdit.value,
)
const canShare = computed(() =>
  photo.value?.workspaceAccess
    ? photo.value.workspaceAccess.shareExternal
    : !photo.value?.thumbnailOnly,
)
const canReference = computed(() => !!photo.value?.workspaceAccess?.share)
const metadataBusy = computed(() => busy.value || !canEdit.value)
let generation = 0
function release() {
  shareOpen.value = false
  releasePublic()
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = ''
  original.value = undefined
  versions.value = []
  versionId.value = ''
  zoom.value = false
}
watch(
  () => route.params.id,
  async (id) => {
    const current = ++generation
    release()
    versionError.value = ''
    photo.value = undefined
    loading.value = true
    status.value = undefined
    try {
      const result = await readPhoto(String(id))
      if (current !== generation) return
      photo.value = result.photo
      original.value = result.blob
      url.value = URL.createObjectURL(result.blob)
      data.value = detailsFor(result.photo)
      const availableVersions = await listPhotoVersions(result.photo).catch(
        () => {
          versionError.value = s('linkError')
          return []
        },
      )
      if (current !== generation) return
      versions.value = availableVersions
      showVersion(String(route.query.version ?? ''))
    } catch {
      /* Missing/evicted/denied data must not be shown as an empty photo. */
    } finally {
      if (current === generation) loading.value = false
    }
  },
  { immediate: true },
)

function setPhoto(value: Photo) {
  photo.value = value
  data.value = detailsFor(value)
}
watch(
  () => account.value?.id,
  () => {
    if (photo.value?.accountId) {
      generation++
      release()
      photo.value = undefined
    }
  },
)
watch(photos, (rows) => {
  if (!photo.value) return
  const current = rows.find((item) => item.id === photo.value!.id)
  if (current) {
    if (current.workspaceAccess && !current.workspaceAccess.shareExternal) {
      shareOpen.value = false
      releasePublic()
    }
    if (current.thumbnailOnly && !photo.value.thumbnailOnly) {
      const version = ++generation
      release()
      editDataOpen.value = false
      infoOpen.value = false
      setPhoto(current)
      void readPhoto(current.id)
        .then((result) => {
          if (version === generation) {
            photo.value = result.photo
            original.value = result.blob
            url.value = URL.createObjectURL(result.blob)
          }
        })
        .catch(() => {
          if (version === generation) photo.value = undefined
        })
      return
    }
    if (current.expiresAt !== undefined)
      photo.value.expiresAt = Math.min(
        photo.value.expiresAt ?? Infinity,
        current.expiresAt,
      )
    if (!dirty.value && !busy.value) setPhoto(current)
  } else if (
    !libraryLoading.value &&
    !serverError.value &&
    !libraryError.value
  ) {
    release()
    photo.value = undefined
  }
})
const expiryTimer = setInterval(() => {
  if (photo.value && isExpired(photo.value)) {
    release()
    photo.value = undefined
  }
}, 500)
async function refreshReview() {
  if (!photo.value) return
  try {
    const latest = photo.value.accountId
      ? await workspacePhoto(photo.value.id)
      : await serverPhoto(photo.value.id)
    Object.assign(photo.value, {
      reviewState: latest.reviewState,
      reviewRevision: latest.reviewRevision,
      reviewComment: latest.reviewComment,
      responseComment: latest.responseComment,
    })
    libraryChanged()
  } catch {
    status.value = 'changeFailed'
  }
}
async function reload() {
  if (!photo.value || busy.value || !confirm(d('reload') + '?')) return
  busy.value = true
  try {
    setPhoto(await reloadFromServer(photo.value.id))
    libraryChanged()
  } catch {
    status.value = 'changeFailed'
  } finally {
    busy.value = false
  }
}

async function save() {
  if (!photo.value || busy.value) return
  busy.value = true
  status.value = undefined
  dataError.value = ''
  try {
    setPhoto(
      await updatePhoto(
        photo.value.id,
        detailsChanges(photo.value, data.value),
        photo.value.remoteRevision,
        photo.value,
      ),
    )
    libraryChanged()
    status.value = 'changesSaved'
    editDataOpen.value = false
  } catch (error) {
    dataError.value =
      error instanceof ServerError
        ? t(error.status === 409 ? 'changeConflict' : 'changeFailed')
        : error instanceof PhotoDetailsError
          ? error.message
          : s('failed')
  } finally {
    busy.value = false
  }
}
async function favorite() {
  if (!photo.value || busy.value) return
  busy.value = true
  status.value = undefined
  try {
    photo.value = await updatePhoto(
      photo.value.id,
      {
        title: photo.value.title,
        note: photo.value.note,
        favorite: !photo.value.favorite,
      },
      photo.value.remoteRevision,
      photo.value,
    )
    libraryChanged()
  } catch (error) {
    status.value =
      error instanceof ServerError && error.status === 409
        ? 'changeConflict'
        : 'changeFailed'
  } finally {
    busy.value = false
  }
}
async function remove() {
  if (!photo.value || busy.value) return
  busy.value = true
  status.value = undefined
  try {
    await deletePhoto(photo.value.id)
    deleted.value = true
    libraryChanged()
    await router.replace('/gallery')
  } catch {
    status.value = 'deleteFailed'
  } finally {
    busy.value = false
  }
}
async function upload() {
  if (!photo.value || busy.value || dirty.value) return
  busy.value = true
  status.value = 'serverUploading'
  try {
    photo.value = await saveOnServer(photo.value.id)
    libraryChanged()
    status.value = 'serverSaved'
  } catch {
    photo.value.uploadRequested = true
    libraryChanged()
    status.value = 'serverUploadFailed'
  } finally {
    busy.value = false
  }
}
async function verifySharing() {
  const source = photo.value
  if (!source || isExpired(source)) return false
  if (!source.accountId) return true
  const latest = await workspacePhoto(source.id)
  if (photo.value?.id !== source.id || !latest.workspaceAccess?.shareExternal) {
    shareOpen.value = false
    releasePublic()
    return false
  }
  return true
}
async function download() {
  try {
    if (!publicFile.value || !(await verifySharing()) || !publicFile.value)
      return
    downloadFile(publicFile.value)
  } catch {
    status.value = 'changeFailed'
  }
}
function canLeave() {
  return (
    deleted.value ||
    (!busy.value &&
      (!dirty.value ||
        window.confirm(
          locale.value === 'ru'
            ? 'Изменения не сохранены. Уйти без сохранения?'
            : 'Changes are not saved. Leave without saving?',
        )))
  )
}
onBeforeRouteLeave(canLeave)
onBeforeRouteUpdate(canLeave)
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || busy.value) {
    event.preventDefault()
    event.returnValue = ''
  }
}
window.addEventListener('beforeunload', beforeUnload)
onBeforeUnmount(() => {
  clearInterval(expiryTimer)
  generation++
  release()
  releasePublic()
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>

<template>
  <section
    class="native-screen native-photo-view"
    tabindex="0"
    @keydown.left="sibling(-1)"
    @keydown.right="sibling(1)"
  >
    <ScreenHeader
      :title="photo?.title || photo?.shortId || (photo?.needsName ? nameText('pending') : s('photo'))"
      back="/gallery"
      ><button
        v-if="photo"
        class="app-icon-button"
        :aria-label="s('favorites')"
        :aria-pressed="photo.favorite"
        :disabled="metadataBusy"
        @click="favorite"
      >
        <AppIcon name="star" /></button
      ><button
        v-if="versions.length || photo?.encrypted"
        class="app-icon-button"
        :aria-label="s('versions')"
        @click="versionsOpen = true"
      >
        <AppIcon name="copy" /></button
    ></ScreenHeader>
    <p v-if="loading" class="loading-state screen-body" role="status">
      {{ t('loading') }}
    </p>
    <div v-else-if="!photo" class="native-empty">
      <AppIcon name="gallery" />
      <h2>{{ t('photoUnavailable') }}</h2>
      <p>{{ t('photoUnavailableHint') }}</p>
    </div>
    <template v-else
      ><div
        :class="['photo-view-stage', { 'photo-zoomed': zoom }]"
        @touchstart.passive="touchX = $event.touches[0]?.clientX ?? 0"
        @touchend.passive="
          ($event) => {
            !zoom &&
              Math.abs(($event.changedTouches[0]?.clientX ?? touchX) - touchX) >
                80 &&
              sibling(
                ($event.changedTouches[0]?.clientX ?? touchX) > touchX ? -1 : 1,
              )
          }
        "
      >
        <img
          v-if="url"
          :src="url"
          :alt="photo.title || s('photo')"
          decoding="async"
          @dblclick="zoom = !zoom"
        />
      </div>
      <p v-if="versionError" class="form-error" role="alert">
        {{ versionError }}
      </p>
      <p v-if="photo.thumbnailOnly" class="field-hint">
        {{ w('thumbnailOnly') }}
      </p>
      <div class="photo-context-caption">
        <span>{{ s('capturePreset') }}: {{ capturePresetLabel(photo) }}</span
        ><span v-if="author">{{ s('author') }}: {{ author }}</span>
      </div>
      <div class="photo-view-caption">
        <span
          >{{ selectedVersion ? s('version') : s('compare')
          }}<template v-if="selectedVersion">
            {{
              versions.findIndex((item) => item.id === versionId) + 1
            }}</template
          ></span
        ><span>{{ photo.category || photo.shot || photo.shortId }}</span>
      </div>
      <div v-if="siblings.length > 1" class="photo-pagination">
        <button
          class="app-icon-button"
          :disabled="position <= 0"
          :aria-label="s('back')"
          @click="sibling(-1)"
        >
          <AppIcon name="back" /></button
        ><span>{{ formatNumber(position + 1) }} / {{ formatNumber(siblings.length) }}</span
        ><button
          class="app-icon-button"
          :disabled="position >= siblings.length - 1"
          :aria-label="s('next')"
          @click="sibling(1)"
        >
          <AppIcon name="arrow" />
        </button>
      </div>
      <p v-if="status" class="capture-feedback photo-status" role="status">
        {{ t(status) }}
      </p>
      <div class="photo-action-bar">
        <button v-if="photo" type="button" @click="router.push(photoCardPath(photo.id))">
          <AppIcon name="profiles" /><span>{{ photoCardText('card') }}</span>
        </button>
        <button
          v-if="canEdit"
          :disabled="busy"
          @click="
            () => {
              if (!photo) return
              router.push(
                `/gallery/${photo.id}/edit${versionId ? `?version=${versionId}` : ''}`,
              )
            }
          "
        >
          <AppIcon name="edit" /><span>{{ s('edit') }}</span></button
        ><button v-if="canShare" :disabled="busy" @click="share">
          <AppIcon name="share" /><span>{{ s('share') }}</span></button
        ><button
          v-if="canEdit"
          @click="
            () => {
              dataError = ''
              editDataOpen = true
            }
          "
        >
          <AppIcon name="info" /><span>{{ s('photoData') }}</span></button
        ><button
          v-if="photo.workspaceAssignmentId && canReference"
          @click="
            () => {
              if (!photo) return
              router.push({
                path: '/messages',
                query: {
                  assignment: photo.workspaceAssignmentId,
                  photo: photo.id,
                },
              })
            }
          "
        >
          <AppIcon name="messages" /><span>{{
            w('discussPhoto')
          }}</span></button
        ><button @click="infoOpen = true">
          <AppIcon name="info" /><span>{{ s('info') }}</span></button
        ><button
          v-if="canDelete"
          class="subtle-danger"
          :disabled="busy"
          @click="deleteOpen = true"
        >
          <AppIcon name="trash" /><span>{{ s('remove') }}</span>
        </button>
      </div></template
    >
    <AppSheet
      :open="infoOpen && !!photo"
      :title="s('details')"
      @close="infoOpen = false"
      ><template v-if="photo"
        ><p v-if="photo.note" class="photo-note">{{ photo.note }}</p>
        <div v-if="missing.length" class="requirement-chips">
          <span
            >{{ s('incomplete') }}:
            {{
              missing.map((item) => p(requirementLabels[item]!)).join(', ')
            }}</span
          >
        </div>
        <dl class="native-facts">
          <div v-if="photo.shortId || photo.needsName">
            <dt>NAME-ID</dt>
            <dd>{{ photo.shortId || nameText('pending') }}</dd>
          </div>
          <div v-if="photo.category">
            <dt>{{ s('category') }}</dt>
            <dd>{{ photo.category }}</dd>
          </div>
          <div v-if="photo.shot">
            <dt>{{ s('shot') }}</dt>
            <dd>{{ photo.shot }}</dd>
          </div>
          <div v-if="photo.metadata?.capturedAt">
            <dt>{{ s('date') }}</dt>
            <dd>
              {{
                new Intl.DateTimeFormat(locale, {
                  dateStyle: 'short',
                  timeStyle: 'short',
                }).format(photo.metadata.capturedAt)
              }}
            </dd>
          </div>
          <div v-else-if="photo.metadata?.date">
            <dt>{{ s('date') }}</dt>
            <dd>{{ photo.metadata.date }}</dd>
          </div>
          <div v-if="!photo.metadata?.capturedAt && photo.metadata?.time">
            <dt>{{ s('time') }}</dt>
            <dd>{{ photo.metadata.time }}</dd>
          </div>
          <div>
            <dt>{{ s('resolution') }}</dt>
            <dd>
              {{ selectedVersion?.width ?? photo.width }} ×
              {{ selectedVersion?.height ?? photo.height }}
            </dd>
          </div>
          <div>
            <dt>{{ t('fileSize') }}</dt>
            <dd>
              {{ formatBytes(selectedVersion?.blob.size ?? photo.bytes) }}
            </dd>
          </div>
          <div v-if="photo.metadata?.camera">
            <dt>{{ s('cameraInfo') }}</dt>
            <dd>{{ photo.metadata.camera }}</dd>
          </div>
          <div>
            <dt>{{ s('capturePreset') }}</dt>
            <dd>{{ capturePresetLabel(photo) }}</dd>
          </div>
          <div v-if="author">
            <dt>{{ s('author') }}</dt>
            <dd>{{ author }}</dd>
          </div>
          <div>
            <dt>{{ s('expires') }}</dt>
            <dd>
              {{
                photo.expiresAt
                  ? new Intl.DateTimeFormat(locale, {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }).format(photo.expiresAt)
                  : s('noExpiry')
              }}
            </dd>
          </div>
          <div>
            <dt>{{ s('location') }}</dt>
            <dd>
              {{
                photo.metadata?.location
                  ? `${photo.metadata.location.latitude.toFixed(5)}, ${photo.metadata.location.longitude.toFixed(5)}`
                  : photo.metadata?.locationStatus
                    ? s(
                        photo.metadata.locationStatus === 'pending'
                          ? 'gpsPending'
                          : 'gpsUnavailable',
                      )
                    : s('locationOff')
              }}
            </dd>
          </div>
          <div v-if="photo.metadata?.location?.source === 'manual'">
            <dt>{{ s('location') }}</dt>
            <dd>{{ s('manualLocation') }}</dd>
          </div>
          <div
            v-if="
              photo.metadata?.location &&
              photo.metadata.location.source !== 'manual'
            "
          >
            <dt>{{ s('accuracy') }}</dt>
            <dd>± {{ Math.round(photo.metadata.location.accuracy) }} m</dd>
          </div>
          <div v-if="photo.tags?.length">
            <dt>{{ s('tags') }}</dt>
            <dd>{{ photo.tags.join(', ') }}</dd>
          </div>
        </dl>
        <p
          v-if="
            photo.workspaceAssignmentId || photo.uiAssignmentId || photo.spaceId
          "
          class="field-hint"
        >
          {{ s('privateCapture') }}
        </p>
        <p class="field-hint">
          {{
            photo.accountId
              ? w(photo.uploadRequested ? 'pendingPhotos' : 'received')
              : photo.uiOnly
                ? s('localShort')
                : t(
                    onServer
                      ? 'serverSaved'
                      : photo.uploadRequested
                        ? 'serverPending'
                        : 'browserOnly',
                  )
          }}
        </p>
        <button
          v-if="canEdit"
          class="secondary-button full-button"
          @click="
            () => {
              infoOpen = false
              editDataOpen = true
            }
          "
        >
          <AppIcon name="edit" />{{ s('editData') }}</button
        ><button
          v-if="canEdit"
          class="quiet-button full-button"
          @click="openShorten"
        >
          {{ d('shorten') }}
        </button>
        <div v-if="!photo.uiOnly" class="legacy-delivery-actions">
          <p v-if="photo.uploadError" class="form-error">
            {{ d(photo.uploadError) }}
          </p>
          <button
            v-if="photo.uploadError && photo.uploadError !== 'conflict'"
            class="quiet-button full-button"
            @click="retryDelivery"
          >
            {{ d('retry') }}</button
          ><button
            v-if="photo.uploadError === 'conflict'"
            class="quiet-button full-button"
            @click="reload"
          >
            {{ d('reload') }}</button
          ><button
            v-if="!onServer && !photo.uploadRequested"
            class="quiet-button full-button"
            :disabled="busy || dirty"
            @click="upload"
          >
            {{ t('saveOnServer') }}
          </button>
        </div>
        <section
          v-if="photo.spaceId || photo.workspaceAssignmentId"
          class="photo-review"
        >
          <p class="review-state">{{ c(photo.reviewState ?? 'pending') }}</p>
          <p v-if="photo.reviewComment">{{ photo.reviewComment }}</p>
          <ReviewPanel
            v-if="['owner', 'curator'].includes(photo.access?.role ?? '')"
            :id="photo.id"
            :revision="photo.reviewRevision ?? 1"
            :state="photo.reviewState ?? 'pending'"
            :comment="photo.reviewComment"
            @changed="refreshReview"
          /></section></template
    ></AppSheet>
    <AppSheet
      :open="editDataOpen && !!photo"
      :title="s('editData')"
      :busy="busy"
      @close="closeData"
      ><form v-if="photo" class="native-form" @submit.prevent="save">
        <PhotoDetailsFields v-model="data" :photo="photo" :busy="busy" />
        <p v-if="dataError" class="form-error" role="alert">{{ dataError }}</p>
        <button
          type="submit"
          class="primary-button full-button"
          :disabled="metadataBusy || !dirty"
        >
          {{ s(busy ? 'saving' : 'save') }}
        </button>
      </form></AppSheet
    >
    <AppSheet :open="shareOpen" :title="s('share')" @close="shareOpen = false"
      ><p class="field-hint">{{ s('externalHint') }}</p>
      <p class="field-hint">{{ s('shareHint') }}</p>
      <PhotoLinks
        v-if="
          photo?.encrypted && photo.remoteRevision !== undefined && publicFile
        "
        :key="versionId"
        :photo="photo"
        :blob="publicFile"
        :version-id="versionId || null"
        :pending="!!selectedVersion && selectedVersion.sync !== 'synced'"
      />
      <div class="action-list">
        <button @click="publicPreview = true">
          <AppIcon name="eye-off" />{{ s('externalPreview') }}</button
        ><button @click="sendFile">
          <AppIcon name="share" />{{ s('shareFile') }}</button
        ><button
          @click="
            () => {
              download()
              shareOpen = false
            }
          "
        >
          <AppIcon name="download" />{{ s('export') }}
        </button>
      </div></AppSheet
    >
    <AppSheet
      :open="publicPreview"
      :title="s('externalView')"
      @close="publicPreview = false"
      ><div v-if="publicDetails" class="external-photo-preview">
        <img :src="publicUrl" :alt="s('photo')" />
        <h3 v-if="publicDetails.title">{{ publicDetails.title }}</h3>
        <p v-if="publicDetails.description">{{ publicDetails.description }}</p>
        <p v-if="publicDetails.category">{{ publicDetails.category }}</p>
        <p v-if="publicDetails.expiresAt">
          {{ s('expires') }}:
          {{
            new Intl.DateTimeFormat(locale, {
              dateStyle: 'short',
              timeStyle: 'short',
            }).format(publicDetails.expiresAt)
          }}
        </p>
      </div></AppSheet
    >
    <AppSheet
      :open="shortenOpen"
      :title="d('shorten')"
      :busy="busy"
      @close="shortenOpen = false"
      ><form class="native-form" @submit.prevent="shorten">
        <label
          >{{ d('deadline')
          }}<input v-model="deadline" type="datetime-local" required
        /></label>
        <p class="field-hint">{{ d('shorterOnly') }}</p>
        <p v-if="status" class="form-error" role="alert">{{ t(status) }}</p>
        <button class="primary-button" :disabled="busy">
          {{ d('apply') }}
        </button>
      </form></AppSheet
    >
    <AppSheet
      :open="deleteOpen"
      :title="s('deletePhoto')"
      :busy="busy"
      @close="deleteOpen = false"
      ><p class="field-hint">
        {{ t(onServer ? 'serverDeleteQuestion' : 'deleteQuestion') }}
      </p>
      <div class="sheet-footer">
        <button
          class="secondary-button"
          :disabled="busy"
          @click="deleteOpen = false"
        >
          {{ s('cancel') }}</button
        ><button class="danger-button" :disabled="busy" @click="remove">
          {{ s('remove') }}
        </button>
      </div></AppSheet
    >
    <AppSheet
      :open="versionsOpen"
      :title="s('versions')"
      @close="versionsOpen = false"
      ><p v-if="versionError" class="form-error" role="alert">
        {{ versionError }}
      </p>
      <button
        v-if="photo?.encrypted"
        class="quiet-button"
        :disabled="busy"
        @click="syncVersions"
      >
        {{ s('retryVersions') }}</button
      ><button class="picker-row" @click="showVersion('')">
        <span>{{ s('compare') }}</span
        ><AppIcon v-if="!versionId" name="check" /></button
      ><button
        v-for="(version, i) in versions"
        :key="version.id"
        class="picker-row"
        @click="showVersion(version.id)"
      >
        <span>{{ s('version') }} {{ i + 1 }}</span
        ><AppIcon v-if="versionId === version.id" name="check" /></button
    ></AppSheet>
  </section>
</template>
