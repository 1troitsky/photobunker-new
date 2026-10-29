<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import CallMedia from './CallMedia.vue'
import {
  phase,
  error,
  callName,
  incoming,
  tracks,
  people,
  mic,
  camera,
  encrypted,
  audioBlocked,
  joinCall,
  endCall,
  decline,
  toggleMic,
  toggleCamera,
  enableAudio,
  clearError,
} from '../calls/store'
import { t } from '../calls/text'
const videos = computed(() => tracks.value.filter((v) => v.kind === 'video')),
  audios = computed(() => tracks.value.filter((v) => v.kind === 'audio'))
</script>
<template>
  <div v-if="phase === 'idle' && incoming.length" class="incoming-calls">
    <article
      v-for="call in incoming"
      :key="call.roomId"
      class="incoming-call"
      :data-incoming-room="call.roomId"
    >
      <div>
        <strong>{{ t('incoming') }}</strong>
        <p>{{ call.name }} · {{ t(call.video ? 'video' : 'audio') }}</p>
      </div>
      <button class="primary-button" @click="joinCall(call.roomId, call.video)">
        {{ t('answer') }}</button
      ><button class="quiet-button" @click="decline(call.roomId)">
        {{ t('decline') }}
      </button>
    </article>
  </div>
  <p v-if="error && phase === 'idle'" class="call-error" role="alert">
    {{ t(error) }}
    <button class="quiet-button" @click="clearError">{{ t('close') }}</button>
  </p>
  <section
    v-if="phase !== 'idle'"
    class="call-screen"
    role="dialog"
    :aria-label="callName || t('connecting')"
    :data-call-phase="phase"
    :data-call-encrypted="encrypted"
  >
    <header class="screen-header">
      <div class="screen-title">
        <h1>{{ callName || t('connecting') }}</h1>
        <small role="status">{{ t(phase) }}</small>
      </div>
      <AppIcon v-if="encrypted" name="lock" />
    </header>
    <p v-if="encrypted" class="call-encryption">{{ t('encrypted') }}</p>
    <p v-if="error" class="call-error" role="alert">{{ t(error) }}</p>
    <div class="call-grid">
      <article
        v-for="person in people"
        :key="person.id"
        class="call-tile"
        :data-call-participant="person.id"
      >
        <CallMedia
          v-for="item in videos.filter((v) => v.participant === person.id)"
          :key="item.id"
          :item="item"
        />
        <div
          v-if="!videos.some((v) => v.participant === person.id)"
          class="call-avatar"
        >
          <AppIcon name="user" /><span>{{ t('cameraOff') }}</span>
        </div>
        <p>
          {{ person.mine ? t('you') : person.name }}
          <span v-if="!person.mic">· {{ t('mic') }} {{ '×' }}</span>
        </p>
      </article>
      <p v-if="phase === 'connected' && people.length < 2" class="field-hint">
        {{ t('waiting') }}
      </p>
    </div>
    <CallMedia v-for="item in audios" :key="item.id" :item="item" />
    <button v-if="audioBlocked" class="secondary-button" @click="enableAudio">
      {{ t('sound') }}
    </button>
    <footer class="call-controls">
      <button
        class="secondary-button"
        :aria-pressed="mic"
        :disabled="phase !== 'connected'"
        @click="toggleMic"
      >
        <AppIcon name="mic" />{{ t('mic') }}</button
      ><button
        class="secondary-button"
        :aria-pressed="camera"
        :disabled="phase !== 'connected'"
        @click="toggleCamera"
      >
        <AppIcon name="video" />{{ t('camera') }}</button
      ><button
        class="primary-button call-end"
        :disabled="phase === 'ending'"
        @click="endCall"
      >
        <AppIcon name="phone" />{{ t('end') }}
      </button>
    </footer>
  </section>
</template>
<style>
.incoming-calls {
  padding: 8px 16px;
}
.incoming-call {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 12px;
  background: var(--surface);
}
.incoming-call > div {
  flex: 1;
  min-width: 160px;
}
.incoming-call p {
  margin: 4px 0;
}
.call-screen {
  position: fixed;
  z-index: 95;
  inset: 0;
  background: var(--background, var(--bg));
  display: flex;
  flex-direction: column;
  padding-top: env(safe-area-inset-top);
  overflow: hidden;
}
.call-screen > .screen-header {
  flex-shrink: 0;
}
.call-encryption {
  text-align: center;
  font-size: 12px;
  color: var(--muted);
  padding: 0 12px;
}
.call-grid {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
  gap: 12px;
  align-content: center;
}
.call-tile {
  position: relative;
  background: #12151b;
  border-radius: 16px;
  min-height: 140px;
  overflow: hidden;
  color: white;
  aspect-ratio: 4/3;
}
.call-tile video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.call-tile > p {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  margin: 0;
  padding: 8px 12px;
  background: #0009;
  font-size: 13px;
}
.call-avatar {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 13px;
}
.call-avatar svg {
  width: 44px;
  height: 44px;
}
.call-controls {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 12px max(12px, env(safe-area-inset-bottom));
  flex-shrink: 0;
}
.call-controls button {
  min-height: 48px;
}
.call-end {
  background: #b42d3c !important;
  color: white !important;
}
.call-error {
  padding: 8px 16px;
  color: var(--danger, #c43d4c);
}
.call-screen audio {
  display: none;
}
</style>
