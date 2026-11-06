<script setup lang="ts">
import { markRaw, ref, shallowRef, watch, type Component } from 'vue'
import { useRoute } from 'vue-router'
import AppSheet from './AppSheet.vue'
import { publicCardPreview, closePublicCard } from '../studio/public-card-policy'
import { account, deviceId } from '../identity/store'
import { appLocked } from '../app/lock'
import { strongUnlocked, warmLocked } from '../crypto/store'
import { q } from '../crypto/text'

const route = useRoute(), content = shallowRef<Component>(), error = ref(''), externalBusy = ref(false), externalUrl = ref('')
async function load() {
  error.value = ''
  try { content.value = markRaw((await import('../views/PhotoCardView.vue')).default) }
  catch { error.value = q('Не удалось открыть карточку. Повторите загрузку.') }
}
watch(publicCardPreview, request => { externalUrl.value = ''; if (request) { error.value = ''; if (!content.value) void load() } })
// The overlay shares the existing session, but never survives a scope/lock change.
watch([() => account.value?.id, deviceId, appLocked, strongUnlocked, warmLocked, () => route.fullPath], closePublicCard, {flush:'sync'})
async function openExternal() {
  const request = publicCardPreview.value
  if (!request || externalBusy.value) return
  externalBusy.value = true; error.value = ''
  try {
    const { createPublicCardLink } = await import('../studio/card-share-images')
    const url = await createPublicCardLink(request.id)
    if (publicCardPreview.value !== request) return
    externalUrl.value = url
  } catch {
    if (publicCardPreview.value === request) error.value = q('Не удалось подготовить ссылку. Проверьте соединение и завершение отправки фотографии, затем повторите.')
  } finally { externalBusy.value = false }
}
</script>
<template>
  <AppSheet :open="!!publicCardPreview" title="Public card" browser @close="closePublicCard">
    <template #actions><a v-if="externalUrl" :href="externalUrl" class="public-card-external" target="_blank" rel="noopener noreferrer" :aria-label="q('Открыть в браузере устройства')">{{ q('Открыть в браузере') }} ↗</a><button v-else class="public-card-external" type="button" :disabled="externalBusy" :aria-label="q('Открыть в браузере устройства')" @click="openExternal">{{ q(externalBusy ? 'Подготовка…' : 'Открыть в браузере') }} ↗</button></template>
    <p v-if="externalUrl" class="public-card-browser-message" role="status">{{ q('Ссылка готова. Нажмите «Открыть в браузере».') }}</p>
    <div v-if="error" class="public-card-browser-message" role="alert"><p>{{ error }}</p><button v-if="!content" class="secondary-button" type="button" @click="load">{{ q('Повторить') }}</button></div>
    <component :is="content" v-if="content && publicCardPreview" :key="publicCardPreview.id" :photo-id="publicCardPreview.id" :initial-share="publicCardPreview.share" embedded @close="closePublicCard" />
    <p v-else-if="!error" class="public-card-browser-message" role="status">{{ q('Открываем карточку…') }}</p>
  </AppSheet>
</template>
<style scoped>
.public-card-external { display:inline-flex; align-items:center; text-decoration:none; min-height:44px; padding:0 8px; border:0; background:transparent; color:var(--accent); font:inherit; font-size:13px; cursor:pointer; }
.public-card-external:disabled { opacity:.5; }
.public-card-browser-message { padding:16px 20px; line-height:1.5; }
</style>
