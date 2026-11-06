<script setup lang="ts">
import ToggleRow from './ToggleRow.vue'
import { publicCardPolicy, type PublicCardPolicy } from '../studio/public-card-policy'
import { locale } from '../i18n'
const props = defineProps<{ modelValue?: PublicCardPolicy; busy?: boolean; assignment?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: PublicCardPolicy] }>()
const labels: Record<keyof PublicCardPolicy, [string,string]> = {
  enabled: ['Разрешить Public card', 'Allow Public card'], contributor: ['Автор и команда', 'Contributor and team'],
  capturedAt: ['Дата съёмки', 'Shot date'], editedAt: ['Дата изменения', 'Edit date'],
  location: ['Координаты GPS', 'GPS coordinates'], description: ['Описание', 'Description'],
  tags: ['Теги', 'Tags'], metadata: ['Технические данные', 'Technical metadata'],
}
function patch(key: keyof PublicCardPolicy, value: boolean) {
  emit('update:modelValue', { ...publicCardPolicy(props.modelValue), [key]: value })
}
</script>
<template>
  <fieldset class="public-card-settings" :disabled="busy">
    <legend>Public card</legend>
    <p class="field-hint">{{ locale === 'ru'
      ? (assignment ? 'Эти параметры получат только новые фотографии задания. Уже снятые не изменятся.' : 'Отдельная карточка по ссылке. Выберите, что увидит получатель. Параметры действуют для новых ссылок; прежние можно отозвать.')
      : (assignment ? 'Applied only to new assignment photos. Existing photos stay unchanged.' : 'A separate card shared by link. Choose what recipients see. Changes apply to new links; existing links can be revoked.') }}</p>
    <ToggleRow :model-value="publicCardPolicy(modelValue).enabled" :label="labels.enabled[locale === 'ru' ? 0 : 1]" @update:model-value="patch('enabled', $event)" />
    <template v-if="publicCardPolicy(modelValue).enabled">
      <ToggleRow v-for="key in (['contributor','capturedAt','editedAt','location','description','tags','metadata'] as const)" :key="key"
        :model-value="publicCardPolicy(modelValue)[key]" :label="labels[key][locale === 'ru' ? 0 : 1]" @update:model-value="patch(key, $event)" />
    </template>
  </fieldset>
</template>
<style scoped>
.public-card-settings { border:0; margin:20px 0 0; padding:0; min-width:0; }
.public-card-settings legend { font-size:16px; font-weight:600; margin-bottom:8px; }
.public-card-settings .field-hint { margin:0 0 12px; line-height:1.5; }
</style>
