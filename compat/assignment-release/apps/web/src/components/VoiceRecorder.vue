<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { account } from '../identity/store'
import AppIcon from './AppIcon.vue'
import { maxVoiceBytes, maxVoiceDuration, voiceTime, type VoiceDraft } from '../messages/voice'
import { voiceText as text } from '../messages/voice-text'
const props = defineProps<{ disabled: boolean; active: boolean; send: (draft: VoiceDraft) => Promise<void> }>()
const captureElement = ref<HTMLElement>(), previewAudio = ref<HTMLAudioElement>()
const emit = defineEmits<{ dirty: [value: boolean] }>()
const phase = ref<'idle' | 'permission' | 'recording' | 'preview' | 'sending'>('idle'), elapsed = ref(0), paused = ref(false), locked = ref(false), error = ref(''), preview = ref('')
let recorder: MediaRecorder | undefined, stream: MediaStream | undefined, context: AudioContext | undefined
let timer: ReturnType<typeof setInterval> | undefined, chunks: Blob[] = [], draft: VoiceDraft | undefined, samples: number[] = []
let version = 0, started = 0, pauseStarted = 0, pausedFor = 0, x = 0, y = 0, holding = false
function releaseCapture() { clearInterval(timer); timer = undefined; stream?.getTracks().forEach(track => track.stop()); stream = undefined; void context?.close().catch(() => {}); context = undefined }
function clear() {
  version++; holding = false
  if (previewAudio.value) { previewAudio.value.pause(); previewAudio.value.removeAttribute('src'); previewAudio.value.load() }
  if (recorder && recorder.state !== 'inactive') { recorder.ondataavailable = null; recorder.onstop = null; recorder.stop() }
  recorder = undefined; releaseCapture(); chunks = []; draft = undefined; samples = []
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = ''; phase.value = 'idle'; elapsed.value = 0; paused.value = false; locked.value = false
  emit('dirty', false)
}
onBeforeUnmount(clear)
watch(() => props.active, active => { if (!active && phase.value !== 'sending') clear() })
watch(() => account.value?.id, clear)
function background() { if (document.hidden && phase.value !== 'sending') clear() }
document.addEventListener('visibilitychange', background)
onBeforeUnmount(() => document.removeEventListener('visibilitychange', background))
async function start(lock = false) {
  if (props.disabled || !props.active || phase.value !== 'idle') return
  error.value = ''
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { error.value = text('unsupported'); return }
  const current = ++version, owner = account.value?.id
  phase.value = 'permission'; locked.value = lock; emit('dirty', true)
  let capture: MediaStream | undefined
  try {
    capture = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
    if (current !== version || owner !== account.value?.id || !props.active) { capture.getTracks().forEach(track => track.stop()); return }
    stream = capture
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/wav'].find(value => MediaRecorder.isTypeSupported(value))
    if (!type) throw new Error('voice.unsupported')
    recorder = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: 32000 })
    chunks = []; samples = []; pausedFor = 0; paused.value = false; elapsed.value = 0
    recorder.ondataavailable = event => { if (current === version && event.data.size) chunks.push(event.data) }
    recorder.onerror = () => { if (current === version) { clear(); error.value = text('unavailable') } }
    // Waveform analysis is optional. AudioContext restrictions must never
    // prevent MediaRecorder from recording an otherwise permitted microphone.
    let analyser: AnalyserNode | undefined
    try {
      const audioContext = new AudioContext(); context = audioContext
      analyser = audioContext.createAnalyser(); analyser.fftSize = 256
      audioContext.createMediaStreamSource(stream).connect(analyser)
      void audioContext.resume().catch(() => {})
    } catch { void context?.close().catch(() => {}); context = undefined; analyser = undefined }
    if (current !== version || !props.active) { releaseCapture(); return }
    const data = new Uint8Array(256)
    started = performance.now(); phase.value = 'recording'; if (!holding) locked.value = true
    recorder.start(250)
    timer = setInterval(() => {
      if (paused.value || current !== version) return
      elapsed.value = performance.now() - started - pausedFor
      data.fill(128); analyser?.getByteTimeDomainData(data)
      let peak = 0; for (const value of data) peak = Math.max(peak, Math.abs(value - 128))
      samples.push(Math.min(1024, peak * 8))
      if (elapsed.value >= maxVoiceDuration || chunks.reduce((total, blob) => total + blob.size, 0) >= maxVoiceBytes) void finish(false)
    }, 100)
  } catch (failure) {
    capture?.getTracks().forEach(track => track.stop())
    if (current === version) { clear(); error.value = !capture && failure instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(failure.name) ? text('denied') : failure instanceof Error && failure.message === 'voice.unsupported' ? text('unsupported') : text('unavailable') }
  }
}
function pause() {
  if (!recorder || phase.value !== 'recording') return
  if (paused.value) { recorder.resume(); pausedFor += performance.now() - pauseStarted; paused.value = false }
  else { recorder.pause(); pauseStarted = performance.now(); paused.value = true }
}
async function finish(send = false) {
  if (phase.value !== 'recording' || !recorder) return
  const current = version, activeRecorder = recorder
  const duration = Math.min(maxVoiceDuration, Math.round((paused.value ? pauseStarted : performance.now()) - started - pausedFor))
  phase.value = 'preview'
  clearInterval(timer); timer = undefined
  await new Promise<void>(resolve => { activeRecorder.onstop = () => resolve(); activeRecorder.stop() })
  releaseCapture(); recorder = undefined
  if (current !== version || !props.active) return
  const blob = new Blob(chunks, { type: activeRecorder.mimeType }); chunks = []
  if (duration < 500 || !blob.size || blob.size > maxVoiceBytes) { clear(); error.value = text(blob.size > maxVoiceBytes ? 'tooLarge' : 'tooShort'); return }
  const waveform = Array.from({ length: Math.min(64, samples.length) }, (_, index) => {
    const first = Math.floor(index * samples.length / Math.min(64, samples.length)), end = Math.ceil((index + 1) * samples.length / Math.min(64, samples.length))
    return Math.max(0, ...samples.slice(first, end))
  })
  draft = { blob, duration, waveform }; elapsed.value = duration; preview.value = URL.createObjectURL(blob)
  if (send) await submit()
}
async function submit() {
  if (!draft || phase.value !== 'preview' || props.disabled) return
  const current = version; phase.value = 'sending'; error.value = ''
  try { await props.send(draft); if (current === version) clear() }
  catch { if (current === version) { phase.value = 'preview'; error.value = text('sendFailed') } }
}
function down(event: PointerEvent) {
  if (event.button !== 0 || props.disabled) return
  x = event.clientX; y = event.clientY; holding = true
  ;captureElement.value?.setPointerCapture(event.pointerId)
  void start()
}
function move(event: PointerEvent) {
  if (!holding || locked.value) return
  if (x - event.clientX > 80) clear()
  else if (y - event.clientY > 70) locked.value = true
}
function up() {
  if (!holding) return
  holding = false
  if (phase.value === 'permission' || elapsed.value < 350) locked.value = true
  else if (!locked.value) void finish(true)
}
</script>
<template>
  <div ref="captureElement" @pointermove="move" @pointerup="up" @pointercancel="clear" class="voice-recorder" :class="{ 'voice-recorder-open': phase !== 'idle' }" :data-recording-state="phase">
    <button v-if="phase === 'idle'" type="button" class="app-icon-button voice-mic" :aria-label="text('record')" :disabled="disabled" @pointerdown.prevent="down" @click="event => { if (event.detail === 0) void start(true) }"><AppIcon name="mic" /></button>
    <div v-else class="voice-record-panel" @pointerdown.stop>
      <button type="button" class="app-icon-button subtle-danger" :aria-label="text(phase === 'preview' ? 'delete' : 'cancel')" :disabled="phase === 'sending'" @click="clear"><AppIcon name="trash" /></button>
      <div class="voice-record-details"><span v-if="phase === 'permission'" role="status">{{ text('preparing') }}</span><template v-else-if="phase === 'recording'"><strong><i class="record-dot" :class="{ paused }" />{{ voiceTime(elapsed) }}</strong><small>{{ text(locked ? 'locked' : 'hint') }}</small></template><audio ref="previewAudio" v-else-if="preview" :src="preview" controls :aria-label="text('preview')" /><span v-else role="status">{{ text('loading') }}</span></div>
      <template v-if="phase === 'recording'"><button v-if="locked" type="button" class="app-icon-button" :aria-label="text(paused ? 'resume' : 'pause')" @click="pause"><span aria-hidden="true">{{ paused ? '▶' : 'Ⅱ' }}</span></button><button type="button" class="app-icon-button" :aria-label="text(locked ? 'stop' : 'lock')" @click="locked ? finish(false) : locked = true"><AppIcon v-if="!locked" name="lock" /><span v-else class="record-stop" /></button><button v-if="locked" type="button" class="app-icon-button message-send" :aria-label="text('send')" @click="finish(true)"><AppIcon name="send" /></button></template>
      <button v-if="phase === 'preview' || phase === 'sending'" type="button" class="app-icon-button message-send" :aria-label="text('send')" :disabled="disabled || phase === 'sending' || !preview" @click="submit"><AppIcon name="send" /></button>
    </div>
    <p v-if="error" class="form-error voice-error" role="alert">{{ error }}</p>
  </div>
</template>
