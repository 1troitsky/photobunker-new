<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Photo } from '../local/photos'
import AppIcon from './AppIcon.vue'
import { account, deviceId } from '../identity/store'
import { appLocked } from '../app/lock'
import { strongUnlocked, warmLocked } from '../crypto/store'
import { effectivePublicCardPolicy } from '../studio/public-card-policy'
import { createPublicCardLink } from '../studio/card-share-images'
import { usePageLoad } from '../app/page-load'
import { q } from '../crypto/text'
const props = defineProps<{ photo: Photo; menu?: boolean; versionKey?: string }>()
const url = ref(''), pending = ref(false), failed = ref(false), message = ref('')
usePageLoad(pending)
const allowed = computed(() => effectivePublicCardPolicy(props.photo).enabled &&
  props.photo.workspaceAccess?.read && props.photo.workspaceAccess?.shareExternal)
const scope = computed(() => JSON.stringify([account.value?.id,deviceId.value,appLocked.value,
  strongUnlocked.value,warmLocked.value,props.photo.id,props.photo.remoteRevision,props.photo.expiresAt,
  props.photo.title,props.photo.note,props.photo.tags,props.photo.metadata,props.versionKey,allowed.value]))
let epoch = 0
async function prepare() {
  const token = ++epoch
  url.value = ''; failed.value = false; message.value = ''
  if (!allowed.value || appLocked.value || !strongUnlocked.value || warmLocked.value) { pending.value=false; return }
  if (props.photo.remoteRevision === undefined) { message.value=q('Карточка будет доступна после отправки фотографии.'); return }
  pending.value = true
  try {
    const result = await createPublicCardLink(props.photo.id, scope.value)
    if (token === epoch) url.value = result
  } catch {
    if (token === epoch) { failed.value=true; message.value=q('Не удалось открыть публичную карточку. Проверьте соединение и повторите.'); }
  } finally { if (token === epoch) pending.value=false }
}
watch(scope, prepare, {immediate:true,flush:'sync'})
onBeforeUnmount(() => {epoch++;url.value='';pending.value=false})
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
  <button v-else type="button" :class="['public-card-link',{'public-card-menu-link':menu}]" :disabled="!failed" :title="message || (!allowed ? q('Публичная карточка запрещена разрешениями фотографии или задания.') : '')" @click="prepare"><AppIcon name="profiles" /><span>{{ q(pending ? 'Public card…' : failed ? 'Повторить Public card' : 'Public card') }}</span></button>
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
