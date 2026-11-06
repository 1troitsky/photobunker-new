<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { locale } from '../i18n'

const props = defineProps<{ active: boolean; enabled: boolean }>()
const emit = defineEmits<{ visibility: [value: boolean] }>()
const visible = ref(false)
let startedAt = 0, timer: ReturnType<typeof setTimeout> | undefined
function cancelTimer() { if (timer !== undefined) clearTimeout(timer); timer = undefined }
watch([() => props.active, () => props.enabled], ([active, enabled]) => {
  cancelTimer()
  if (!enabled) { visible.value = false; emit('visibility', false); return }
  if (active) {
    if (!visible.value) startedAt = performance.now()
    visible.value = true; emit('visibility', true)
  } else if (visible.value) {
    const remaining = Math.max(0, 1500 - (performance.now() - startedAt))
    timer = setTimeout(() => { visible.value = false }, remaining)
  }
}, { immediate: true, flush: 'sync' })
function finished() { if (!visible.value) emit('visibility', false) }
onBeforeUnmount(cancelTimer)
</script>
<template>
  <Teleport to="body">
    <Transition name="workspace-loader" appear @after-leave="finished">
      <div v-if="visible" class="workspace-loader" role="status" aria-live="polite" aria-busy="true">
        <div class="workspace-loader-content">
          <span class="workspace-loader-brand" aria-hidden="true">pb</span>
          <strong>PhotoBunker</strong>
          <span class="workspace-loader-spinner" aria-hidden="true" />
          <span>{{ locale === 'ru' ? 'Подготавливаем экран…' : 'Preparing your workspace…' }}</span>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
