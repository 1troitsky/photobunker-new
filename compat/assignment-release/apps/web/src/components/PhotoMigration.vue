<script setup lang="ts">
import { q } from '../crypto/text'
import { ref, shallowRef, watch } from 'vue'
import { photoReadAllowed } from '../crypto/store'
import {
  list,
  copy,
  cleanup,
  type Candidate,
  type Verified,
} from '../crypto/migration'
const opened = ref(false),
  busy = ref(false),
  error = ref(''),
  notice = ref(''),
  confirmed = ref<string[]>([])
const candidates = shallowRef<Candidate[]>([]),
  verified = shallowRef<Verified[]>([])
async function refresh() {
  const value = await list()
  candidates.value = value.sources
  verified.value = value.verified.filter((v) => !v.cleaned)
}
async function run(action: () => Promise<unknown>) {
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await action()
  } catch {
    error.value =
      'Перенос не завершён. Старые файлы сохранены. Проверьте подключение, права и актуальность защиты задания.'
  } finally {
    busy.value = false
  }
}
async function show() {
  opened.value = true
  await run(refresh)
}
async function migrate(candidate: Candidate) {
  await copy(candidate)
  notice.value =
    'Зашифрованная копия и версии проверены. Старые файлы пока сохранены.'
  await refresh()
}
async function clean(item: Verified) {
  await cleanup(item)
  confirmed.value = []
  notice.value = 'Удаление выбранной старой копии подтверждено.'
  await refresh()
}
watch(photoReadAllowed, (allowed) => {
  if (!allowed) {
    opened.value = false
    candidates.value = []
    verified.value = []
    confirmed.value = []
  }
})
</script>
<template>
  <div v-if="photoReadAllowed()" class="form-card">
    <button class="secondary-button" :disabled="busy" @click="show">
      {{ q('Перенести старые фотографии') }}
    </button>
    <template v-if="opened">
      <p class="field-hint">
        {{
          q(
            'Приложение создаст зашифрованную копию, заново прочитает её и сравнит оригинал, данные и локальные версии. Существующий срок хранения не продлевается; для старых бессрочных снимков новая облачная копия хранится до 14 дней. Удаление прежних файлов — отдельный шаг.',
          )
        }}
      </p>
      <p class="field-hint">
        {{
          q(
            'Удаляется только выбранная копия. Другие устройства и локальные копии проверяются и очищаются отдельно, чтобы сохранить недоставленные изменения.',
          )
        }}
      </p>
      <article
        v-for="candidate in candidates"
        :key="candidate.source.kind + candidate.source.id"
        class="form-card"
      >
        <strong>{{
          candidate.photo.title ||
          candidate.photo.shortId ||
          candidate.photo.id.slice(0, 8)
        }}</strong>
        <small>{{
          q(
            candidate.source.kind === 'local'
              ? 'На этом устройстве'
              : candidate.source.kind === 'workspace'
                ? 'Прежняя библиотека аккаунта'
                : 'Подтверждённая старая библиотека',
          )
        }}</small>
        <button
          class="secondary-button"
          :disabled="busy"
          @click="run(() => migrate(candidate))"
        >
          {{ q('Создать и проверить зашифрованную копию') }}
        </button>
      </article>
      <article v-for="item in verified" :key="item.targetId" class="form-card">
        <p>
          {{
            q(
              'Зашифрованная копия проверена. Если оригинал изменился, удаление будет остановлено.',
            )
          }}
        </p>
        <small>{{
          q(
            item.statement.source.kind === 'local'
              ? 'На этом устройстве'
              : item.statement.source.kind === 'workspace'
                ? 'Прежняя библиотека аккаунта'
                : 'Подтверждённая старая библиотека',
          )
        }}</small>
        <label class="check-row"
          ><input
            v-model="confirmed"
            :value="item.targetId"
            type="checkbox"
            :disabled="busy"
          />{{
            q('Удалить выбранный старый оригинал после проверки копии')
          }}</label
        >
        <button
          class="secondary-button"
          :disabled="busy || !confirmed.includes(item.targetId)"
          @click="run(() => clean(item))"
        >
          {{ q('Удалить старую копию') }}
        </button>
      </article>
      <p v-if="!candidates.length && !verified.length" class="field-hint">
        {{ q('Нет старых фотографий для переноса.') }}
      </p>
    </template>
    <p v-if="error" class="form-error" role="alert">{{ q(error) }}</p>
    <p v-if="notice" class="field-hint" role="status">{{ q(notice) }}</p>
  </div>
</template>
