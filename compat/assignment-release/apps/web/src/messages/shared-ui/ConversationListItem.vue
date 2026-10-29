<script setup lang="ts">
// Adapted from Chatify v2 frontend/src/components/sidebar/ConversationListItem.vue.
// A presentation-only, transport-agnostic component: no Matrix, Laravel,
// account state, network, plaintext persistence, or tracking dependencies.
defineProps<{
  conversation: {
    id: string
    name: string
    avatarClass: string
    avatarInitials: string
    group: boolean
    timeLabel: string
    preview: string
    unreadCount: number
    muted?: boolean
  }
  active: boolean
  swiped: boolean
}>()

const emit = defineEmits<{ select: [] }>()
</script>

<template>
  <button
    type="button"
    class="chat-row chatify-conversation-item"
    :class="{ 'chat-active': active, 'chatify-has-unread': conversation.unreadCount > 0 }"
    :style="swiped ? { transform: 'translateX(-112px)' } : undefined"
    :aria-current="active ? 'true' : undefined"
    :data-unread="conversation.unreadCount > 0 ? 'true' : 'false'"
    @click="emit('select')"
  >
    <span :class="['chat-avatar', conversation.avatarClass]">
      <svg v-if="conversation.group" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m14-14a4 4 0 0 1 0 8M22 20v-2a4 4 0 0 0-3-3.87M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
      </svg>
      <span v-else>{{ conversation.avatarInitials }}</span>
    </span>
    <span class="chat-summary">
      <span class="chat-summary-title">
        <strong>{{ conversation.name }}</strong>
        <svg v-if="conversation.muted" class="chat-muted-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-label="Muted notifications">
          <path d="M4 4 20 20M9 5a4 4 0 0 1 7 3v4c0 1.5.5 2.5 1.5 4M5.5 16h13M10 20h4" stroke-linecap="round"/>
        </svg>
        <time v-if="conversation.timeLabel">{{ conversation.timeLabel }}</time>
      </span>
      <span class="chat-summary-preview">
        <span>{{ conversation.preview }}</span>
        <b v-if="conversation.unreadCount > 0" class="chat-unread">{{ conversation.unreadCount > 99 ? '99+' : conversation.unreadCount }}</b>
      </span>
    </span>
  </button>
</template>
