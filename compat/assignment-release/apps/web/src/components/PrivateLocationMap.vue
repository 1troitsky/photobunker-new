<script setup lang="ts">
import { photoCardText as t } from '../studio/photo-card-text'
// No HTTP, external image tiles, iframe or provider SDK. This is a local
// schematic marker, not an accurate geographic rendering.
defineProps<{ latitude: number; longitude: number }>()
</script>
<template>
  <figure class="photo-card-local-map" role="group" :aria-label="t('localMap')">
    <div class="photo-card-map-surface" role="img" :aria-label="t('localMap')">
      <div class="photo-card-map-axis photo-card-map-axis-x" aria-hidden="true" />
      <div class="photo-card-map-axis photo-card-map-axis-y" aria-hidden="true" />
      <span class="photo-card-map-pin" aria-hidden="true" />
    </div>
    <figcaption>
      <span class="photo-card-map-coordinates">{{ latitude.toFixed(5) }}, {{ longitude.toFixed(5) }}</span>
      <small>{{ t('mapPrivacy') }}</small>
    </figcaption>
  </figure>
</template>
