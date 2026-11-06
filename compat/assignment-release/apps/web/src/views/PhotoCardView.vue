<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import PrivateLocationMap from '../components/PrivateLocationMap.vue'
import PhotoCardLinks from '../components/PhotoCardLinks.vue'
import PhotoThumbnail from '../components/PhotoThumbnail.vue'
import AppSheet from '../components/AppSheet.vue'
import { photos } from '../local/library'
import { account, sessionState } from '../identity/store'
import { appLockReady, appLocked } from '../app/lock'
import { protectionEnabled, strongUnlocked, warmLocked } from '../crypto/store'
import { readPrivateCardPhoto, privateCardScopeAllowed } from '../studio/photo-card-reader'
import { type PrivatePhotoCard } from '../studio/private-photo-card'
import { publicPhotoCard, publicCardPolicy } from '../studio/public-card-policy'
import { readPhoto } from '../server/photos'
import { externalPhotoFile, downloadFile, copyPhotoImage } from '../studio/export'
import { listPhotoVersions } from '../studio/versions'
import { photoCardText as t } from '../studio/photo-card-text'
import { profilePath } from '../identity/person'
import { formatDate, formatNumber, formatBytes } from '../i18n'
import { localTasks } from '../studio/store'
import { q } from '../crypto/text'
import { usePageIssue, usePageLoad } from '../app/page-load'

const route = useRoute()
const card = ref<PrivatePhotoCard>()
const imageUrl = ref(''), actionBusy = ref(false), actionError = ref(''), disabled = ref(false)
const imageFile = shallowRef<File>()
function releaseImage() { if (imageUrl.value) URL.revokeObjectURL(imageUrl.value); imageUrl.value = ''; imageFile.value = undefined }
function closeWindow() { window.close() }
async function imageAction(copy: boolean) {
  if (!imageFile.value || !visible.value || !canShare.value || actionBusy.value) return
  actionBusy.value = true; actionError.value = ''
  const token = generation
  try {
    const latest = await readPrivateCardPhoto(id.value)
    if (token !== generation || !imageFile.value || !latest.workspaceAccess?.shareExternal || !publicCardPolicy(latest.metadata?.publicCard).enabled) return
    if (copy) await copyPhotoImage(imageFile.value); else downloadFile(imageFile.value)
  }
  catch { if (token === generation) actionError.value = q('Не удалось выполнить действие. Повторите или скачайте изображение.') }
  finally { if (token === generation) actionBusy.value = false }
}
const canShare = ref(false)
const ownerOfCard = ref('')
const loading = ref(false)
usePageLoad(loading)
const error = ref<'offline' | 'denied' | 'locked' | 'unavailable'>()
usePageIssue(() => !!error.value && error.value !== 'locked', {
  detail: () => t(error.value === 'denied' ? 'denied' : error.value === 'offline' ? 'offline' : 'unavailableHint'), retry: load,
})
const expanded = ref(false)
const shareOpen = ref(false)
const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
const now = ref(Date.now())
const id = computed(() => String(route.params.id ?? ''))
const indexedPhoto = computed(() => photos.value.find(item => item.id === id.value))
const visible = computed(() =>
  privateCardScopeAllowed() && ownerOfCard.value === account.value?.id &&
  !!card.value && (card.value.expiresAt === undefined || card.value.expiresAt > now.value)
    ? card.value : undefined)
const assignment = computed(() => localTasks.value.find(item => item.id === visible.value?.assignmentId))
const dateTime = (value: number) => formatDate(value, { dateStyle: 'medium', timeStyle: 'short' })
const coordinates = computed(() => visible.value?.location
  ? visible.value.location.latitude.toFixed(6) + ', ' +
    visible.value.location.longitude.toFixed(6) : '')

