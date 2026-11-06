<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  length?: number
  label: string
  disabled?: boolean
  autofocus?: boolean
  /** Lock screen only: reset input immediately on N digits, no timers. */
  autoClear?: boolean
}>(), { length: 8, disabled: false, autofocus: false, autoClear: false })
const emit = defineEmits<{ 'update:modelValue': [value: string]; complete: [value: string] }>()
const input = ref<HTMLInputElement>()
const count = computed(() => Math.max(4, Math.min(12, props.length)))
function update(event: Event) {
  const field = event.target as HTMLInputElement
  const value = field.value.replace(/\D/g, '').slice(0, count.value)
  if (props.autoClear && value.length === count.value) {
    // Clearing the native input synchronously preserves fast subsequent typing.
    field.value = ''
    emit('update:modelValue', '')
    emit('complete', value)
  } else {
    emit('update:modelValue', value)
  }
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
      pattern="[0-9]*" autocomplete="off" :autofocus="autofocus"
      :disabled="disabled"  :maxlength="count" @input="update" />
    <span class="passcode-dots" aria-hidden="true">
      <i v-for="index in count" :key="index" :class="{ filled: index <= modelValue.length }" />
    </span>
  </label>
</template>
