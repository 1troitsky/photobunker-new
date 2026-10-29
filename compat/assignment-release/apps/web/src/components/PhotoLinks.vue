<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import type { Photo } from '../local/photos'
import { account } from '../identity/store'
import { photoReadAllowed } from '../crypto/store'
import { remote } from '../crypto/photos'
import { request } from '../crypto/api'
import { encryptShare, type ShareInfo } from '../crypto/shares'
import { canonical } from '../crypto/protocol'
import { externalPhotoFile } from '../studio/export'
import { s } from '../studio/text'
import { formatDate } from '../i18n'
const props = defineProps<{
  photo: Photo
  blob: Blob
  versionId: string | null
  pending: boolean
}>()
const scope = ref<'view' | 'download'>('view'),
  duration = ref(3600),
  busy = ref(false),
  error = ref(''),
  url = ref(''),
  copied = ref(false),
  shares = ref<ShareInfo[]>([])
let alive = true
const owner = account.value?.id
function valid() {
  if (!alive || account.value?.id !== owner || !photoReadAllowed())
    throw new Error('crypto.locked')
}
async function refresh() {
  const result = await request<{ shares: ShareInfo[] }>(
    `/photos/${props.photo.id}/shares`,
  )
  valid()
  shares.value = result.shares
}
onMounted(() =>
  refresh().catch(() => {
    if (alive) error.value = s('linkError')
  }),
)
async function create() {
  if (busy.value || props.pending) return
  busy.value = true
  error.value = ''
  copied.value = false
  url.value = ''
  try {
    const parent = await remote(props.photo.id)
    valid()
    if (!parent.access.shareExternal) throw new Error('crypto.denied')
    const expiresAt = Math.min(
        parent.expiresAt,
        Date.now() + duration.value * 1000,
      ),
      file = await externalPhotoFile(props.photo, props.blob),
      encrypted = await encryptShare(
        file,
        scope.value,
        props.versionId,
        expiresAt,
      )
    valid()
    const form = new FormData()
    form.set('manifest', canonical(encrypted.manifest))
    form.set('file', encrypted.blob, 'ciphertext')
    await request(`/photos/${props.photo.id}/shares`, 'POST', form)
    valid()
    url.value = `${location.origin}/s/${encrypted.manifest.id}#${encrypted.secret}`
    await refresh()
  } catch {
    if (alive) error.value = s('linkError')
  } finally {
    busy.value = false
  }
}
async function copy() {
  try {
    await navigator.clipboard.writeText(url.value)
    copied.value = true
  } catch {
    error.value = s('linkError')
  }
}
async function revoke(id: string) {
  busy.value = true
  error.value = ''
  try {
    await request(`/photos/${props.photo.id}/shares/${id}`, 'DELETE')
    valid()
    if (url.value.includes('/s/' + id)) url.value = ''
    await refresh()
  } catch {
    if (alive) error.value = s('linkError')
  } finally {
    busy.value = false
  }
}
onBeforeUnmount(() => {
  alive = false
  url.value = ''
  shares.value = []
})
</script>
<template>
  <div class="native-form">
    <p class="field-hint">{{ s('linkHint') }}</p>
    <p v-if="pending" class="field-hint">{{ s('syncPending') }}</p>
    <label
      >{{ s('linkScope')
      }}<select :aria-label="s('linkScope')" v-model="scope" :disabled="busy">
        <option value="view">{{ s('viewOnly') }}</option>
        <option value="download">{{ s('allowDownload') }}</option>
      </select></label
    >
    <label
      >{{ s('linkDuration')
      }}<select
        :aria-label="s('linkDuration')"
        v-model.number="duration"
        :disabled="busy"
      >
        <option :value="3600">{{ s('hour') }}</option>
        <option :value="86400">{{ s('day') }}</option>
        <option :value="604800">{{ s('week') }}</option>
      </select></label
    >
    <button
      class="secondary-button"
      :disabled="busy || pending"
      @click="create"
    >
      {{ s('createLink') }}
    </button>
    <template v-if="url"
      ><p class="field-hint">{{ s('linkKeep') }}</p>
      <label
        >{{ s('createLink') }}<textarea :value="url" readonly rows="3" /></label
      ><button class="secondary-button" @click="copy">
        {{ s(copied ? 'linkCopied' : 'copyLink') }}
      </button></template
    >
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-for="link in shares" :key="link.id" class="form-section">
      <span
        >{{ s(link.scope === 'view' ? 'viewOnly' : 'allowDownload') }} ·
        {{ formatDate(link.expiresAt, { dateStyle: 'medium', timeStyle: 'short' }) }}</span
      ><span v-if="link.revoked">{{ s('revokedLink') }}</span
      ><button
        v-else
        class="quiet-button subtle-danger"
        :disabled="busy"
        @click="revoke(link.id)"
      >
        {{ s('revokeLink') }}
      </button>
    </div>
  </div>
</template>
