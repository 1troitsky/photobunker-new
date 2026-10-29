<script setup lang="ts">
const props = defineProps<{ modelValue: string; items: { id: string; label: string }[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
function navigate(event: KeyboardEvent, index: number) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? props.items.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + props.items.length) % props.items.length
  const item = props.items[next]
  if (item) { emit('update:modelValue', item.id); (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus() }
}
</script>
<template><div class="form-tabs" role="tablist"><button v-for="(item, index) in items" :key="item.id" type="button" role="tab" :tabindex="modelValue === item.id ? 0 : -1" :aria-selected="modelValue === item.id" @keydown="navigate($event, index)" @click="$emit('update:modelValue', item.id)">{{ item.label }}</button></div></template>
