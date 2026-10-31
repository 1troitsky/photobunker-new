<script setup lang="ts">
import { q } from '../crypto/text'
import { onMounted, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import AppSheet from './AppSheet.vue'
import { prepareContext, planReview, untrustedKeys } from '../crypto/store'
import { jobs, rewrapPending, deliver, type Job } from '../crypto/photos'
const router = useRouter(),
  rows = shallowRef<Job[]>([]),
  busy = ref(''),
  error = ref('')
const reviewRow = shallowRef<Job>()
async function refresh() {
  rows.value = (await jobs()).filter(
    (j) => j.deleted || !j.received || j.draft || j.gps,
  )
}
onMounted(() => void refresh())
async function retryDeletes() {
  busy.value = 'delete'
  error.value = ''
  try {
    await deliver()
    await refresh()
  } catch {
    error.value =
      'Удаление ожидает подтверждения сервера. Проверьте подключение и права.'
  } finally {
    busy.value = ''
  }
}
async function renew(row: Job, approve = false) {
  busy.value = row.id
  error.value = ''
  try {
    await router.replace({
      query: row.assignmentId ? { assignment: row.assignmentId } : {},
    })
    if (approve) await prepareContext(row.assignmentId, true)
    await rewrapPending(row.id)
    await deliver()
    await refresh()
    reviewRow.value = undefined
  } catch (failure) {
    if (failure instanceof Error && ['crypto.review_required', 'crypto.review_changed'].includes(failure.message)) reviewRow.value = row
    error.value =
      'Проверьте защиту задания и подтвердите актуальный состав получателей. Если владелец ещё не обновил защиту, отправка останется в очереди.'
  } finally {
    busy.value = ''
  }
}
</script>
<template>
  <div v-if="rows.length" class="form-card">
    <h2>{{ q('Зашифрованная очередь') }}</h2>
    <p class="field-hint">
      {{
        q(
          'При изменении участников потребуется обновить получателей недоставленных кадров. Оригинал и его срок хранения сохраняются.',
        )
      }}
    </p>
    <article v-for="row in rows" :key="row.id" class="form-card">
      <strong>{{ row.id.slice(0, 8).toUpperCase() }}</strong>
      <p v-if="row.deleted">
        {{ q('Удаление ожидает подтверждения сервера') }}
      </p>
      <button
        v-if="row.deleted"
        class="secondary-button"
        :disabled="!!busy"
        @click="retryDeletes"
      >
        {{ q('Повторить удаление') }}
      </button>
      <p v-if="!row.deleted && !row.received">{{ q('Ожидает доставки') }}</p>
      <p v-if="row.draft">{{ q('Есть недоставленные изменения данных') }}</p>
      <p v-if="row.gps">{{ q('Координаты ожидают доставки') }}</p>
      <button
        v-if="!row.deleted && !row.received"
        class="secondary-button"
        :disabled="!!busy"
        @click="renew(row)"
      >
        {{ q('Обновить получателей') }}
      </button>
    </article>
    <p v-if="error" class="form-error" role="alert">{{ q(error) }}</p>
    <AppSheet :open="!!reviewRow && !!planReview" :title="q('Участники общей съёмки')" :busy="!!busy" @close="reviewRow = undefined">
      <p>{{ q('Эти участники получат доступ к снимкам в соответствии с правами задания. Сверьте их перед подтверждением.') }}</p>
      <p v-for="member in planReview?.members" :key="member.accountId"><strong>{{ member.publicId }}</strong></p>
      <p v-for="key in untrustedKeys" :key="key.publicId"><strong>{{ key.publicId }}</strong><br /><code>{{ key.fingerprint }}</code></p>
      <button class="primary-button" :disabled="!!busy" @click="reviewRow && renew(reviewRow, true)">{{ q('Подтвердить участников') }}</button>
    </AppSheet>
  </div>
</template>
