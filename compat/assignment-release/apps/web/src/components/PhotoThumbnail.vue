<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { readThumbnail } from '../server/photos'
const props = defineProps<{ id: string; alt?: string; accessKey?: string }>()
const url = ref('')
let generation = 0
function release() {
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = ''
}
watch(
  () => [props.id, props.accessKey],
  async ([id]) => {
    const current = ++generation
    release()
    try {
      const blob = await readThumbnail(id!)
      if (current === generation) url.value = URL.createObjectURL(blob)
    } catch {
      /* The containing link remains usable when a preview is unavailable. */
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  generation++
  release()
})
</script>
<template>
  <img
    v-if="url"
    :src="url"
    :alt="alt ?? ''"
    loading="lazy"
    decoding="async"
  /><span v-else class="thumbnail-placeholder" aria-hidden="true" />
</template>