let generation = 0
function invalidate() {
  generation++
  releaseImage(); disabled.value = false; actionError.value = ''; actionBusy.value = false
  card.value = undefined
  canShare.value = false
  ownerOfCard.value = ''
  loading.value = false
  error.value = undefined
  expanded.value = false
  shareOpen.value = false
  copyState.value = 'idle'
}
async function load() {
  const token = ++generation, owner = account.value?.id, photoId = id.value
  releaseImage(); disabled.value = false; actionError.value = ''; actionBusy.value = false
  card.value = undefined
  canShare.value = false
  ownerOfCard.value = ''
  error.value = undefined
  copyState.value = 'idle'
  expanded.value = false
  loading.value = true
  try {
    if (!privateCardScopeAllowed()) throw new Error('photo_card.locked')
    const local = photos.value.find(item => item.id === photoId &&
      !item.deleteRequested && (item.expiresAt === undefined || item.expiresAt > Date.now()))
    if (local) {
      if (!publicCardPolicy(local.metadata?.publicCard).enabled) { disabled.value = true; return }
      card.value = publicPhotoCard(local)
      ownerOfCard.value = owner || ''
      canShare.value = local.workspaceAccess?.shareExternal === true
      loading.value = false
    }
    const photo = await readPrivateCardPhoto(photoId)
    if (token !== generation || owner !== account.value?.id ||
        photoId !== id.value || !privateCardScopeAllowed()) return
    if (!publicCardPolicy(photo.metadata?.publicCard).enabled) { releaseImage(); card.value = undefined; disabled.value = true; return }
    const projection = publicPhotoCard(photo)
    ownerOfCard.value = owner || ''
    canShare.value = photo.workspaceAccess?.shareExternal === true
    card.value = projection
    if (photo.workspaceAccess?.read) {
      const versions = await listPhotoVersions(photo)
      const latest = versions.filter(v => !v.conflict && (v.expiresAt === undefined || v.expiresAt > Date.now())).sort((a,b) => b.createdAt-a.createdAt)[0]
      if (versions.length && !latest) throw new Error('version.unavailable')
      const source = latest ? { photo, blob: latest.blob } : await readPhoto(photoId)
      if (token !== generation || owner !== account.value?.id || !privateCardScopeAllowed()) return
      if (!source.photo.workspaceAccess?.read || source.photo.deleteRequested) throw new Error('photo_card.denied')
      imageUrl.value = URL.createObjectURL(source.blob)
      // External actions always strip encoded metadata; never download raw bytes here.
      if (canShare.value) {
        const file = await externalPhotoFile(source.photo, source.blob)
        if (token !== generation || owner !== account.value?.id || !privateCardScopeAllowed()) return
        imageFile.value = file
      }
    }
  } catch (reason) {
    if (token !== generation || owner !== account.value?.id || photoId !== id.value) return
    const message = reason instanceof Error ? reason.message : ''
    const status = (reason as { status?: number } | null)?.status
    error.value = status === 403 || /denied|permission|access/.test(message)
      ? 'denied'
      : status === 404 || status === 410 || /expired|unavailable|deleted|not.found/.test(message)
        ? 'unavailable'
        : /locked|account_changed|cancelled/.test(message) ? 'locked' : 'offline'
    if (error.value !== 'offline') { releaseImage(); card.value = undefined; canShare.value = false }
  } finally {
    if (token === generation) loading.value = false
  }
}
// Flush sync ensures the previous account's content disappears before paint.
watch([id, () => account.value?.id, sessionState, appLockReady, appLocked,
  protectionEnabled, strongUnlocked, warmLocked], () => {
  invalidate()
  if (privateCardScopeAllowed()) void load()
  else error.value = 'locked'
}, { immediate: true, flush: 'sync' })
async function copyCoordinates() {
  if (!visible.value?.location || !coordinates.value) return
  const token = generation, currentOwner = account.value?.id
  const text = coordinates.value
  try {
    await navigator.clipboard.writeText(text)
    if (token === generation && currentOwner === account.value?.id &&
        coordinates.value === text && visible.value?.location) copyState.value = 'copied'
  } catch {
    if (token === generation && currentOwner === account.value?.id) copyState.value = 'failed'
  }
}
const expiry = setInterval(() => {
  now.value = Date.now()
  if (card.value?.expiresAt !== undefined && card.value.expiresAt <= now.value) {
    invalidate()
    error.value = 'unavailable'
  }
}, 1000)
let appliedShareIntent = ''
watch([visible, canShare, () => route.fullPath], () => {
  if ((window.history.state?.openCardShare === true || route.query.share === '1') && visible.value && canShare.value && appliedShareIntent !== route.fullPath) {
    appliedShareIntent = route.fullPath
    window.history.replaceState({ ...window.history.state, openCardShare: false }, '')
    shareOpen.value = true
  }
}, { immediate: true })
onBeforeUnmount(() => { invalidate(); clearInterval(expiry) })
</script>

