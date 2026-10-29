<script setup lang="ts">
import { useId } from 'vue'
const hintId = useId()
defineProps<{ modelValue: boolean; label: string; hint?: string; disabled?: boolean }>()
defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>
<template><label class="toggle-row"><span><strong>{{ label }}</strong><small v-if="hint" :id="hintId">{{ hint }}</small></span><input type="checkbox" role="switch" :aria-label="label" :aria-describedby="hint ? hintId : undefined" :checked="modelValue" :disabled="disabled" @change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)"></label></template>
