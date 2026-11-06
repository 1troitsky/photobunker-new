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
function release() { unlock?.(); unlock = undefined; if (covered?.isConnected) { covered.inert = false; covered.removeAttribute('aria-hidden') }; covered = null; if (previous?.isConnected) previous.focus({preventScroll:true}); previous = null }
let touch: {x:number;y:number} | undefined
function touchStart(event: TouchEvent) { if (props.browser && event.touches[0]) touch = {x:event.touches[0].clientX,y:event.touches[0].clientY} }
function touchEnd(event: TouchEvent) {
  const end = event.changedTouches[0]
  if (touch && end && end.clientY-touch.y > 70 && end.clientY-touch.y > Math.abs(end.clientX-touch.x)) close()
  touch = undefined
}
watch(() => props.open, async open => {
  if (open) {
    previous = document.activeElement as HTMLElement
    unlock = lockScroll()
    // Let the action menu finish closing before taking ownership of its background.
    await nextTick()
    if (!props.open) return
    if (!previous?.isConnected) previous = document.activeElement as HTMLElement
    covered = previous?.closest<HTMLElement>('[role="dialog"]') ?? document.querySelector<HTMLElement>('.app-shell')
    if (covered) { covered.inert = true; covered.setAttribute('aria-hidden', 'true') }
    dialog.value?.focus()
  }
  else if (previous) release()
}, { immediate: true })
onBeforeUnmount(() => { if (props.open) release() })
</script>
<template>
  <Teleport to="body"><Transition name="browser-sheet" :css="!!browser"><div v-if="open" :class="['sheet-backdrop', {'browser-backdrop':browser}]" @click.self="close"><section ref="dialog" :class="['app-sheet', { 'sheet-wide': wide, 'sheet-browser':browser }]" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1" @keydown="keys"><header class="sheet-header" @touchstart.passive="touchStart" @touchend.passive="touchEnd"><h2>{{ title }}</h2><slot name="actions" /><button class="app-icon-button" :disabled="busy" :aria-label="s('close')" @click="close"><AppIcon name="close" /></button></header><div class="sheet-content"><slot /></div></section></div></Transition></Teleport>
</template>
<style>
.browser-backdrop { padding:0; align-items:flex-end; }
.app-sheet.sheet-browser { width:min(880px,100%); height:calc(100dvh - max(16px,env(safe-area-inset-top))); max-height:calc(100dvh - max(16px,env(safe-area-inset-top))); border-radius:24px 24px 0 0; overflow:hidden; border-bottom:0; }
.sheet-browser > .sheet-header { position:relative; padding:14px 12px 8px 20px; }
.sheet-browser > .sheet-header::before { content:''; position:absolute; width:36px; height:4px; border-radius:4px; background:var(--secondary); opacity:.4; top:6px; left:calc(50% - 18px); }
.sheet-browser > .sheet-header > .app-icon-button { width:44px; height:44px; min-width:44px; }
.sheet-browser > .sheet-content { flex:1; min-height:0; padding:0 0 env(safe-area-inset-bottom); }
.sheet-browser .photo-card-screen { width:100%; margin:0 auto; }
.browser-sheet-enter-active, .browser-sheet-leave-active { transition:background-color .24s ease,backdrop-filter .24s ease; }
.browser-sheet-enter-active .sheet-browser, .browser-sheet-leave-active .sheet-browser { transition:transform .24s cubic-bezier(.2,.8,.2,1); }
.browser-sheet-enter-from, .browser-sheet-leave-to { background-color:transparent; backdrop-filter:blur(0); }
.browser-sheet-enter-from .sheet-browser, .browser-sheet-leave-to .sheet-browser { transform:translateY(100%); }
@media(prefers-reduced-motion:reduce) { .browser-sheet-enter-active,.browser-sheet-leave-active,.browser-sheet-enter-active .sheet-browser,.browser-sheet-leave-active .sheet-browser { transition:none; } }
</style>
