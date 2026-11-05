<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import ScreenHeader from '../components/ScreenHeader.vue'
import AppIcon from '../components/AppIcon.vue'
import PhotoQueue from '../components/PhotoQueue.vue'
import { appStatusKey, clearDiagnostics, diagnosticEvents } from '../app/status'
import { delivery } from '../delivery/queue'
import { libraryLoading, serverError } from '../local/library'
import { pendingCount, queueBusy, queueError } from '../workspace/state'
import { locale } from '../i18n'
import { latestLocation, locationEnabled, locationState } from '../profiles/location'

const status = inject(appStatusKey)
const ru = computed(() => locale.value === 'ru')
const online = ref(navigator.onLine)
const now = ref(Date.now())
const storage = ref<{ usage: number; quota: number; persisted?: boolean }>()
const serviceWorker = ref<'active'|'waiting'|'unavailable'>('unavailable')
let clock: ReturnType<typeof setInterval> | undefined
function updateConnection() { online.value = navigator.onLine }
onMounted(() => {
  window.addEventListener('online', updateConnection)
  window.addEventListener('offline', updateConnection)
  clock = setInterval(() => { now.value = Date.now() }, 1000)
  void navigator.storage?.estimate().then(async value => {
    storage.value = {
      usage: value.usage ?? 0,
      quota: value.quota ?? 0,
      persisted: await navigator.storage.persisted?.(),
    }
  }).catch(() => {})
  if ('serviceWorker' in navigator)
    void navigator.serviceWorker.getRegistration().then(registration => {
      serviceWorker.value = registration?.active ? 'active' : registration?.waiting ? 'waiting' : 'unavailable'
    }).catch(() => {})
})
onBeforeUnmount(() => {
  window.removeEventListener('online', updateConnection)
  window.removeEventListener('offline', updateConnection)
  if (clock) clearInterval(clock)
})
type StatusIcon = 'check' | 'offline' | 'sync'
const rows = computed<{ icon: StatusIcon; title: string; value: string }[]>(() => [
  {
    icon: online.value ? 'check' : 'offline',
    title: ru.value ? 'Подключение' : 'Connection',
    value: online.value ? (ru.value ? 'В сети' : 'Online') : (ru.value ? 'Офлайн' : 'Offline'),
  },
  {
    icon: libraryLoading.value ? 'sync' : serverError.value ? 'offline' : 'check',
    title: ru.value ? 'Библиотека' : 'Library',
    value: libraryLoading.value ? (ru.value ? 'Обновляется' : 'Updating') :
      serverError.value ? (ru.value ? 'Показана локальная копия' : 'Showing local copy') : (ru.value ? 'Актуальна' : 'Up to date'),
  },
  {
    icon: queueBusy.value || delivery.value.busy ? 'sync' : 'check',
    title: ru.value ? 'Отправка' : 'Uploads',
    value: pendingCount.value + delivery.value.pending + delivery.value.deleting
      ? `${ru.value ? 'В очереди' : 'Queued'}: ${pendingCount.value + delivery.value.pending + delivery.value.deleting}`
      : (ru.value ? 'Всё отправлено' : 'Everything uploaded'),
  },
  {
    icon: locationState.value === 'ready' ? 'check' : locationEnabled.value ? 'sync' : 'offline',
    title: ru.value ? 'Координаты' : 'Location',
    value: latestLocation.value
      ? `${latestLocation.value.latitude.toFixed(5)}, ${latestLocation.value.longitude.toFixed(5)} ±${Math.round(latestLocation.value.accuracy)} m`
      : locationEnabled.value
        ? (ru.value ? `Состояние: ${locationState.value}` : `State: ${locationState.value}`)
        : (ru.value ? 'Отключены' : 'Disabled'),
  },
  {
    icon: serviceWorker.value === 'active' ? 'check' : 'offline',
    title: ru.value ? 'Offline shell' : 'Offline shell',
    value: serviceWorker.value === 'active'
      ? (ru.value ? 'Активен' : 'Active')
      : serviceWorker.value === 'waiting'
        ? (ru.value ? 'Ожидает обновления' : 'Waiting to update')
        : (ru.value ? 'Недоступен' : 'Unavailable'),
  },
])
const activeProcesses = computed(() => [
  libraryLoading.value ? (ru.value ? 'Обновление локальной библиотеки' : 'Refreshing local library') : '',
  queueBusy.value ? (ru.value ? 'Синхронизация рабочей области' : 'Workspace synchronization') : '',
  delivery.value.busy ? (ru.value ? 'Отправка зашифрованных фотографий' : 'Encrypted photo delivery') : '',
  locationEnabled.value && locationState.value === 'pending'
    ? (ru.value ? 'Уточнение координат' : 'Acquiring location') : '',
].filter(Boolean))
const recentErrors = computed(() => diagnosticEvents.value.filter(event => event.tone !== 'info').slice(0, 12))
const timings = computed(() => diagnosticEvents.value.filter(event => event.durationMs !== undefined).slice(0, 20))
const storageLabel = computed(() => {
  if (!storage.value?.quota) return ru.value ? 'Нет данных' : 'Unavailable'
  const mb = (value: number) => `${Math.round(value / 1048576)} MB`
  return `${mb(storage.value.usage)} / ${mb(storage.value.quota)}${storage.value.persisted ? ' · persistent' : ''}`
})
function eventTime(value: number) {
  void now.value
  return new Date(value).toLocaleTimeString(ru.value ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
</script>

<template>
  <section class="native-screen status-screen">
    <ScreenHeader :title="ru ? 'Статус' : 'Status'" back="/profile" />
    <div class="screen-body status-body">
      <div v-if="status" :class="['status-summary', `is-${status.tone}`]">
        <strong>{{ status.label }}</strong><span>{{ status.detail }}</span>
      </div>
      <div class="status-list">
        <article v-for="row in rows" :key="row.title"><AppIcon :name="row.icon" />
          <span><strong>{{ row.title }}</strong><small>{{ row.value }}</small></span></article>
      </div>
      <section class="status-debug-section">
        <h2>{{ ru ? 'Активные процессы' : 'Active processes' }}</h2>
        <div v-if="activeProcesses.length" class="status-process-list">
          <p v-for="process in activeProcesses" :key="process"><AppIcon name="sync" />{{ process }}</p>
        </div>
        <p v-else class="field-hint">{{ ru ? 'Сейчас фоновых операций нет.' : 'No background operations right now.' }}</p>
      </section>
      <section class="status-debug-section">
        <h2>{{ ru ? 'Хранилище устройства' : 'Device storage' }}</h2>
        <p class="status-storage-value">{{ storageLabel }}</p>
      </section>
      <section class="status-debug-section">
        <div class="status-debug-heading"><h2>{{ ru ? 'Ошибки и предупреждения' : 'Errors and warnings' }}</h2>
          <button v-if="recentErrors.length" class="quiet-button" @click="clearDiagnostics">{{ ru ? 'Очистить' : 'Clear' }}</button></div>
        <div v-if="recentErrors.length" class="status-event-list">
          <article v-for="event in recentErrors" :key="event.id" :class="`is-${event.tone}`">
            <time>{{ eventTime(event.at) }}</time><span><strong>{{ event.title }}</strong><small>{{ event.detail }}</small></span>
          </article>
        </div>
        <p v-else class="field-hint">{{ ru ? 'За эту сессию ошибок не зарегистрировано.' : 'No errors recorded in this session.' }}</p>
      </section>
      <section class="status-debug-section">
        <h2>{{ ru ? 'Последние замеры' : 'Recent timings' }}</h2>
        <div v-if="timings.length" class="status-timing-list">
          <article v-for="event in timings" :key="event.id"><span>{{ event.detail }}</span><strong>{{ event.durationMs }} ms</strong></article>
        </div>
        <p v-else class="field-hint">{{ ru ? 'Замеры появятся после переходов между экранами.' : 'Timings appear after navigating between screens.' }}</p>
      </section>
      <p v-if="queueError" class="form-error" role="alert">{{ ru ? 'Ошибка относится к очереди отправки. Повтор выполняется автоматически.' : 'The upload queue failed and will retry automatically.' }}</p>
      <PhotoQueue />
    </div>
  </section>
</template>
