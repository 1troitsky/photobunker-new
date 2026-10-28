<script setup lang="ts">
import { useRoute } from 'vue-router'
import AppIcon from './AppIcon.vue'
import { text } from './copy'

const route = useRoute()
const items = [
  { path: '/assignments', name: 'assignments', icon: 'assignments' },
  { path: '/browser', name: 'browser', icon: 'browser' },
  { path: '/camera', name: 'camera', icon: 'camera' },
  { path: '/photos', name: 'photos', icon: 'photos' },
  { path: '/profile', name: 'profile', icon: 'profile' },
] as const
function selected(path: string) { return route.path === path || (path === '/photos' && ['/editor/preview', '/photo-card/preview'].includes(route.path)) || (path === '/profile' && route.path === '/pin/preview') }
</script>
<template>
  <nav class="app-dock" :aria-label="text.browse" data-testid="app-dock">
    <RouterLink v-for="item in items" :key="item.path" :to="item.path"
      class="dock-link" :class="{ 'is-active': selected(item.path), 'dock-camera': item.name==='camera' }"
      :aria-current="selected(item.path) ? 'page' : undefined">
      <span class="dock-icon"><AppIcon :name="item.icon" /></span>
      <span class="dock-label">{{ text[item.name] }}</span>
    </RouterLink>
  </nav>
</template>
