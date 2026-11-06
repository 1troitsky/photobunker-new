<script setup lang="ts">
import { inject, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useRoute } from 'vue-router'
import { appStatusKey, statusDetailsRequest } from '../app/status'
import { locale } from '../i18n'
import AppIcon from './AppIcon.vue'

const status = inject(appStatusKey)
const open = ref(false), retrying = ref(false), retryFailed = ref(false)
const button = ref<HTMLButtonElement>(), toast = ref<HTMLElement>()
const id = 'status-' + useId(), route = useRoute()
async function toggle() {
  open.value = !open.value; retryFailed.value = false
  if (open.value) { await nextTick(); toast.value?.focus({ preventScroll: true }) }
}
function close(restore = false) {
  open.value = false
  if (restore) button.value?.focus({ preventScroll: true })
}
function outside(event: PointerEvent) {
  if (open.value && !button.value?.contains(event.target as Node) && !toast.value?.contains(event.target as Node)) close()
}
async function retry() {
  const action = status?.value?.retry
  if (!action || retrying.value) return
  retrying.value = true; retryFailed.value = false
  try { await action() } catch { retryFailed.value = true }
  finally { retrying.value = false }
}
watch(() => route.fullPath, () => close())
watch(() => status?.value, value => { if (!value) close() })
watch(statusDetailsRequest, async () => {
  if (!status?.value) return
  open.value=true; retryFailed.value=false
  await nextTick(); toast.value?.focus({preventScroll:true})
})
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>
<template>
  <button v-if="status" ref="button" type="button" :class="['app-status-indicator', 'is-' + status.tone]"
    :aria-label="status.label" :aria-expanded="open" :aria-controls="id" @click="toggle">
    <span class="app-status-dot" aria-hidden="true" /><span class="app-status-label">{{ status.label }}</span>
  </button>
  <Teleport to="body">
    <section v-if="open && status" :id="id" ref="toast" class="app-status-toast" role="dialog"
      :aria-label="status.label" tabindex="-1" @keydown.esc.prevent.stop="close(true)">
      <header><strong>{{ status.label }}</strong><button class="app-icon-button" type="button"
        :aria-label="locale === 'ru' ? 'Закрыть' : 'Close'" @click="close(true)"><AppIcon name="close" /></button></header>
      <p aria-live="polite">{{ status.detail }}</p>
      <p v-if="retryFailed" class="form-error" role="alert">{{ locale === 'ru' ? 'Повторить сейчас не удалось. Проверьте соединение и попробуйте ещё раз.' : 'Could not retry. Check your connection and try again.' }}</p>
      <button v-if="status.retry" class="secondary-button" type="button" :disabled="retrying" @click="retry">
        {{ locale === 'ru' ? 'Повторить' : 'Retry' }}
      </button>
    </section>
  </Teleport>
</template>
<style scoped>
.app-status-indicator { position:relative; display:inline-flex; align-items:center; gap:5px; max-width:100%; min-width:0; min-height:20px; padding:0; border:0; background:transparent; color:var(--secondary); font:inherit; font-size:10px; line-height:20px; text-align:left; cursor:pointer; }
.app-status-indicator::after { content:''; position:absolute; inset:-12px 0; }
.app-status-dot { width:7px; height:7px; flex:0 0 7px; border-radius:50%; background:var(--status-warning); }
.is-success .app-status-dot { background:var(--status-success); }
.is-error .app-status-dot { background:var(--status-error); }
.app-status-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.app-status-indicator:focus-visible { outline:2px solid var(--accent); outline-offset:3px; border-radius:4px; }
.app-status-toast { position:fixed; top:calc(var(--native-header,64px) + env(safe-area-inset-top) + 8px); right:max(12px,env(safe-area-inset-right)); width:min(360px,calc(100% - 24px)); z-index:110; padding:12px 16px 16px; border:1px solid var(--border); border-radius:16px; background:var(--surface); color:var(--text); box-shadow:0 12px 40px #0003; outline:none; }
.app-status-toast header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.app-status-toast header strong { font-size:15px; }
.app-status-toast header button { width:44px; height:44px; }
.app-status-toast p { margin:8px 0 16px; color:var(--secondary); font-size:14px; line-height:1.6; white-space:pre-line; }
</style>
