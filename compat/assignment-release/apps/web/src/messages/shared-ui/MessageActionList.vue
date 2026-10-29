<script setup lang="ts">
// Adapted from Chatify v2 MessageActionsMenu: authorized, host-supplied actions.
// The host owns Matrix power levels and permissions, never this component.
type UiMessageAction = {
  id: 'reply' | 'copy' | 'pin' | 'select' | 'retry' | 'delete' | 'edit' | 'react'
  label: string
  destructive?: boolean
}
defineProps<{ preview: string; actions: readonly UiMessageAction[] }>()
const emit = defineEmits<{ action: [id: UiMessageAction['id']] }>()
</script>

<template>
  <div class="chatify-message-action-list">
    <p class="message-action-preview">{{ preview }}</p>
    <button
      v-for="action in actions"
      :key="action.id"
      type="button"
      class="messenger-action chatify-message-action"
      :class="{ 'subtle-danger': action.destructive }"
      @click="emit('action', action.id)"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <template v-if="action.id === 'reply'">
          <path d="m10 8-6 4 6 4V8Zm-6 4h9a6 6 0 0 1 6 6" stroke-linecap="round" stroke-linejoin="round"/>
        </template>
        <template v-else-if="action.id === 'edit'">
          <path d="m13 6 5 5M4 20l4.5-1 10-10a2 2 0 0 0-4-4l-10 10L4 20Z" stroke-linejoin="round" />
        </template>
        <template v-else-if="action.id === 'react'">
          <circle cx="12" cy="12" r="9"/><path d="M8 14c1 3 7 3 8 0M9 10h.01M15 10h.01" stroke-linecap="round"/>
        </template>
        <template v-else-if="action.id === 'copy'">
          <rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>
        </template>
        <template v-else-if="action.id === 'pin'">
          <path d="M16 3H8l1 6-3 3v2h12v-2l-3-3 1-6Zm-4 11v7" stroke-linecap="round" stroke-linejoin="round" />
        </template>
        <template v-else-if="action.id === 'select'">
          <path d="M5 12l4 4 10-10" stroke-linecap="round" stroke-linejoin="round"/>
        </template>
        <template v-else-if="action.id === 'retry'">
          <path d="M20 7v5h-5M4 17v-5h5M5 10a8 8 0 0 1 13-3l2 5M4 12l2 5a8 8 0 0 0 13-3" stroke-linecap="round" stroke-linejoin="round"/>
        </template>
        <template v-else>
          <path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 10v7m4-7v7" stroke-linecap="round" stroke-linejoin="round"/>
        </template>
      </svg>
      {{ action.label }}
    </button>
  </div>
</template>
