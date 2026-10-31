<script setup lang="ts" generic="T extends { message: { id: string }; day: boolean; dayLabel: string }">
// Adapted from Chatify v2 MessageList: keyed day groups and message slots.
// Rendering order/authorization/decryption are owned by the host. This generic
// wrapper deliberately creates NO scroll container: the PhotoBunker host
// retains pagination, read receipts, focus and viewport position semantics.
import MessageDateSeparator from './MessageDateSeparator.vue'

defineProps<{ items: readonly T[] }>()
defineSlots<{ default(props: { item: T }): unknown }>()
</script>

<template>
  <template v-for="item in items" :key="item.message.id">
    <MessageDateSeparator v-if="item.day" :label="item.dayLabel" />
    <slot :item="item" />
  </template>
</template>
