<script setup lang="ts">
import { useRouter } from 'vue-router'
import { inject } from 'vue'
import AppIcon from './AppIcon.vue'
import { s } from '../studio/text'
import { appStatusKey } from '../app/status'
defineProps<{ title: string; back?: string; subtitle?: string }>()
const router = useRouter()
const appStatus = inject(appStatusKey)
function goBack(fallback: string) {
  const previous = window.history.state?.back
  if (typeof previous === 'string' && previous) router.back()
  else void router.push(fallback)
}
</script>
<template>
  <header class="screen-header"><button v-if="back" class="app-icon-button" :aria-label="s('back')" @click="goBack(back)"><AppIcon name="back" /></button><RouterLink v-else to="/assignments" class="screen-monogram" aria-label="PhotoBunker">pb</RouterLink><div class="screen-title"><h1>{{ title }}</h1><small v-if="subtitle">{{ subtitle }}</small></div><RouterLink v-if="appStatus" to="/status" :class="['app-status-pill', `is-${appStatus.tone}`]" :title="appStatus.detail"><span />{{ appStatus.label }}</RouterLink><div class="screen-actions"><slot /></div></header>
</template>
