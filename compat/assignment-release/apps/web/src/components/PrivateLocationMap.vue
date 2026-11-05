<script setup lang="ts">
import { computed, ref } from 'vue'
import { photoCardText as t } from '../studio/photo-card-text'
const props = defineProps<{ latitude: number; longitude: number }>()
const loaded = ref(false)
const delta = 0.008
const bbox = computed(() => [
  props.longitude - delta,
  props.latitude - delta,
  props.longitude + delta,
  props.latitude + delta,
].map(value => value.toFixed(6)).join(','))
const embedUrl = computed(() => `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox.value)}&layer=mapnik&marker=${encodeURIComponent(`${props.latitude},${props.longitude}`)}`)
const mapUrl = computed(() => `https://www.openstreetmap.org/?mlat=${encodeURIComponent(props.latitude)}&mlon=${encodeURIComponent(props.longitude)}#map=16/${props.latitude}/${props.longitude}`)
</script>
<template>
  <figure class="photo-card-local-map" role="group" :aria-label="t('localMap')">
    <iframe v-if="loaded" class="photo-card-map-frame" :src="embedUrl" :title="t('localMap')"
      loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin" />
    <div v-else class="photo-card-map-consent">
      <span class="photo-card-map-pin" aria-hidden="true" />
      <button type="button" class="secondary-button" @click="loaded = true">{{ t('loadMap') }}</button>
    </div>
    <figcaption>
      <span class="photo-card-map-coordinates">{{ latitude.toFixed(5) }}, {{ longitude.toFixed(5) }}</span>
      <small>{{ t('mapPrivacy') }}</small>
      <a v-if="loaded" :href="mapUrl" target="_blank" rel="noreferrer noopener">{{ t('openMap') }}</a>
    </figcaption>
  </figure>
</template>
