<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { voiceText as text } from '../messages/voice-text'
import { voiceTime } from '../messages/voice'
const props = defineProps<{ duration: number; waveform: number[]; active: boolean; load: (signal: AbortSignal) => Promise<Blob> }>()
const audio = ref<HTMLAudioElement>(), busy = ref(false), playing = ref(false), position = ref(0), rate = ref(1), error = ref('')
let url = '', request: AbortController | undefined, generation = 0
function clear() { generation++; request?.abort(); request = undefined; busy.value = false; playing.value = false; if (audio.value) { audio.value.pause(); audio.value.removeAttribute('src'); audio.value.load() }; if (url) URL.revokeObjectURL(url); url = '' }
onBeforeUnmount(clear)
watch(() => props.active, active => { if (!active) clear() })
async function play() {
  if (!props.active || busy.value) return
  if (playing.value) { audio.value?.pause(); return }
  const version = generation
  error.value = ''
  try {
    if (!url) {
      busy.value = true; request = new AbortController()
      const blob = await props.load(request.signal)
      if (version !== generation || !props.active) return
      url = URL.createObjectURL(blob)
      audio.value!.src = url
    }
    busy.value = false
    audio.value!.playbackRate = rate.value
    await audio.value!.play()
  } catch (failure) { if (version === generation) error.value = failure instanceof DOMException && failure.name === 'NotAllowedError' ? text('playAgain') : text('failed') }
  finally { if (version === generation) busy.value = false }
}
function speed() { rate.value = rate.value === 1 ? 1.5 : rate.value === 1.5 ? 2 : 1; if (audio.value) audio.value.playbackRate = rate.value }
function seek(event: Event) { const value = Number((event.target as HTMLInputElement).value); if (audio.value && url) { audio.value.currentTime = value / 1000; position.value = value } }
</script>
<template>
  <div class="voice-message" @pointerdown.stop @contextmenu.stop>
    <audio ref="audio" preload="none" @error="error = text('failed'); playing = false" @play="playing = true" @pause="playing = false" @ended="playing = false; position = 0" @timeupdate="position = (audio?.currentTime || 0) * 1000" />
    <button type="button" class="voice-play" :aria-label="text(playing ? 'pausePlay' : 'play')" :disabled="busy" @click="play"><span v-if="busy" class="voice-spinner" /><span v-else-if="playing" aria-hidden="true">Ⅱ</span><svg v-else viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M8 4v16l13-8z" /></svg></button>
    <div class="voice-track"><div class="voice-waveform" aria-hidden="true"><i v-for="(level, i) in (waveform.length ? waveform : Array(32).fill(240))" :key="i" :class="{ played: i / (waveform.length || 32) <= position / duration }" :style="{ height: Math.max(12, level / 1024 * 100) + '%' }" /></div><input type="range" min="0" :max="duration" :value="position" :aria-label="text('seek')" :disabled="!url" @input="seek" /><small>{{ voiceTime(playing || position ? position : duration) }}</small></div>
    <button type="button" class="voice-speed" :aria-label="text('speed')" @click="speed">{{ rate }}×</button>
    <span v-if="busy" class="visually-hidden" role="status">{{ text('loading') }}</span><p v-if="error" class="form-error voice-error" role="alert">{{ error }}</p>
  </div>
</template>
