<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import { text } from './copy'

defineProps<{ title: string; subtitle?: string; back?: string }>()
</script>

<template>
  <header class="screen-header">
    <RouterLink
      v-if="back"
      class="icon-button"
      :to="back"
      :aria-label="text.back"
    ><AppIcon name="back" /></RouterLink>
    <span
      v-else
      class="screen-monogram"
      aria-hidden="true"
    >pb</span>
    <div class="screen-title">
      <h1>{{ title }}</h1>
      <small v-if="subtitle">{{ subtitle }}</small>
    </div>
    <div class="screen-actions">
      <slot />
    </div>
  </header>
</template>
