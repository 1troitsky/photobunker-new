<script setup lang="ts">
// Adapted from Chatify v2 ConversationSearch.vue and SearchField.vue
// (munafio/chatify @ 4a39eacb44e2405baa8c1e3bd3b4644fc5c8707d).
// Presentation only. Search commands and E2EE history remain with the host.
import { ref } from 'vue'

const props = defineProps<{
  modelValue: string
  placeholder: string
  clearLabel: string
  historyLabel: string
  searching?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  searchHistory: []
}>()

const input = ref<HTMLInputElement | null>(null)
function update(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}
function clear() {
  emit('update:modelValue', '')
  input.value?.focus()
}
</script>

<template>
  <form class="messenger-search chatify-conversation-search" role="search" @submit.prevent="emit('searchHistory')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path stroke-linecap="round" stroke-linejoin="round" d="m16 16 5 5" />
    </svg>
    <input
      ref="input"
      type="search"
      :value="props.modelValue"
      :aria-label="placeholder"
      :placeholder="placeholder"
      autocomplete="off"
      spellcheck="false"
      @input="update"
    />
    <button
      v-if="modelValue"
      type="button"
      class="app-icon-button chatify-search-clear"
      :aria-label="clearLabel"
      @click="clear"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6 6 18" />
      </svg>
    </button>
    <button v-if="modelValue.trim()" class="search-history" type="submit" :disabled="searching">
      {{ historyLabel }}
    </button>
  </form>
</template>
