<script setup lang="ts">
// Adapted from Chatify v2 frontend/src/components/thread/ThreadHeader.vue.
// The host supplies verified display strings and owns Matrix/identity logic.
// Do not derive presence, trust, delivery or membership from UI state.
defineProps<{
  name: string
  subtitle: string
  avatarClass: string
  initials: string
  group: boolean
  selecting?: boolean
  showBack?: boolean
  backLabel: string
  openLabel: string
}>()

const emit = defineEmits<{ back: []; open: [] }>()
</script>

<template>
  <header class="screen-header messenger-chat-header chatify-thread-header">
    <button
      v-if="showBack || selecting"
      type="button"
      class="app-icon-button messenger-back"
      :class="{ 'selection-back': selecting }"
      :aria-label="backLabel"
      @click="emit('back')"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="m15 18-6-6 6-6" />
      </svg>
    </button>
    <button
      type="button"
      class="chat-heading"
      :disabled="selecting"
      :aria-label="openLabel"
      @click="emit('open')"
    >
      <span :class="['chat-avatar', avatarClass]">
        <svg v-if="group" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m14-14a4 4 0 0 1 0 8M22 20v-2a4 4 0 0 0-3-3.87M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
        </svg>
        <span v-else>{{ initials }}</span>
      </span>
      <span class="screen-title">
        <h1>{{ name }}</h1>
        <small>{{ subtitle }}</small>
      </span>
    </button>
    <div class="screen-actions"><slot name="actions" /></div>
  </header>
</template>
