<script setup lang="ts">
// Reusable UI only: host receives emoji insertion or locally rendered image
// intent. No direct Matrix or network dependencies.
import { ref } from 'vue'
import { composerEmojis, stickerEmojis } from '../picker'
defineProps<{ emojiTitle: string; stickerTitle: string; selectLabel: string }>()
const emit = defineEmits<{ emoji: [value: string]; sticker: [value: string] }>()
const tab = ref<'emoji' | 'stickers'>('emoji')
</script>
<template>
  <div class="chatify-emoji-sticker-picker">
    <div class="chatify-picker-tabs" role="group" :aria-label="selectLabel">
      <button type="button" :aria-pressed="tab === 'emoji'" @click="tab = 'emoji'">{{ emojiTitle }}</button>
      <button type="button" :aria-pressed="tab === 'stickers'" @click="tab = 'stickers'">{{ stickerTitle }}</button>
    </div>
    <div class="chatify-picker-grid" role="group" :aria-label="tab === 'emoji' ? emojiTitle : stickerTitle">
      <button
        v-for="symbol in tab === 'emoji' ? composerEmojis : stickerEmojis"
        :key="symbol"
        type="button"
        :class="['chatify-picker-symbol', { 'is-sticker': tab === 'stickers' }]"
        :aria-label="(tab === 'emoji' ? emojiTitle : stickerTitle) + ': ' + symbol"
        @click="tab === 'emoji' ? emit('emoji', symbol) : emit('sticker', symbol)"
      >{{ symbol }}</button>
    </div>
  </div>
</template>
