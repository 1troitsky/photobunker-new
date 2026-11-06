<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { s } from '../studio/text'
import { lockScroll } from '../studio/scroll-lock'
const props = defineProps<{ open: boolean; title: string; busy?: boolean; wide?: boolean; browser?: boolean }>()
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
  <Teleport to="body"><Transition :name="browser ? 'browser-sheet' : undefined"><div v-if="open" :class="['sheet-backdrop', {'browser-backdrop':browser}]" @click.self="close"><section ref="dialog" :class="['app-sheet', { 'sheet-wide': wide, 'browser-sheet':browser }]" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1" @keydown="keys"><header class="sheet-header"><h2>{{ title }}</h2><slot name="actions" /><button class="app-icon-button" :disabled="busy" :aria-label="s('close')" @click="close"><AppIcon name="close" /></button></header><div class="sheet-content"><slot /></div></section></div></Transition></Teleport>
</template>
<style scoped>
.sheet-backdrop.browser-backdrop { align-items:flex-end; padding:0; }
.app-sheet.browser-sheet { width:min(920px,100%); height:min(94dvh,900px); max-height:calc(100dvh - 12px - env(safe-area-inset-top)); border-radius:22px 22px 0 0; border-bottom:0; }
.browser-sheet .sheet-header h2 { font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.browser-sheet .sheet-content { padding:0; flex:1; min-height:0; overflow:hidden; display:flex; }
.browser-sheet-enter-active, .browser-sheet-leave-active { transition:opacity 240ms ease; }
.browser-sheet-enter-active .browser-sheet, .browser-sheet-leave-active .browser-sheet { transition:transform 240ms cubic-bezier(.2,.8,.2,1); }
.browser-sheet-enter-from, .browser-sheet-leave-to { opacity:0; }
.browser-sheet-enter-from .browser-sheet, .browser-sheet-leave-to .browser-sheet { transform:translateY(100%); }
@media (prefers-reduced-motion:reduce) { .browser-sheet-enter-active, .browser-sheet-leave-active, .browser-sheet-enter-active .browser-sheet, .browser-sheet-leave-active .browser-sheet { transition:none; } }
</style>
