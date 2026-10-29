<script setup lang="ts">
// PhotoBunker adaptation of Chatify v2 MessageBubble/MessageDeliveryStatus.
// Source: munafio/chatify@4a39eacb44e2405baa8c1e3bd3b4644fc5c8707d
// Display only: no Matrix client, crypto, key store, network or storage.
import MessageStatusTicks from './MessageStatusTicks.vue'
import { ui } from '../presentation'
import { formatNumber } from '../../i18n'

defineProps<{
  id: string
  mine: boolean
  locked: boolean
  grouped: boolean
  highlighted: boolean
  selected: boolean
  selecting: boolean
  sender: string
  showSender: boolean
  body: string
  timeLabel: string
  status: 'queued' | 'sending' | 'sent' | 'read' | 'notSent'
  statusLabel: string
  menuLabel: string
  selectLabel: string
  replyId?: string
  replyPreview?: string
  hasVoice: boolean
  hasPhoto: boolean
  hasAttachment?: boolean
  edited?: boolean
  editedLabel?: string
  reactions?: readonly { key: string; count: number; mine: boolean }[]
  reactionLabel?: string
}>()

const emit = defineEmits<{
  menu: []
  toggle: []
  replyJump: [id: string]
  pressStart: [event: PointerEvent]
  pressMove: [event: PointerEvent]
  pressEnd: [event: PointerEvent]
  pressCancel: []
  react: [key: string]
}>()
</script>

<template>
  <article
    :class="['message-bubble', 'chatify-message-bubble', {
      'message-mine': mine,
      'message-locked': locked,
      'message-grouped': grouped,
      'message-highlighted': highlighted,
      'message-selected': selected,
    }]"
    :data-event-id="id"
    tabindex="0"
    aria-haspopup="dialog"
    :aria-label="menuLabel"
    @contextmenu.prevent="emit('menu')"
    @keydown.enter.self.prevent="emit('menu')"
    @keydown.shift.f10.self.prevent="emit('menu')"
    @keydown.space.self.prevent="selecting ? emit('toggle') : emit('menu')"
    @pointerdown="emit('pressStart', $event)"
    @pointermove="emit('pressMove', $event)"
    @pointerup="emit('pressEnd', $event)"
    @pointercancel="emit('pressCancel')"
    @click="selecting && emit('toggle')"
  >
    <label v-if="selecting" class="message-select" @click.stop>
      <input type="checkbox" :checked="selected" :aria-label="selectLabel" @change="emit('toggle')" />
    </label>
    <strong v-if="showSender" class="message-author">{{ sender }}</strong>
    <blockquote
      v-if="replyId"
      class="chatify-reply-preview"
      role="button"
      tabindex="0"
      @click.stop="emit('replyJump', replyId)"
      @keydown.enter.stop.prevent="emit('replyJump', replyId)"
    >{{ replyPreview }}</blockquote>
    <slot v-if="hasVoice && !locked" name="voice" />
    <slot v-if="hasAttachment && !locked" name="attachment" />
    <p v-if="locked || (!hasVoice && !hasAttachment) || (hasAttachment && !!body)" class="message-body">{{ body }}</p>
    <slot v-if="hasPhoto && !locked" name="photo" />
    <div v-if="reactions?.length && !locked" class="chatify-reactions" :aria-label="ui('reactions')">
      <button
        v-for="reaction in reactions"
        :key="reaction.key"
        type="button"
        class="chatify-reaction-chip"
        :class="{ 'is-own': reaction.mine }"
        :aria-label="(reactionLabel || ui('react')) + ': ' + reaction.key + ', ' + formatNumber(reaction.count)"
        :aria-pressed="reaction.mine"
        @click.stop="emit('react', reaction.key)"
        @pointerdown.stop
      >{{ reaction.key }} <span>{{ formatNumber(reaction.count) }}</span></button>
    </div>
    <footer>
      <span v-if="edited && !locked" class="chatify-message-edited">{{ editedLabel || ui('edited') }}</span>
      <time>{{ timeLabel }}</time>
      <span v-if="mine" :class="['message-state', 'message-state-' + status]" :aria-label="statusLabel">
        <svg v-if="status === 'sending' || status === 'queued'" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6" stroke="currentColor" />
          <path d="M8 4v4l3 2" stroke="currentColor" />
        </svg>
        <svg v-else-if="status === 'notSent'" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6" stroke="currentColor" />
          <path d="m5.5 5.5 5 5m0-5-5 5" stroke="currentColor" />
        </svg>
        <MessageStatusTicks v-else :read="status === 'read'" />
      </span>
    </footer>
    <button
      v-if="!selecting"
      type="button"
      class="app-icon-button message-menu-button"
      :aria-label="menuLabel"
      @click.stop="emit('menu')"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="5" cy="12" r="1.7" />
        <circle cx="12" cy="12" r="1.7" />
        <circle cx="19" cy="12" r="1.7" />
      </svg>
    </button>
  </article>
</template>
