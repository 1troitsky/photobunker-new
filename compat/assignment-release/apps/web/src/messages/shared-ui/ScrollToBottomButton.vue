<script setup lang="ts">
// Adapted from Chatify v2 ScrollToBottomButton. No own unread state.
defineProps<{ label: string; count?: number }>()
const emit = defineEmits<{ click: [] }>()
</script>

<template>
  <button type="button" class="app-icon-button message-jump chatify-scroll-bottom-btn" :aria-label="label" @click="emit('click')">
    <span v-if="count && count > 0" class="chatify-scroll-bottom-count">{{ count > 99 ? '99+' : count }}</span>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path d="m5 9 7 7 7-7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
    </svg>
  </button>
</template>
