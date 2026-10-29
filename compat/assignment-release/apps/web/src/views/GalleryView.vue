<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import PhotoThumbnail from '../components/PhotoThumbnail.vue'
import { locale, t, formatNumber } from '../i18n'
import { libraryError, libraryLoading, photos, refreshLibrary, serverError } from '../local/library'
import { useRoute, useRouter } from 'vue-router'
import { profiles } from '../profiles/store'
import { missingRequirements } from '../profiles/model'
import { deletePhoto, updatePhoto } from '../server/photos'
import { libraryChanged } from '../local/library'
import { d } from '../delivery/text'
import ScreenHeader from '../components/ScreenHeader.vue'
import AppSheet from '../components/AppSheet.vue'
import { s } from '../studio/text'
import { downloadPhotos } from '../studio/export'
import { nameText } from '../local/photo-name-text'
const filtersOpen = ref(false), searchOpen = ref(false)
const activeFilters = computed(() => [profileFilter.value, category.value, completion.value, from.value, through.value, favorites.value].filter(Boolean).length)
function resetFilters() { profileFilter.value = ''; category.value = completion.value = from.value = through.value = ''; favorites.value = false }
async function exportSelected() { if (bulkBusy.value) return; bulkBusy.value = true; try { await downloadPhotos(selected.value) } catch { bulkStatus.value = s('failed') } finally { bulkBusy.value = false } }
const route = useRoute(); const router = useRouter()
const profileFilter = computed({ get: () => String(route.query.profile ?? ''), set: value => { void router.replace({ query: value ? { profile: value } : {} }) } })
const profileChoices = computed(() => [...new Map([...photos.value.filter(photo => photo.profile).map(photo => [photo.profile!.id, photo.profile!.name] as const), ...profiles.value.map(profile => [profile.id, profile.name] as const)]).entries()])
const search = ref('')
const favorites = ref(false)
const category = ref(''); const completion = ref(''); const from = ref(''); const through = ref('')
const choosing = ref(false); const selected = ref<string[]>([]); const bulkBusy = ref(false); const bulkStatus = ref('')
const categories = computed(() => [...new Set(photos.value.filter(photo => !profileFilter.value || photo.profile?.id === profileFilter.value).map(photo => photo.category).filter(Boolean))] as string[])
function toggle(id: string) { selected.value = selected.value.includes(id) ? selected.value.filter(value => value !== id) : [...selected.value, id] }
watch([profileFilter, search, favorites, category, completion, from, through], () => { selected.value = []; bulkStatus.value = '' })
watch(photos, () => { selected.value = selected.value.filter(id => photos.value.some(photo => photo.id === id)) })
async function bulk(action: 'delete' | 'favorite' | 'shorten') {
  if (bulkBusy.value || !selected.value.length || action === 'delete' && !confirm(d('bulkConfirm'))) return
  bulkBusy.value = true; bulkStatus.value = ''
  const failed: string[] = []
  for (const id of [...selected.value]) {
    const photo = photos.value.find(item => item.id === id)
    if (!photo) continue
    if (photo.workspaceAccess && !(action === 'delete' ? photo.workspaceAccess.delete : photo.workspaceAccess.edit)) {failed.push(id); continue}
    try {
      if (action === 'delete') await deletePhoto(id)
      else await updatePhoto(id, { title: photo.title, note: photo.note, favorite: action === 'favorite' ? true : photo.favorite, ...(action === 'shorten' ? { expiresAt: Math.min(photo.expiresAt ?? Infinity, Date.now() + 3600_000) } : {}) }, photo.remoteRevision, photo)
    } catch { failed.push(id) }
  }
  selected.value = failed; bulkStatus.value = d(failed.length ? 'bulkFailed' : 'bulkDone'); bulkBusy.value = false; libraryChanged()
}
const visible = computed(() => photos.value.filter(photo => (!profileFilter.value || (profileFilter.value === 'legacy' ? !photo.profile : photo.profile?.id === profileFilter.value)) && (!favorites.value || photo.favorite) && (!category.value || photo.category === category.value) && (!completion.value || (completion.value === 'complete') === !missingRequirements(photo).length) && (!from.value || photo.createdAt >= new Date(`${from.value}T00:00:00`).getTime()) && (!through.value || photo.createdAt < new Date(`${through.value}T23:59:59.999`).getTime() + 1) && `${photo.shortId ?? ''} ${photo.profile?.name ?? ''} ${photo.category ?? ''} ${(photo.tags ?? []).join(' ')} ${photo.shot ?? ''} ${photo.title} ${photo.note} ${photo.method === 'demo' ? t('testPhoto') : t('photo')}`.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())))
const day = (time: number) => new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'long', year: 'numeric' }).format(time)
const groups = computed(() => {
  const result: { day: string; photos: typeof photos.value }[] = []
  for (const photo of visible.value) { const label = day(photo.createdAt); const last = result.at(-1); if (last?.day === label) last.photos.push(photo); else result.push({ day: label, photos: [photo] }) }
  return result
})
onMounted(refreshLibrary)
</script>