<template>
  <section class="native-screen photo-card-screen">
    <header class="screen-header public-card-header">
      <span class="screen-monogram" aria-hidden="true">pb</span>
      <div class="screen-title"><h1>Public card</h1></div>
      <div class="screen-actions">
        <button class="app-icon-button" :aria-label="q('Копировать изображение')" :disabled="!imageFile || !canShare || actionBusy" @click="imageAction(true)"><AppIcon name="copy" /></button>
        <button class="app-icon-button" :aria-label="q('Скачать изображение')" :disabled="!imageFile || !canShare || actionBusy" @click="imageAction(false)"><AppIcon name="download" /></button>
        <button class="app-icon-button" :aria-label="q('Поделиться карточкой')" :disabled="!visible || !canShare" @click="shareOpen = true"><AppIcon name="share" /></button>
        <button class="app-icon-button" :aria-label="q('Закрыть')" @click="closeWindow"><AppIcon name="close" /></button>
      </div>
    </header>
    <div class="screen-body photo-card-body">
      <p class="field-hint public-card-preview-label">{{ q('Предпросмотр. Другие увидят карточку только по созданной вами ссылке.') }}</p>
      <p v-if="actionError" class="form-error" role="alert">{{ actionError }}</p>
      <div v-if="disabled" class="native-empty"><AppIcon name="lock" /><h2>{{ q('Public card выключена') }}</h2><p>{{ q('Включите её в параметрах изображения, чтобы создать ссылку.') }}</p></div>
      <div v-else-if="loading && !visible" class="photo-card-loading" role="status" aria-label="Loading">
        <span class="photo-card-loading-image" /><span /><span />
      </div>
      <div v-else-if="!visible" class="native-empty">
        <AppIcon name="lock" />
        <h2>{{ t('unavailable') }}</h2>
        <p role="alert">{{ t(error === 'offline' ? 'offline' :
          error === 'denied' ? 'denied' : error === 'locked' ? 'locked' : 'unavailableHint') }}</p>
        <button class="primary-button" type="button" @click="load">{{ t('retry') }}</button>
      </div>
      <template v-else>
        <div class="photo-card-intro">
          <h2>{{ visible.title || visible.nameId || t('noTitle') }}</h2>
          <p v-if="visible.namePending" class="field-hint" role="status">{{ t('pendingId') }}</p>
        </div>
        <div class="photo-card-image">
          <img v-if="imageUrl" :src="imageUrl" :alt="visible.title || 'Public card'" />
          <PhotoThumbnail v-else :id="visible.id"
            :access-key="indexedPhoto?.accountId ? `${indexedPhoto.remoteRevision}:${indexedPhoto.thumbnailOnly}` : 'card'"
            :expires-at="visible.expiresAt" :alt="visible.title || t('photoCard')" />
        </div>
        <div v-if="visible.description" class="photo-card-caption">
          <p class="photo-card-description">{{ visible.description }}</p>
        </div>
        <div class="photo-card-content">
          <section class="photo-card-section">
            <dl class="native-facts">
              <div>
                <dt>{{ t('expires') }}</dt>
                <dd>{{ visible.expiresAt && Number.isFinite(visible.expiresAt)
                  ? dateTime(visible.expiresAt) : t('noExpiry') }}</dd>
              </div>
              <div v-if="visible.capturedAt">
                <dt>{{ t('captured') }}</dt>
                <dd>{{ dateTime(visible.capturedAt) }}</dd>
              </div>
              <div v-if="visible.editedAt"><dt>{{ q('Дата изменения') }}</dt><dd>{{ dateTime(visible.editedAt) }}</dd></div>
              <div v-if="visible.teamName"><dt>{{ q('Команда') }}</dt><dd>{{ visible.teamName }}</dd></div>
              <div v-if="visible.nameId">
                <dt>{{ q('ID фотографии') }}</dt><dd>{{ visible.nameId }}</dd>
              </div>
              <div v-if="visible.assignmentId">
                <dt>{{ q('Задание') }}</dt>
                <dd><RouterLink :to="`/assignments/${encodeURIComponent(visible.assignmentId)}`">
                  {{ assignment?.name || q('Открыть задание') }}</RouterLink></dd>
              </div>
              <div v-if="visible.author">
                <dt>{{ t('author') }}</dt>
                <dd><RouterLink :to="profilePath(visible.author.publicId)">
                  {{ visible.author.publicId === account?.publicId ? q('Вы') : q('Профиль участника') }}</RouterLink></dd>
              </div>
            </dl>
            <div v-if="visible.tags?.length" class="photo-card-tags">
              <span v-for="tag in visible.tags" :key="tag">#{{ tag }}</span>
            </div>

          </section>
          <section v-if="visible.location" class="photo-card-section">
            <h3>{{ t('location') }}</h3>
            <div class="photo-card-coordinate-row">
              <code>{{ coordinates }}</code>
              <button type="button" class="secondary-button" :aria-label="t('copy')"
                @click="copyCoordinates">
                <AppIcon name="copy" />{{ copyState === 'copied' ? t('copied') : t('copy') }}
              </button>
            </div>
            <p v-if="copyState === 'failed'" class="field-error" role="alert">{{ t('copyError') }}</p>
            <PrivateLocationMap :latitude="visible.location.latitude" :longitude="visible.location.longitude" />
          </section>
          <section v-if="visible.metadata" class="photo-card-section">
            <button type="button" class="photo-card-expand" :aria-expanded="expanded"
              @click="expanded = !expanded">
              <span>{{ t(expanded ? 'hideMetadata' : 'metadata') }}</span>
              <AppIcon name="chevron" />
            </button>
            <dl v-if="expanded" class="native-facts photo-card-technical">
              <div v-if="visible.metadata.camera"><dt>{{ t('camera') }}</dt><dd>{{ visible.metadata.camera }}</dd></div>
              <div><dt>{{ t('dimensions') }}</dt><dd>{{ formatNumber(visible.metadata.width) }} × {{ formatNumber(visible.metadata.height) }}</dd></div>
              <div><dt>{{ t('bytes') }}</dt><dd>{{ formatBytes(visible.metadata.bytes) }}</dd></div>
              <div><dt>{{ t('format') }}</dt><dd>{{ visible.metadata.mime }}</dd></div>
              <div><dt>{{ t('method') }}</dt><dd>{{ visible.metadata.method }}</dd></div>
              <div v-if="visible.metadata.accuracy !== undefined">
                <dt>{{ t('accuracy') }}</dt><dd>± {{ formatNumber(Math.round(visible.metadata.accuracy)) }} m</dd>
              </div>
            </dl>
          </section>
          <section v-if="canShare" class="photo-card-section">
            <button type="button" class="primary-button full-button" @click="shareOpen = true">
              <AppIcon name="share" />{{ q('Поделиться карточкой') }}
            </button>
          </section>
        </div>
      </template>
    </div>
    <AppSheet :open="shareOpen && !!visible" :title="q('Поделиться карточкой')" @close="shareOpen = false">
      <PhotoCardLinks v-if="visible" :card="visible" :share-allowed="canShare" />
    </AppSheet>
  </section>
</template>
