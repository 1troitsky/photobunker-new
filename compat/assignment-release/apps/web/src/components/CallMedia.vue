<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import type { MediaItem } from '../calls/store'
const props = defineProps<{ item: MediaItem }>(),
  element = ref<HTMLMediaElement>()
let detach: (() => void) | undefined
watch(
  [() => props.item.track, element],
  () => {
    detach?.()
    const track = props.item.track,
      node = element.value
    if (!node) return
    track.attach(node)
    node.muted = props.item.mine
    node.autoplay = true
    if (node instanceof HTMLVideoElement) node.playsInline = true
    void node.play().catch(() => {})
    detach = () => {
      track.detach(node)
      node.srcObject = null
    }
  },
  { flush: 'post' },
)
onBeforeUnmount(() => detach?.())
</script>
<template>
  <video
    v-if="item.kind === 'video'"
    ref="element"
    autoplay
    playsinline
    :muted="item.mine"
    :data-participant="item.participant"
    :data-local="item.mine"
  /><audio v-else ref="element" autoplay :data-participant="item.participant" />
</template>
