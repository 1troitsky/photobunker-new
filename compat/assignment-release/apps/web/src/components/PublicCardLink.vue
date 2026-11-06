<script setup lang="ts">
import type { Photo } from '../local/photos'
import { ref } from 'vue'
import AppIcon from './AppIcon.vue'
import AppSheet from './AppSheet.vue'
import { locale } from '../i18n'
// The owner requested a public text-only page first. No photo or publication
// state is needed to open it; private data never enters this URL.
defineProps<{ photo?: Photo; menu?: boolean; versionKey?: string }>()
const open = ref(false)
const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
// A same-origin HTTPS _blank link stays in the installed iOS web app.
// Hand the tap to Safari's application scheme instead, without window.open.
const safari = appleMobile && location.protocol === 'https:'
const publicUrl = new URL('/public-card.html', location.origin).href
const externalUrl = safari ? publicUrl.replace(/^https:/, 'x-safari-https:') : publicUrl
</script>
<template>
  <button type="button" :class="['public-card-link',{'public-card-menu-link':menu}]" aria-haspopup="dialog" @click="open=true"><AppIcon name="profiles" /><span>Public card</span></button>
  <AppSheet :open="open" title="Public card" browser @close="open=false">
    <template #actions><a :href="externalUrl" :target="safari ? '_self' : '_blank'" rel="noopener noreferrer" referrerpolicy="no-referrer" class="browser-external" :aria-label="safari ? (locale==='ru' ? 'Открыть в Safari' : 'Open in Safari') : (locale==='ru' ? 'Открыть в браузере устройства' : 'Open in device browser')">{{ safari ? (locale==='ru' ? 'В Safari' : 'Open in Safari') : (locale==='ru' ? 'В браузере' : 'Open in browser') }} ↗</a></template>
    <iframe v-if="open" src="/public-card.html" title="Public card" class="public-card-frame" sandbox="" referrerpolicy="no-referrer" tabindex="-1" />
  </AppSheet>
</template>
<style scoped>
.public-card-link { display:flex; min-height:44px; min-width:0; align-items:center; justify-content:center; flex-direction:column; gap:4px; padding:4px; color:var(--text); background:transparent; border:0; text-decoration:none; cursor:pointer; font:inherit; font-size:12px; }
.public-card-link:disabled { opacity:.45; cursor:default; }
.public-card-link svg { width:20px; height:20px; flex-shrink:0; }
.public-card-link span { font-size:12px; line-height:1.2; }
.public-card-menu-link { width:100%; flex-direction:row; justify-content:flex-start; padding:12px 0; gap:12px; text-align:left; }
.public-card-menu-link span { font-size:14px; }
.public-card-link:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; border-radius:8px; }
.browser-external { display:inline-flex; align-items:center; min-height:44px; padding:0 8px; color:var(--accent); font-size:13px; text-decoration:none; white-space:nowrap; }
.browser-external:focus-visible { outline:2px solid var(--accent); outline-offset:2px; border-radius:8px; }
.public-card-frame { width:100%; height:100%; border:0; background:#0c151d; }
</style>
