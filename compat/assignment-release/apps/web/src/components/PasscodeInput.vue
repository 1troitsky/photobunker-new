<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  length?: number
  label: string
  disabled?: boolean
  autofocus?: boolean
}>(), { length: 8, disabled: false, autofocus: false })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const input = ref<HTMLInputElement>()
const count = computed(() => Math.max(4, Math.min(10, props.length)))
function update(event: Event) {
  const value = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 10)
  emit('update:modelValue', value)
}
function focus() { input.value?.focus() }
onMounted(() => {
  if (props.autofocus) void nextTick(focus)
})
defineExpose({ focus })
</script>

<template>
  <label class="passcode-entry" :aria-label="label" @click="focus">
    <input ref="input" :value="modelValue" type="password" inputmode="numeric"
      pattern="[0-9]*" autocomplete="one-time-code" :autofocus="autofocus"
      :disabled="disabled" maxlength="10" @input="update" />
    <span class="passcode-dots" aria-hidden="true">
      <i v-for="index in count" :key="index" :class="{ filled: index <= modelValue.length }" />
    </span>
  </label>
</template>
