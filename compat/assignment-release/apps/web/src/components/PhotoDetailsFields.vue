<script setup lang="ts">
import { computed, useId } from 'vue'
import type { Photo } from '../local/photos'
import { categoryLimited, type PhotoDetailsDraft } from '../studio/details'
import { metadataEditable } from '../collaboration/access'
import { personalCategories } from '../studio/store'
import { s } from '../studio/text'
const props = defineProps<{ photo: Photo; modelValue: PhotoDetailsDraft; busy?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: PhotoDetailsDraft] }>()
const listId = useId(), limited = computed(() => categoryLimited(props.photo))
function patch(field: keyof PhotoDetailsDraft, event: Event) { emit('update:modelValue', { ...props.modelValue, [field]: (event.target as HTMLInputElement).value }) }
const readonly = computed(() => props.photo.access?.role === 'viewer')
function locked(field: 'title' | 'note' | 'category') { return !metadataEditable(props.photo) && !!props.photo[field] }
</script>
<template>
  <fieldset class="photo-details-fields native-form" :disabled="busy || readonly">
    <label>{{ s('name') }}<input :value="modelValue.title" :disabled="locked('title')" maxlength="120" @input="patch('title', $event)"></label>
    <label>{{ s('description') }}<textarea :value="modelValue.note" :disabled="locked('note')" maxlength="2000" rows="3" @input="patch('note', $event)" /></label>
    <label>{{ s('category') }}
      <select v-if="limited" :aria-label="s('category')" :disabled="locked('category')" :value="modelValue.category" @change="patch('category', $event)"><option value="">{{ s('noCategory') }}</option><option v-for="category in photo.profile?.rules.categories" :key="category">{{ category }}</option></select>
      <input v-else :disabled="locked('category')" :value="modelValue.category" :list="listId" maxlength="80" :placeholder="s('enterCategory')" @input="patch('category', $event)">
    </label>
    <datalist :id="listId"><option v-for="category in personalCategories" :key="category" :value="category" /></datalist>
    <p v-if="photo.uiRules?.descriptionRequired" class="field-hint">{{ s('minLength') }}: {{ photo.uiRules.minLength }}</p>
    <div class="two-fields"><label>{{ s('latitude') }}<input :disabled="!photo.uiOnly" :value="modelValue.latitude" inputmode="decimal" maxlength="24" @input="patch('latitude', $event)"></label><label>{{ s('longitude') }}<input :disabled="!photo.uiOnly" :value="modelValue.longitude" inputmode="decimal" maxlength="24" @input="patch('longitude', $event)"></label></div>
    <button v-if="photo.uiOnly && (modelValue.latitude || modelValue.longitude)" class="quiet-button" type="button" @click="emit('update:modelValue', {...modelValue, latitude:'', longitude:''})">{{ s('clearLocation') }}</button>
    <p class="field-hint">{{ s(photo.uiOnly ? 'coordinatesHint' : 'legacyCoordinates') }}</p>
    <label>{{ s('tags') }}<input :value="modelValue.tags" maxlength="820" :placeholder="s('tagsHint')" @input="patch('tags', $event)"></label>
  </fieldset>
</template>
