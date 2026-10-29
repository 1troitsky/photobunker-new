<script setup lang="ts">
// Adapted from Chatify v2 frontend/src/components/thread/MessageDateSeparator.vue.
// The caller owns date/time formatting; this component never accesses messages.
defineProps<{ label: string }>()
</script>

<template>
  <div class="message-day"><span>{{ label }}</span></div>
</template>
