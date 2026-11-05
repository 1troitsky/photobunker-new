<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ScreenHeader from '../components/ScreenHeader.vue'
import FormTabs from '../components/FormTabs.vue'
import ToggleRow from '../components/ToggleRow.vue'
import { asLocalPreset, loadStudio, localPresets, savePreset, saveStandardPreset, standardPreset } from '../studio/store'
import { clone, newPreset, retentionSeconds, validatePreset, type Preset } from '../studio/model'
import { WorkspaceConflict } from '../studio/repository'
import { refreshProfiles } from '../profiles/store'
import { s } from '../studio/text'
const route = useRoute(), router = useRouter()
const draft = ref<Preset>(newPreset('')), tab = ref('basics'), ready = ref(false), busy = ref(false), error = ref(''), saveState = ref<'idle'|'saving'|'saved'|'error'>('idle')
let initial = '', timer: ReturnType<typeof setTimeout> | undefined, saveAgain = false, disposed = false
const fresh = computed(() => route.params.id === 'new')
const standard = computed(() => route.params.id === 'standard')
const tabs = computed(() => ['basics','image','metadata','retention'].map(id => ({ id, label: s(id as 'basics' | 'image' | 'metadata' | 'retention') })))
const lifetimes = [0,3600,10800,43200,86400,432000,604800,1209600,1814400,2592000]
const labels = ['never','hour','hours3','hours12','day','days5','days7','days14','days21','days30'] as const
function signature() {
  const value = JSON.parse(JSON.stringify(draft.value)) as Preset
  value.revision = 0
  value.version = 0
  return JSON.stringify(value)
}
onMounted(async () => {
  await Promise.all([loadStudio(), refreshProfiles()])
  const source = String(route.query.copy ?? (fresh.value ? '' : route.params.id))
  const item = standard.value
    ? clone(standardPreset.value)
    : source ? asLocalPreset(source) : newPreset(`${s('preset')} ${localPresets.value.length + 1}`)
  if (!item) { error.value = s('required'); return }
  if (fresh.value && source) { item.id = crypto.randomUUID(); item.revision = item.version = 0; item.originServer = false; item.hidden = false; item.name = `${item.name} (${s('duplicate')})`.slice(0, 80); item.archived = false }
  draft.value = item; initial = signature(); ready.value = true
})
function dimensions(axis = 'width') {
  const rules = draft.value.rules
  if (draft.value.options.size !== 'custom' || rules.aspect === 'native') return
  const ratio = rules.aspect === 'custom' ? rules.aspectWidth / rules.aspectHeight : Number(rules.aspect.split(':')[0]) / Number(rules.aspect.split(':')[1])
  if (axis === 'width') rules.height = Math.round(rules.width / ratio); else rules.width = Math.round(rules.height * ratio)
}
watch(() => draft.value.rules.aspect, () => { if (ready.value) dimensions() })
async function save() {
  if (busy.value || !ready.value) { saveAgain = true; return }
  const snapshot = JSON.parse(JSON.stringify(draft.value)) as Preset
  const invalid = validatePreset(snapshot)
  if (invalid) { saveState.value='error'; error.value = s('required'); return }
  snapshot.rules.retentionSeconds = retentionSeconds(snapshot)
  const savingSignature = signature()
  busy.value = true; saveState.value='saving'; error.value = ''
  try {
    const result = standard.value ? saveStandardPreset(snapshot) : await savePreset(snapshot)
    draft.value.revision = result.revision
    draft.value.version = result.version
    initial = savingSignature
    saveState.value='saved'
    if (fresh.value) {
      const returnTo = typeof route.query.returnTo === 'string' && route.query.returnTo.startsWith('/')
        ? route.query.returnTo : ''
      if (returnTo) await router.replace({ path: returnTo, query: { preset: result.id } })
      else await router.replace(`/camera/presets/${result.id}`)
    }
    if (signature() !== savingSignature || saveAgain) {
      saveAgain=false; scheduleSave(80)
    }
  }
  catch (failure) { saveState.value='error'; error.value = s(failure instanceof WorkspaceConflict ? 'conflict' : 'failed') }
  finally { busy.value = false }
}
function scheduleSave(delay=500) {
  if (!ready.value || disposed) return
  saveState.value='idle'; error.value=''
  if (timer) clearTimeout(timer)
  timer=setTimeout(()=>{timer=undefined;void save()},delay)
}
watch(draft,()=>{if(ready.value&&signature()!==initial){if(busy.value)saveAgain=true;else scheduleSave()}},{deep:true})
onBeforeUnmount(()=>{disposed=true;if(timer)clearTimeout(timer)})
</script>
<template><section class="native-screen native-editor preset-editor"><ScreenHeader :title="s(fresh ? 'newPreset' : 'editPreset')" back="/camera/presets"><span v-if="ready" :class="['editor-save-state',{ 'is-error':saveState==='error'}]" role="status">{{ s(saveState==='saving'?'saving':saveState==='saved'?'saved':'saveAutomatically') }}</span></ScreenHeader><template v-if="ready"><FormTabs v-model="tab" :items="tabs" /><form class="native-form editor-body" @submit.prevent="save"><div v-show="tab === 'basics'" class="form-section"><label>{{ s('name') }}<input v-model="draft.name" maxlength="80" :aria-label="s('name')"></label><label>{{ s('description') }}<textarea v-model="draft.description" rows="3" maxlength="1000" :placeholder="s('optional')" /></label><p class="field-hint">{{ s('localShort') }}</p></div>
  <div v-show="tab === 'image'" class="form-section"><label>{{ s('resolution') }}<select :aria-label="s('resolution')" v-model="draft.options.size"><option v-for="size in (['maximum','high','medium','low','custom'] as const)" :key="size" :value="size">{{ s(size) }}</option></select></label><div v-if="draft.options.size === 'custom'" class="two-fields"><label>{{ s('width') }}<input v-model.number="draft.rules.width" type="number" min="64" max="16384" @change="dimensions()"></label><label>{{ s('height') }}<input v-model.number="draft.rules.height" type="number" min="64" max="16384" @change="dimensions('height')"></label></div><label>{{ s('ratio') }}<select :aria-label="s('ratio')" v-model="draft.rules.aspect"><option value="native">{{ s('native') }}</option><option v-for="ratio in ['1:1','4:3','3:2','16:9']" :key="ratio">{{ ratio }}</option><option value="custom">{{ s('custom') }}</option></select></label><div v-if="draft.rules.aspect === 'custom'" class="two-fields"><label>{{ s('ratioWidth') }}<input v-model.number="draft.rules.aspectWidth" type="number" min="1" max="100" @change="dimensions()"></label><label>{{ s('ratioHeight') }}<input v-model.number="draft.rules.aspectHeight" type="number" min="1" max="100" @change="dimensions()"></label></div><label>{{ s('fit') }}<select :aria-label="s('fit')" v-model="draft.rules.fit"><option value="crop">{{ s('crop') }}</option><option value="contain">{{ s('contain') }}</option></select></label><label>{{ s('quality') }} · {{ Math.round(draft.rules.quality * 100) }}%<input v-model.number="draft.rules.quality" type="range" min="0.6" max="1" step="0.01"></label><p class="field-hint">{{ s('sizeHint') }}</p></div>
  <div v-show="tab === 'metadata'" class="form-section"><div class="form-card"><ToggleRow v-model="draft.options.date" :label="s('date')" /><ToggleRow v-model="draft.options.time" :label="s('time')" /><ToggleRow v-model="draft.rules.keepCamera" :label="s('cameraInfo')" /></div><label>{{ s('location') }}<select :aria-label="s('location')" v-model="draft.rules.location"><option value="off">{{ s('locationOff') }}</option><option value="optional">{{ s('locationOptional') }}</option><option value="required">{{ s('locationRequired') }}</option></select></label><div v-if="draft.rules.location !== 'off'" class="two-fields"><label>{{ s('accuracy') }}<input v-model.number="draft.rules.accuracy" type="number" min="1" max="1000"></label><label>{{ s('locationWindow') }}<input v-model.number="draft.rules.locationWindow" type="number" min="1" max="60"></label></div><p class="field-hint">{{ s('gpsHint') }}</p></div>
  <div v-show="tab === 'retention'" class="form-section"><label>{{ s('deleteAfter') }}<select :aria-label="s('deleteAfter')" v-model="draft.options.retention"><option v-for="(seconds, i) in lifetimes" :key="seconds" :value="seconds">{{ s(labels[i]!) }}</option><option value="custom">{{ s('custom') }}</option></select></label><label v-if="draft.options.retention === 'custom'">{{ s('customHours') }}<input v-model.number="draft.options.customHours" type="number" min="1" max="8760"></label><p class="field-hint">{{ s('retentionHint') }}</p></div><p v-if="error" class="form-error" role="alert">{{ error }}</p></form></template><p v-else-if="error" class="form-error screen-body" role="alert">{{ error }}</p></section></template>