<template>
  <section class="native-screen gallery-screen"><ScreenHeader :title="s('photos')"><button class="app-icon-button" :aria-label="s('search')" :aria-pressed="searchOpen" @click="searchOpen = !searchOpen; search = ''"><AppIcon name="search" /></button><button class="app-icon-button filter-button" :aria-label="s('filters')" @click="filtersOpen = true"><AppIcon name="filter" /><span v-if="activeFilters" class="control-dot" /></button><button v-if="photos.some(photo => photo.access?.role !== 'viewer')" class="app-icon-button" :aria-label="s('select')" :aria-pressed="choosing" @click="choosing = !choosing; selected = []"><AppIcon :name="choosing ? 'close' : 'check'" /></button></ScreenHeader>
    <div class="screen-body"><input v-if="searchOpen" v-model="search" class="screen-search" type="search" :placeholder="t('searchPhotos')" :aria-label="t('searchPhotos')"><p v-if="bulkStatus" class="form-error" role="status">{{ bulkStatus }}</p><p v-if="serverError" class="field-hint" role="status">{{ t('serverUnavailable') }}</p><div v-if="libraryError" class="native-empty"><AppIcon name="offline" /><h2>{{ t('storageFailed') }}</h2><button class="secondary-button" @click="refreshLibrary">{{ t('retry') }}</button></div><p v-else-if="libraryLoading && !photos.length" class="loading-state" role="status">{{ t('loading') }}</p>
    <template v-else-if="visible.length"><section v-for="group in groups" :key="group.day" class="photo-day"><h2>{{ group.day }}<span>{{ formatNumber(group.photos.length) }}</span></h2><div class="native-photo-grid"><button v-for="photo in group.photos" :key="photo.id" :class="['native-photo-tile', { 'photo-chosen': selected.includes(photo.id) }]" :aria-label="`${choosing ? s('select') : s('preview')}: ${photo.shortId || photo.title || (photo.needsName ? nameText('pending') : s('photo'))}`" :aria-pressed="choosing ? selected.includes(photo.id) : undefined" :disabled="choosing && photo.access?.role === 'viewer'" @click="choosing ? toggle(photo.id) : router.push(`/gallery/${photo.id}`)"><PhotoThumbnail :id="photo.id" :access-key="photo.accountId ? `${photo.remoteRevision}:${photo.thumbnailOnly}` : undefined" :alt="photo.title || s('photo')" /><span class="tile-caption">{{ photo.category || photo.shortId || photo.title || (photo.needsName ? nameText('pending') : s('photo')) }}</span><span v-if="photo.favorite" class="tile-star"><AppIcon name="star" /></span><span v-if="choosing" class="tile-check"><AppIcon v-if="selected.includes(photo.id)" name="check" /></span><span v-if="missingRequirements(photo).length" class="tile-incomplete" :aria-label="s('incomplete')" /></button></div></section></template>
    <div v-else class="native-empty"><AppIcon name="gallery" /><h2>{{ photos.length ? s('noResults') : s('noMaterials') }}</h2><button v-if="photos.length" class="secondary-button" @click="resetFilters(); search = ''">{{ s('reset') }}</button><button v-else class="primary-button" @click="router.push('/camera')"><AppIcon name="camera" />{{ s('capture') }}</button></div></div>
    <div v-if="choosing" class="selection-toolbar"><span>{{ s('selected') }} · {{ formatNumber(selected.length) }}</span><button class="app-icon-button" :aria-label="s('selectAll')" @click="selected = visible.filter(photo => photo.access?.role !== 'viewer').map(photo => photo.id)"><AppIcon name="check" /></button><button class="app-icon-button" :aria-label="s('favorites')" :disabled="bulkBusy || !selected.length" @click="bulk('favorite')"><AppIcon name="star" /></button><button class="app-icon-button" :aria-label="s('export')" :disabled="bulkBusy || !selected.length" @click="exportSelected"><AppIcon name="download" /></button><button class="app-icon-button subtle-danger" :aria-label="s('remove')" :disabled="bulkBusy || !selected.length" @click="bulk('delete')"><AppIcon name="trash" /></button></div>
    <AppSheet :open="filtersOpen" :title="s('filters')" @close="filtersOpen = false"><div class="native-form"><label>{{ s('preset') }}<select :aria-label="s('preset')" v-model="profileFilter"><option value="">{{ s('all') }}</option><option v-for="[id, name] in profileChoices" :key="id" :value="id">{{ name }}</option><option value="legacy">{{ s('standard') }}</option></select></label><label>{{ s('category') }}<select :aria-label="s('category')" v-model="category"><option value="">{{ s('all') }}</option><option v-for="item in categories" :key="item">{{ item }}</option></select></label><label>{{ s('completion') }}<select :aria-label="s('completion')" v-model="completion"><option value="">{{ s('all') }}</option><option value="complete">{{ s('complete') }}</option><option value="incomplete">{{ s('incomplete') }}</option></select></label><div class="two-fields"><label>{{ s('from') }}<input v-model="from" type="date"></label><label>{{ s('through') }}<input v-model="through" type="date"></label></div><label class="plain-check"><input v-model="favorites" type="checkbox">{{ s('favorites') }}</label><div class="sheet-footer"><button class="secondary-button" @click="resetFilters">{{ s('reset') }}</button><button class="primary-button" @click="filtersOpen = false">{{ s('done') }} · {{ formatNumber(visible.length) }}</button></div></div></AppSheet>
  </section>
</template>
