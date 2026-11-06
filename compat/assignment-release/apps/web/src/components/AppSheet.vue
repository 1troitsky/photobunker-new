<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { s } from '../studio/text'
import { lockScroll } from '../studio/scroll-lock'
const props = defineProps<{ open: boolean; title: string; busy?: boolean; wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLElement>()
let previous: HTMLElement | null = null, covered: HTMLElement | null = null, unlock: (() => void) | undefined
function close() { if (!props.busy) emit('close') }
function keys(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
  if (event.key !== 'Tab') return
  const items = [...dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []].filter(item => item.getClientRects().length)
  const first = items[0], last = items.at(-1)
  if (!first) { event.preventDefault(); dialog.value?.focus(); return }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
function release() { unlock?.(); unlock = undefined; if (covered?.isConnected) { covered.inert = false; covered.removeAttribute('aria-hidden') }; covered = null; if (previous?.isConnected) previous.focus(); previous = null }
watch(() => props.open, async open => {
  if (open) { previous = document.activeElement as HTMLElement; covered = previous?.closest<HTMLElement>('[role="dialog"]') ?? document.querySelector<HTMLElement>('.app-shell'); if (covered) { covered.inert = true; covered.setAttribute('aria-hidden', 'true') }; unlock = lockScroll(); await nextTick(); if (props.open) dialog.value?.focus() }
  else if (previous) release()
}, { immediate: true })
onBeforeUnmount(() => { if (props.open) release() })
</script>
<template>
  <Teleport to="body"><div v-if="open" class="sheet-backdrop" @click.self="close"><section ref="dialog" :class="['app-sheet', { 'sheet-wide': wide }]" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1" @keydown="keys"><header class="sheet-header"><h2>{{ title }}</h2><button class="app-icon-button" :disabled="busy" :aria-label="s('close')" @click="close"><AppIcon name="close" /></button></header><div class="sheet-content"><slot /></div></section></div></Teleport>
</template>
