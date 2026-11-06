<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { Photo } from '../local/photos'
import AppIcon from './AppIcon.vue'
import { account, deviceId } from '../identity/store'
import { appLocked } from '../app/lock'
import { strongUnlocked, warmLocked } from '../crypto/store'
import { effectivePublicCardPolicy } from '../studio/public-card-policy'
import { createPublicCardLink } from '../studio/card-share-images'
import { usePageIssue, usePageLoad } from '../app/page-load'
import { openStatusDetails } from '../app/status'
import { q } from '../crypto/text'
const props = defineProps<{ photo: Photo; menu?: boolean; versionKey?: string }>()
const url = ref(''), pending = ref(false), failed = ref(false), message = ref('')
usePageLoad(pending)
// A cached list entry is not an authoritative server grant or upload receipt.
// The publisher re-reads and checks the current protected photo before exporting.
const allowed = computed(() => effectivePublicCardPolicy(props.photo).enabled)
usePageIssue(failed, {detail:() => message.value,retry:openCard})
const scope = computed(() => JSON.stringify([account.value?.id,deviceId.value,appLocked.value,
  strongUnlocked.value,warmLocked.value,props.photo.id,props.photo.remoteRevision,props.photo.expiresAt,
  props.photo.title,props.photo.note,props.photo.tags,props.photo.metadata,props.versionKey,allowed.value]))
let epoch = 0
let opening: Window | null = null
let retryAfterSecurity = false
function securityChanged() {
  if (url.value || appLocked.value || !strongUnlocked.value || warmLocked.value) return
  // Local keys can open a cached photo before the server read proof finishes.
  // A refreshed proof does not change strongUnlocked, so the scope watcher
  // alone never retried a card rejected during that initial window.
  if (pending.value) retryAfterSecurity = true
  else void prepare(!!opening)
}
window.addEventListener('photobunker-photo-security', securityChanged)
function closePreparingWindow() {
  opening?.close()
  opening = null
}
async function openCard() {
  if (opening && !opening.closed) { opening.focus(); return }
  if (appLocked.value || !allowed.value || !strongUnlocked.value || warmLocked.value) {
    await prepare(true)
    return
  }
  // Reserve the external browser window inside the tap, before any awaits.
  // Opening it only after publication loses user activation on mobile browsers.
  const browser = window.open('about:blank', '_blank')
  if (!browser) {
    message.value = q('Браузер заблокировал новое окно. Разрешите открытие окон для PhotoBunker и повторите.')
    failed.value = true
    await nextTick(); openStatusDetails()
    return
  }
  opening = browser
  browser.opener = null
  browser.document.title = 'Public card'
  const referrer = browser.document.createElement('meta')
  referrer.name = 'referrer'; referrer.content = 'no-referrer'
  browser.document.head.append(referrer)
  browser.document.documentElement.style.colorScheme = 'light dark'
  Object.assign(browser.document.body.style, {margin:'0',minHeight:'100dvh',display:'grid',placeItems:'center',fontFamily:'system-ui,sans-serif'})
  const status = browser.document.createElement('p')
  status.setAttribute('role', 'status')
  status.textContent = q('Подготовка Public card…')
  browser.document.body.append(status)
  await prepare(true)
}
async function prepare(showDetails = false) {
  const token = ++epoch
  url.value = ''; failed.value = false; message.value = ''
  pending.value = false
  if (appLocked.value) return
  if (!allowed.value || !strongUnlocked.value || warmLocked.value) {
    closePreparingWindow()
    message.value = q(!allowed.value ? 'Публичная карточка выключена разрешениями фотографии или задания.' : 'Откройте доступ к защищённым фотографиям, чтобы опубликовать карточку.')
    failed.value = showDetails
    if (showDetails) { await nextTick(); openStatusDetails() }
    return
  }
  pending.value = true
  try {
    const result = await createPublicCardLink(props.photo.id, scope.value)
    if (token === epoch) {
      url.value = result
      const browser = opening
      opening = null
      if (browser && !browser.closed) browser.location.replace(result)
    }
  } catch (error) {
    if (token === epoch) {
      if (retryAfterSecurity) return
      closePreparingWindow()
      const code = error instanceof Error ? error.message : ''
      const status = (error as {status?:number})?.status
      message.value = q(code === 'public_card.disabled' ? 'Публичная карточка выключена разрешениями фотографии или задания.'
        : code === 'card_share.denied' || status === 403 ? 'Нет разрешения на публичную публикацию этой фотографии.'
        : code === 'card_share.not_uploaded' || status === 404 ? 'Фотография ещё не отправлена на сервер. Дождитесь синхронизации и повторите.'
        : code === 'version.unavailable' ? 'Обработка фотографии ещё не отправлена на сервер. Дождитесь синхронизации и повторите.'
        : 'Не удалось подготовить публичную карточку. Проверьте соединение и повторите.')
      failed.value=true
      if (showDetails) { await nextTick(); openStatusDetails() }
    }
  } finally {
    if (token === epoch) {
      pending.value=false
      if (retryAfterSecurity) {
        retryAfterSecurity=false
        if (!url.value) void prepare(showDetails || !!opening)
      }
    }
  }
}
watch([() => account.value?.id,deviceId,appLocked,strongUnlocked,warmLocked,() => props.photo.id], closePreparingWindow, {flush:'sync'})
watch(scope, () => {
  if (appLocked.value) closePreparingWindow()
  void prepare(!!opening)
}, {immediate:true,flush:'sync'})
onBeforeUnmount(() => {epoch++;closePreparingWindow();url.value='';pending.value=false;window.removeEventListener('photobunker-photo-security',securityChanged)})
async function share() {
  if (!url.value) return
  try {
    if (navigator.share) await navigator.share({title:props.photo.title,url:url.value})
    else { await navigator.clipboard.writeText(url.value); message.value=q('Ссылка скопирована') }
  } catch (error) { if (!(error instanceof DOMException && error.name==='AbortError')) message.value=q('Не удалось поделиться ссылкой.') }
}
</script>
<template>
  <a v-if="url" :href="url" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"
    :class="['public-card-link',{'public-card-menu-link':menu}]" :aria-label="q('Открыть Public card в браузере')"><AppIcon name="profiles" /><span>Public card</span></a>
  <button v-else type="button" :class="['public-card-link',{'public-card-menu-link':menu}]" :disabled="appLocked" :aria-busy="pending" :title="message" @click="openCard"><AppIcon name="profiles" /><span>{{ q(pending ? 'Public card…' : failed ? 'Повторить Public card' : 'Public card') }}</span></button>
  <button v-if="menu && url" class="public-card-link public-card-menu-link" type="button" @click="share"><AppIcon name="share" /><span>{{ q('Поделиться карточкой') }}</span></button>
  <p v-if="menu && message" class="field-hint" role="status">{{ message }}</p>
</template>
<style scoped>
.public-card-link { display:flex; min-height:44px; min-width:0; align-items:center; justify-content:center; flex-direction:column; gap:4px; padding:4px; color:var(--text); background:transparent; border:0; text-decoration:none; cursor:pointer; font:inherit; font-size:12px; }
.public-card-link:disabled { opacity:.45; cursor:default; }
.public-card-link svg { width:20px; height:20px; flex-shrink:0; }
.public-card-link span { font-size:12px; line-height:1.2; }
.public-card-menu-link { width:100%; flex-direction:row; justify-content:flex-start; padding:12px 0; gap:12px; text-align:left; }
.public-card-menu-link span { font-size:14px; }
.public-card-link:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; border-radius:8px; }
</style>
