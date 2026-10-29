<script setup lang="ts">
// Pure attachment display: the PhotoBunker host provides an authorized,
// abortable, E2EE-only decrypt callback. Nothing is fetched on mount.
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  kind: 'image' | 'file'
  name: string
  size: number
  active: boolean
  load: (signal: AbortSignal) => Promise<Blob>
  openLabel: string
  downloadLabel: string
  loadingLabel: string
  errorLabel: string
}>()
const url = ref('')
const busy = ref(false)
const error = ref('')
let abort: AbortController | undefined
let generation = 0
function clear() {
  generation++
  abort?.abort()
  abort = undefined
  busy.value = false
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = ''
  error.value = ''
}
onBeforeUnmount(clear)
watch(() => props.active, value => { if (!value) clear() })
async function open() {
  if (!props.active || busy.value) return
  if (url.value) return
  const version = generation
  busy.value = true
  error.value = ''
  abort = new AbortController()
  try {
    const blob = await props.load(abort.signal)
    if (version !== generation || !props.active) return
    url.value = URL.createObjectURL(blob)
  } catch {
    if (version === generation && props.active) error.value = props.errorLabel
  } finally {
    if (version === generation) { busy.value = false; abort = undefined }
  }
}
function save() {
  if (!url.value) return
  const a = document.createElement('a')
  a.href = url.value
  a.download = props.name
  a.click()
}
</script>

<template>
  <div class="chatify-attachment" @pointerdown.stop @pointerup.stop @click.stop @contextmenu.stop>
    <button v-if="kind === 'image' && !url" type="button" class="chatify-attachment-open" :disabled="busy || !active" :aria-label="openLabel" @click="open">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m4 18 6-6 3 3 3-4 4 7" /></svg>
      <span>{{ busy ? loadingLabel : openLabel }}</span>
    </button>
    <img v-if="kind === 'image' && url" :src="url" :alt="name" class="chatify-attachment-image" loading="lazy" />
    <button v-if="kind === 'file'" type="button" class="chatify-attachment-file" :disabled="busy || !active" :aria-label="downloadLabel" @click="url ? save() : open().then(save)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 3h8l5 5v13H6zM14 3v6h5M12 12v6m-3-3 3 3 3-3"/></svg>
      <span><strong>{{ name }}</strong><small>{{ (size / 1024 / 1024).toFixed(1) }} MB · {{ busy ? loadingLabel : downloadLabel }}</small></span>
    </button>
    <p v-if="error" role="alert" class="form-error">{{ error }}</p>
  </div>
</template>
