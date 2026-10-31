<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { useRoute } from 'vue-router'
import { decryptShare, type ShareManifest } from '../crypto/shares'
import { s } from '../studio/text'
import { downloadFile } from '../studio/export'
const route = useRoute(),
  url = ref(''),
  error = ref(''),
  busy = ref(true),
  download = ref(false)
let alive = true,
  file: File | undefined,
  timer: ReturnType<typeof setInterval> | undefined,
  controller = new AbortController()
const id = String(route.params.id)
const secret = location.hash.slice(1)
// Remove the secret from address/history after reading it; refresh requires reopening the link.
history.replaceState(history.state, '', location.pathname)
function clear() {
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = ''
  file = undefined
  download.value = false
}
async function loadManifest() {
  const response = await fetch(`/api/v1/shares/${id}`, {
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    signal: controller.signal,
  })
  if (!response.ok) throw new Error('unavailable')
  const manifest = (await response.json()) as ShareManifest
  if (manifest.id !== id) throw new Error('invalid')
  return manifest
}
onMounted(async () => {
  try {
    const manifest = await loadManifest(),
      response = await fetch(`/api/v1/shares/${id}/content`, {
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      })
    if (!response.ok) throw new Error('unavailable')
    const blob = await decryptShare(await response.blob(), manifest, secret)
    if (!alive) return
    file = new File([blob], 'photobunker-photo.jpg', { type: 'image/jpeg' })
    url.value = URL.createObjectURL(file)
    download.value = manifest.scope === 'download'
    timer = setInterval(async () => {
      try {
        await loadManifest()
      } catch {
        clear()
        error.value = s('sharedUnavailable')
      }
    }, 10000)
  } catch {
    if (alive) error.value = s('sharedInvalid')
  } finally {
    busy.value = false
  }
})
async function save() {
  try {
    await loadManifest()
    if (file) downloadFile(file)
  } catch {
    clear()
    error.value = s('sharedUnavailable')
  }
}
function hide() {
  clear()
  controller.abort()
  if (timer) clearInterval(timer)
  error.value = s('sharedReopen')
}
onBeforeUnmount(() => {
  alive = false
  hide()
  window.removeEventListener('pagehide', hide)
})
window.addEventListener('pagehide', hide)
</script>
<template>
  <section class="native-screen">
    <header class="screen-header"><h1>PhotoBunker</h1></header>
    <div class="screen-body">
      <p v-if="busy">{{ s('openingShared') }}</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <img
        v-if="url"
        :src="url"
        :alt="s('sharedAlt')"
        style="
          display: block;
          max-width: 100%;
          max-height: 75dvh;
          object-fit: contain;
        "
      /><button v-if="download && url" class="primary-button" @click="save">
        {{ s('export') }}
      </button>
    </div>
  </section>
</template>
