<script setup lang="ts">
import { useRouter } from 'vue-router'
import AppIcon from './AppIcon.vue'
import AppStatusIndicator from './AppStatusIndicator.vue'
import { s } from '../studio/text'
defineProps<{ title: string; back?: string; subtitle?: string }>()
const router = useRouter()
function goBack(fallback: string) {
  const previous = window.history.state?.back
  if (typeof previous === 'string' && previous) router.back()
  else void router.push(fallback)
}
</script>
<template>
  <header class="screen-header"><button v-if="back" class="app-icon-button" :aria-label="s('back')" @click="goBack(back)"><AppIcon name="back" /></button><RouterLink v-else to="/assignments" class="screen-monogram" aria-label="PhotoBunker">pb</RouterLink><div class="screen-title"><h1>{{ title }}</h1><small v-if="subtitle">{{ subtitle }}</small><AppStatusIndicator /></div><div class="screen-actions"><slot /></div></header>
</template>
