<script setup lang="ts">
import { ref, onBeforeUnmount, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import PrivateLocationMap from '../components/PrivateLocationMap.vue'
import { decryptCard, decryptCardObject, type CardManifest, type PublicCard } from '../crypto/card-shares'
import { downloadFile } from '../studio/export'
import { cardShareText as t } from '../studio/card-share-text'
import { formatDate, formatNumber } from '../i18n'
import { profilePath } from '../identity/person'

const route = useRoute()
const id = String(route.params.id)
let secret = location.hash.slice(1)
// Fragment-only capability: remove from current address/history *before*
// any network request, analytics, or third-party component can observe it.
history.replaceState(history.state, '', location.pathname + location.search)
const card = ref<PublicCard>(), error = ref<'invalid'|'expired'|'unavailable'>()
const loading = ref(true), details = ref(false), now = ref(Date.now())
const manifestRef = ref<CardManifest>(), imageUrl = ref(''), originalUrl = ref(''),
  imageError = ref(false), originalBusy = ref(false)
let safeFile: Blob | undefined, originalFile: Blob | undefined
const copyState = ref<'idle'|'copied'|'failed'>('idle')
let disposed = false, timer: ReturnType<typeof setInterval> | undefined
let controller = new AbortController()
function clear(clearSecret = true) {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
  if (originalUrl.value) URL.revokeObjectURL(originalUrl.value)
  imageUrl.value = originalUrl.value = ''
  manifestRef.value = undefined
  safeFile = originalFile = undefined
  imageError.value = false
  originalBusy.value = false
  card.value = undefined
  if (clearSecret) secret = ''
  details.value = false
  copyState.value = 'idle'
}
async function requestPart(url: string, format: 'json'|'blob') {
  const response = await fetch(url, { credentials: 'omit', cache: 'no-store',
    redirect: 'error', signal: controller.signal, referrerPolicy: 'no-referrer' })
  if (!response.ok) {
    if (response.status === 410) throw new Error('expired')
    if (response.status === 403) throw new Error('invalid')
    throw new Error(response.status >= 500 ? 'unavailable' : 'invalid')
  }
  return format === 'blob' ? response.blob() : response.json()
}
async function verifyAlive() {
  const manifest = await requestPart('/api/v1/cards/' + encodeURIComponent(id), 'json') as CardManifest
  if (manifest.id !== id || manifest.type !== 'photo-card' || manifest.version !== 2)
    throw new Error('invalid')
  return manifest
}
async function load() {
  error.value = undefined; loading.value = true
  try {
    if (!secret) throw new Error('invalid')
    const manifest = await verifyAlive()
    const blob = await requestPart('/api/v1/cards/' + encodeURIComponent(id) + '/content', 'blob') as Blob
    const decrypted = await decryptCard(blob, manifest, secret)
    if (disposed) return
    if (manifest.scopes.photo) {
      // Only safe flattened photo loads automatically. Card-only does NOT
      // make an image request; original must NEVER be fetched here.
      const content = await requestPart('/api/v1/cards/' + encodeURIComponent(id) + '/content/photo','blob') as Blob
      const safe = await decryptCardObject(content, manifest, secret, 'photo')
      if (disposed) return
      safeFile = safe
      imageUrl.value = URL.createObjectURL(safe)
    }
    if (disposed) return
    card.value = decrypted
    // Preserve manifest for download controls and manual original request.
    // It is public metadata only; secret remains in component memory.
    manifestRef.value = manifest
    // The card is still constrained by its actual expiry in the browser.
  } catch (reason) {
    if (!disposed) {
      const message = reason instanceof Error ? reason.message : ''
      const next = message === 'expired' ? 'expired' : message === 'unavailable' ? 'unavailable' : 'invalid'
      // A temporary network/server failure can be retried in this page without
      // putting the fragment secret back into the address bar or storage.
      clear(next !== 'unavailable')
      error.value = next
    }
  } finally { if (!disposed) loading.value = false }
}
async function openOriginal() {
  if (!card.value || !manifestRef.value?.scopes.original || originalBusy.value || !secret) return
  originalBusy.value=true
  imageError.value=false
  try {
    await verifyAlive()
    const content=await requestPart('/api/v1/cards/'+encodeURIComponent(id)+'/content/original','blob') as Blob
    const original=await decryptCardObject(content,manifestRef.value,secret,'original')
    if (disposed || !card.value) return
    originalFile=original
    originalUrl.value=URL.createObjectURL(original)
  } catch { if (!disposed) imageError.value=true }
  finally { originalBusy.value=false }
}
async function save(kind:'photo'|'original') {
  if (!manifestRef.value?.scopes.download) return
  const content=kind==='photo'?safeFile:originalFile
  if (!content || !card.value) return
  try {
    await verifyAlive()
    const extensions: Record<string, string> = {
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
      'image/avif': 'avif', 'image/heic': 'heic', 'image/heif': 'heif',
    }
    const mime = kind === 'photo' ? 'image/jpeg' : content.type
    const extension = extensions[mime]
    if (!extension) throw new Error('card_share.invalid_original')
    downloadFile(new File([content], `photobunker-${kind}.${extension}`, { type: mime }))
  } catch { if (!disposed) imageError.value=true }
}
function hide() {
  clear(); controller.abort()
  error.value = 'invalid'
}
function date(value: number) {
  return formatDate(value, { dateStyle: 'medium', timeStyle: 'short' })
}
async function copyCoordinates() {
  if (!card.value?.location) return
  const value = card.value.location.latitude.toFixed(6) + ', ' +
    card.value.location.longitude.toFixed(6)
  try {
    await navigator.clipboard.writeText(value)
    if (!disposed && card.value?.location) copyState.value = 'copied'
  } catch {
    if (!disposed) copyState.value = 'failed'
  }
}
onMounted(() => {
  void load()
  timer = setInterval(async () => {
    if (!card.value) return
    now.value = Date.now()
    if (card.value.expiresAt <= now.value) { clear(); error.value = 'expired'; return }
    // Revoke/deletion cannot be detected offline. Online revalidate the
    // independent manifest endpoint; never fetch an image object.
    if (!navigator.onLine) return
    try { await verifyAlive() }
    catch (reason) {
      const message = reason instanceof Error ? reason.message : ''
      if (!disposed && message !== 'unavailable') { clear(); error.value = 'expired' }
    }
  }, 10000)
  window.addEventListener('pagehide', hide)
})
onBeforeUnmount(() => {
  disposed = true; clear(); controller.abort()
  if (timer) clearInterval(timer)
  window.removeEventListener('pagehide', hide)
})
</script>

<template>
  <section class="native-screen photo-card-screen shared-card-screen">
    <header class="screen-header"><span class="screen-monogram" aria-hidden="true">pb</span>
      <div class="screen-title"><h1>{{ t('title') }}</h1></div></header>
    <div class="screen-body photo-card-body">
      <div v-if="loading" class="native-empty" role="status"><p>{{ t('pending') }}</p></div>
      <div v-else-if="error || !card" class="native-empty">
        <h2>{{ t(error || 'invalid') }}</h2>
        <p>{{ t('hint') }}</p>
        <button v-if="error === 'unavailable'" class="primary-button" type="button"
          :disabled="loading" @click="load">{{ t('retry') }}</button>
      </div>
      <template v-else>
        <div class="photo-card-intro">
          <span class="photo-card-kicker">{{ t('title') }}</span>
          <h2>{{ card.title || t(card.namePending ? 'pendingId' : 'noTitle') }}</h2>
          <p v-if="card.description" class="photo-card-description">{{ card.description }}</p>
        </div>
        <div class="photo-card-content">
          <section v-if="imageUrl" class="photo-card-section">
            <img :src="imageUrl" :alt="card.title" class="photo-card-safe-image" />
            <p class="field-hint">{{ t('pixelsHint') }}</p>
            <button v-if="manifestRef?.scopes.download" type="button" class="secondary-button"
              @click="save('photo')">{{ t('savePhoto') }}</button>
          </section>
          <section v-if="manifestRef?.scopes.original" class="photo-card-section">
            <button type="button" class="secondary-button" :disabled="originalBusy"
              @click="openOriginal">{{ t('showOriginal') }}</button>
            <template v-if="originalUrl">
              <img :src="originalUrl" :alt="card.title" class="photo-card-safe-image" />
              <p class="field-hint">{{ t('pixelsHint') }}</p>
              <button v-if="manifestRef?.scopes.download" type="button" class="secondary-button"
                @click="save('original')">{{ t('saveOriginal') }}</button>
            </template>
          </section>
          <p v-if="imageError" role="alert">{{ t('imageError') }}</p>
          <section class="photo-card-section"><dl class="native-facts">
            <div><dt>{{ t('expiry') }}</dt><dd>{{ date(card.expiresAt) }}</dd></div>
            <div v-if="card.capturedAt"><dt>{{ t('capture') }}</dt><dd>{{ date(card.capturedAt) }}</dd></div>
            <div v-if="card.author"><dt>{{ t('author') }}</dt><dd>
              <RouterLink :to="profilePath(card.author.publicId)">{{ card.author.publicId }}</RouterLink>
            </dd></div>
          </dl></section>
          <section v-if="card.location" class="photo-card-section">
            <h3>{{ t('location') }}</h3>
            <button type="button" class="secondary-button" @click="copyCoordinates">
              {{ copyState === 'copied' ? t('coordinatesCopied') : t('copyCoordinates') }}
            </button>
            <p v-if="copyState === 'failed'" class="field-error" role="alert">{{ t('copyFailed') }}</p>
            <PrivateLocationMap :latitude="card.location.latitude" :longitude="card.location.longitude" />
          </section>
          <section v-if="card.metadata" class="photo-card-section">
            <button class="photo-card-expand" type="button" :aria-expanded="details" @click="details = !details">
              {{ t('details') }}
            </button>
            <dl v-if="details" class="native-facts">
              <div v-if="card.metadata.camera"><dt>{{ t('details') }}</dt><dd>{{ card.metadata.camera }}</dd></div>
              <div v-if="card.metadata.width && card.metadata.height">
                <dt>{{ t('details') }}</dt><dd>{{ formatNumber(card.metadata.width) }} × {{ formatNumber(card.metadata.height) }}</dd></div>
              <div v-if="card.metadata.mime"><dt>{{ t('details') }}</dt><dd>{{ card.metadata.mime }}</dd></div>
            </dl>
          </section>
        </div>
      </template>
    </div>
  </section>
</template>
