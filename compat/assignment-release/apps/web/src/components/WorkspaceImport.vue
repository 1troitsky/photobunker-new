<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import AppSheet from './AppSheet.vue'
import { q } from '../crypto/text'
import { useRouter } from 'vue-router'
import { protectionEnabled } from '../crypto/store'
import { account } from '../identity/store'
import { accessCode } from '../server/api'
import { loadStudio } from '../studio/store'
import { refreshLibrary } from '../local/library'
import {
  localPreview,
  legacyPreview,
  importData,
  type LegacyData,
} from '../workspace/import'
import { workspaceError } from '../workspace/errors'
import { w } from '../workspace/text'
const router = useRouter()
const open = ref(false),
  busy = ref(false),
  error = ref(''),
  done = ref(false),
  includePhotos = ref(false),
  source = shallowRef<Awaited<ReturnType<typeof localPreview>>>(),
  legacy = shallowRef<LegacyData>()
const count = computed(
  () =>
    [
      ...(source.value?.presets ?? []),
      ...(source.value?.tasks ?? []),
      ...(source.value?.teams ?? []),
      ...(legacy.value?.teams ?? []),
      ...(legacy.value?.tasks ?? []),
      ...(legacy.value?.presets ?? []),
    ].length,
)
const photoCount = computed(
  () => (source.value?.photos.length ?? 0) + (legacy.value?.photos.length ?? 0),
)
async function show() {
  open.value = true
  error.value = ''
  done.value = false
  try {
    source.value = await localPreview()
    legacy.value = await legacyPreview()
  } catch (failure) {
    error.value = workspaceError(failure)
  }
}
async function connect() {
  busy.value = true
  error.value = ''
  try {
    legacy.value = await legacyPreview(true)
  } catch (failure) {
    error.value = workspaceError(failure)
  } finally {
    busy.value = false
  }
}
async function run() {
  if (busy.value || !source.value || !confirm(w('importConfirm'))) return
  busy.value = true
  error.value = ''
  try {
    await importData(source.value, legacy.value, includePhotos.value&&!protectionEnabled.value)
    done.value = true
    await loadStudio()
    await refreshLibrary()
  } catch (failure) {
    error.value = workspaceError(failure)
  } finally {
    busy.value = false
  }
}
watch(
  () => account.value?.id,
  () => {
    open.value = false
    source.value = undefined
    legacy.value = undefined
    error.value = ''
    done.value = false
  },
)
</script>
<template>
  <button v-if="account" class="quiet-button full-button" @click="show">
    {{ w('import') }}</button
  ><AppSheet
    :open="open"
    :title="w('import')"
    :busy="busy"
    @close="open = false"
    ><div class="native-form">
      <p class="field-hint">{{ w('importHint') }}</p>
      <p>
        {{ w('local') }}:
        {{
          (source?.presets.length ?? 0) +
          (source?.tasks.length ?? 0) +
          (source?.teams.length ?? 0)
        }}
        · {{ source?.photos.length ?? 0 }} фото
      </p>
      <p>
        {{ w('legacy') }}:
        {{
          (legacy?.presets.length ?? 0) +
          (legacy?.tasks.length ?? 0) +
          (legacy?.teams.length ?? 0)
        }}
        · {{ legacy?.photos.length ?? 0 }} фото
      </p>
      <button
        v-if="
          accessCode &&
          !legacy?.presets.length &&
          !legacy?.photos.length &&
          !done
        "
        class="secondary-button"
        :disabled="busy"
        @click="connect"
      >
        {{ w('legacy') }} · {{ w('import') }}</button
      ><label v-if="photoCount && !done" class="plain-check"
        ><input v-model="includePhotos" type="checkbox" :disabled="busy||protectionEnabled" />{{
          w('importPhotos')
        }}
        · {{ photoCount }}</label
      >
      <button v-if="protectionEnabled && photoCount" class="secondary-button" :disabled="busy" @click="open = false; router.push('/profile/photos-security')">{{ q('Перенести старые фотографии') }}</button>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-if="done" class="form-notice" role="status">{{ w('importDone') }}</p>
      <button
        v-else-if="count || photoCount"
        class="primary-button"
        :disabled="busy"
        @click="run"
      >
        {{ w(busy ? 'importBusy' : 'import') }}
      </button>
      <p v-else class="field-hint">{{ w('noImport') }}</p>
    </div></AppSheet
  >
</template>
