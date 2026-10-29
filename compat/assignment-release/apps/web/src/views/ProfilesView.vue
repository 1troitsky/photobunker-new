<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ScreenHeader from '../components/ScreenHeader.vue'
import AppIcon from '../components/AppIcon.vue'
import AppSheet from '../components/AppSheet.vue'
import { activeProfile, refreshProfiles, selectProfile } from '../profiles/store'
import { asLocalPreset, choosePreset, clearStudioSession, loadStudio, localPresets, presetChoices, removeItem, savePreset, studioError, studioSession } from '../studio/store'
import { clone, type Preset, type Size } from '../studio/model'
import type { Profile } from '../profiles/model'
import { s } from '../studio/text'
import { p } from '../profiles/text'
const router = useRouter(), archived = ref(false), menu = ref<Profile>(), busy = ref(false), failed = ref(false)
const visible = computed(() => presetChoices.value.filter(item => !!item.archived === archived.value))
const selected = computed(() => studioSession.value ? studioSession.value.preset?.id ?? '' : activeProfile.value?.id ?? '')
function use(item?: Profile) { if (!item || 'uiOnly' in item) choosePreset(item ? clone(item as Preset) : null); else { clearStudioSession(); selectProfile(item.id) }; void router.push('/camera') }
async function action(kind: 'edit' | 'duplicate' | 'archive' | 'remove') {
  if (!menu.value || busy.value) return
  const item = asLocalPreset(menu.value.id)!; menu.value = undefined; failed.value = false
  if (kind === 'edit') { await router.push(`/camera/presets/${item.id}`); return }
  if (kind === 'remove' && !confirm(s('deleteItem'))) return
  busy.value = true
  try {
    if (kind === 'duplicate') { item.id = crypto.randomUUID(); item.revision = item.version = 0; item.archived = false; item.originServer = false; item.hidden = false; item.name = (item.name + p('copySuffix')).slice(0, 80); await savePreset(item) }
    else if (kind === 'archive') { item.archived = !item.archived; await savePreset(item) }
    else { if (localPresets.value.some(value => value.id === item.id) && !item.originServer) await removeItem('presets', item); else { item.hidden = true; await savePreset(item) }; if (studioSession.value?.preset?.id === item.id && !studioSession.value.taskId) choosePreset(null) }
  } catch { failed.value = true } finally { busy.value = false }
}
onMounted(() => { void loadStudio(); void refreshProfiles() })
</script>
<template><section class="native-screen presets-screen"><ScreenHeader :title="s('presets')" back="/camera"><button class="app-icon-button" :aria-label="s('newPreset')" @click="router.push('/camera/presets/new')"><AppIcon name="plus" /></button><button class="app-icon-button" :aria-label="s('archived')" :aria-pressed="archived" @click="archived = !archived"><AppIcon name="archive" /></button></ScreenHeader><div class="screen-body"><p v-if="failed || studioError" class="form-error" role="alert">{{ s('failed') }}</p>
  <button v-if="!archived" class="preset-tile standard-tile" :class="{ 'tile-selected': !selected }" @click="use()"><span class="preset-tile-icon"><AppIcon name="camera" /></span><span><strong>{{ s('standard') }}</strong><small>{{ s('maximum') }} · {{ s('days14') }}</small></span><AppIcon v-if="!selected" name="check" /><AppIcon v-else name="chevron" /></button><p v-if="archived" class="section-caption">{{ s('archived') }}</p>
  <article v-for="item in visible" :key="item.id" class="preset-tile" :class="{ 'tile-selected': selected === item.id }"><button class="preset-tile-main" :disabled="archived || busy" @click="use(item)"><span class="preset-tile-icon"><AppIcon name="settings" /></span><span><strong>{{ item.name }}</strong><small>{{ item.rules.aspect === 'native' ? s('native') : item.rules.aspect === 'custom' ? `${item.rules.aspectWidth}:${item.rules.aspectHeight}` : item.rules.aspect }} · {{ item.rules.resolution === 'fixed' ? `${item.rules.width} × ${item.rules.height}` : s('options' in item ? (item as Preset).options.size as Size : 'maximum') }}</small><small v-if="'uiOnly' in item" class="local-caption">{{ s('device') }}</small></span><AppIcon v-if="selected === item.id" name="check" /></button><button class="app-icon-button" :aria-label="`${s('more')}: ${item.name}`" @click="menu = item"><AppIcon name="more" /></button></article>
  <div v-if="!visible.length" class="native-empty"><AppIcon name="settings" /><h2>{{ archived ? s('archived') : s('noPresets') }}</h2><p v-if="!archived">{{ s('presetsEmpty') }}</p><button v-if="!archived" class="primary-button" @click="router.push('/camera/presets/new')"><AppIcon name="plus" />{{ s('newPreset') }}</button></div></div>
  <AppSheet :open="!!menu" :title="menu?.name ?? ''" @close="menu = undefined"><div class="action-list"><button @click="action('edit')"><AppIcon name="edit" />{{ s('edit') }}</button><button @click="action('duplicate')"><AppIcon name="copy" />{{ s('duplicate') }}</button><button @click="action('archive')"><AppIcon name="archive" />{{ s(menu?.archived ? 'restore' : 'archive') }}</button><button class="subtle-danger" @click="action('remove')"><AppIcon name="trash" />{{ s('remove') }}</button></div></AppSheet></section></template>
