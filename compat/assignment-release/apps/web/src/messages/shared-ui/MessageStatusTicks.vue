<script setup lang="ts">
// Adapted from Chatify v2 frontend/src/components/thread/MessageStatusTicks.vue.
// Only the caller's verified Matrix read receipt permits the second tick.
defineProps<{ read: boolean }>()
</script>

<template>
  <span class="chatify-message-ticks" :class="read ? 'chatify-message-ticks-read' : 'chatify-message-ticks-sent'" aria-hidden="true">
    <svg viewBox="0 0 17 11" fill="none" focusable="false">
      <path d="M11.071 0.75L4.682 7.133 1.928 4.384 0.5 5.812l4.182 4.182 7.182-7.182L11.071 0.75Z" fill="currentColor" />
      <path v-if="read" d="M15.071 0.75L8.682 7.133 7.5 5.951 6.071 7.379 8.682 9.99 16.182 2.49 15.071 0.75Z" fill="currentColor" class="chatify-message-ticks-second" />
    </svg>
  </span>
</template>
