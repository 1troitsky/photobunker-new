<script setup lang="ts">
import { useRouter } from 'vue-router'
import AppIcon from './AppIcon.vue'
import { s } from '../studio/text'
defineProps<{ title: string; back?: string; subtitle?: string }>()
const router = useRouter()
</script>
<template>
  <header class="screen-header"><button v-if="back" class="app-icon-button" :aria-label="s('back')" @click="router.push(back)"><AppIcon name="back" /></button><span v-else class="screen-monogram" aria-hidden="true">pb</span><div class="screen-title"><h1>{{ title }}</h1><small v-if="subtitle">{{ subtitle }}</small></div><div class="screen-actions"><slot /></div></header>
</template>
