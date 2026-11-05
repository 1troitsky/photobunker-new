<script setup lang="ts">
import { q } from '../crypto/text'
import { onMounted, ref, shallowRef } from 'vue'
import { prepareContext } from '../crypto/store'
import { jobs, rewrapPending, deliver, type Job } from '../crypto/photos'
const rows = shallowRef<Job[]>([]),
  busy = ref(''),
  error = ref('')
async function refresh() {
  rows.value = (await jobs()).filter(
    (j) => j.deleted || !j.received || j.draft || j.gps,
  )
}
async function syncQueue() {
  if (busy.value) return
  busy.value = 'sync'
  error.value = ''
  try {
    for (const row of rows.value) {
      if (row.deleted || row.received) continue
      await prepareContext(row.assignmentId)
      await rewrapPending(row.id)
    }
    await deliver()
    await refresh()
  } catch {
    error.value =
      'Не удалось отправить сейчас. Приложение повторит автоматически.'
  } finally {
    busy.value = ''
  }
}
onMounted(() => void refresh().then(() => {
  if (rows.value.length) void syncQueue()
}))
</script>
<template>
  <section v-if="rows.length" class="photo-queue">
    <h2>{{ q('Ожидают отправки') }}</h2>
    <p class="field-hint">
      {{ q('Снимки уже сохранены и зашифрованы. Отправка продолжится автоматически.') }}
    </p>
    <div class="photo-queue-list">
      <article v-for="(row, index) in rows" :key="row.id">
        <span class="photo-queue-number">{{ index + 1 }}</span>
        <span><strong>{{ q('Фотография') }} {{ index + 1 }}</strong>
          <small v-if="row.deleted">{{ q('Удаление ожидает подтверждения сервера') }}</small>
          <small v-else-if="!row.received">{{ q('Ожидает доставки') }}</small>
          <small v-else-if="row.draft">{{ q('Есть недоставленные изменения данных') }}</small>
          <small v-else-if="row.gps">{{ q('Координаты ожидают доставки') }}</small>
        </span>
      </article>
    </div>
    <button v-if="error" class="secondary-button" :disabled="!!busy" @click="syncQueue">
      {{ q('Повторить') }}
    </button>
    <p v-if="error" class="form-error" role="alert">{{ q(error) }}</p>
  </section>
</template>
