<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  length?: number
  label: string
  disabled?: boolean
  autofocus?: boolean
  preventScroll?: boolean
  /** Lock screen only: reset input immediately on N digits, no timers. */
  autoClear?: boolean
}>(), { length: 8, disabled: false, autofocus: false, autoClear: false, preventScroll: false })
const emit = defineEmits<{ 'update:modelValue': [value: string]; complete: [value: string] }>()
const input = ref<HTMLInputElement>()
const visibleCount = ref(props.modelValue.length)
watch(() => props.modelValue, value => {
  // A completed segment stays visible until the next keystroke. Its native
  // input is already empty, so fast entry of the next segment is not lost.
  if (!props.autoClear || value) visibleCount.value = value.length
})
const count = computed(() => Math.max(4, Math.min(12, props.length)))
function update(event: Event) {
  const field = event.target as HTMLInputElement
  const value = field.value.replace(/\D/g, '').slice(0, count.value)
  visibleCount.value = value.length
  if (props.autoClear && value.length === count.value) {
    // Clearing the native input synchronously preserves fast subsequent typing.
    field.value = ''
    emit('update:modelValue', '')
    emit('complete', value)
  } else {
    emit('update:modelValue', value)
  }
}
function focus() { input.value?.focus({ preventScroll: props.preventScroll }) }
onMounted(() => {
  if (props.autofocus) void nextTick(focus)
})
defineExpose({ focus })
</script>

<template>
  <label class="passcode-entry" :aria-label="label" @click="focus">
    <input ref="input" :value="modelValue" type="password" inputmode="numeric"
      pattern="[0-9]*" autocomplete="off" :aria-label="label"
      :disabled="disabled"  :maxlength="count" @input="update" />
    <span class="passcode-dots" aria-hidden="true">
      <i v-for="index in count" :key="index" :class="{ filled: index <= visibleCount }" />
    </span>
  </label>
</template>
