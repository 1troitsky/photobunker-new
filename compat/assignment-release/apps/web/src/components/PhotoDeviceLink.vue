<script setup lang="ts">
import { q } from '../crypto/text'
import { ref } from 'vue'
import {
  strongUnlocked,
  photoReadAllowed,
  startLink,
  receiveLink,
  approveLink,
  linkRequest,
  linkFingerprint,
} from '../crypto/store'
const id = ref(''),
  fingerprint = ref(''),
  busy = ref(false),
  error = ref(''),
  done = ref(false)
async function run(action: () => Promise<unknown>) {
  busy.value = true
  error.value = ''
  try {
    await action()
  } catch {
    error.value =
      'Не удалось подключить устройство. Проверьте ID и полный отпечаток; запрос действует пять минут.'
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div v-if="!strongUnlocked" class="form-card">
    <button class="secondary-button" :disabled="busy" @click="run(startLink)">
      {{ q('Подключить с открытого устройства') }}
    </button>
    <template v-if="linkRequest">
      <p class="field-hint">
        {{
          q(
            'Откройте «Защиту фотографий» на другом устройстве этого аккаунта. Введите ID запроса и сверьте полный отпечаток.',
          )
        }}
      </p>
      <p>
        <strong>{{ q('ID запроса') }}</strong
        ><br /><code>{{ linkRequest.id }}</code>
      </p>
      <p>
        <strong>{{ q('Отпечаток запроса') }}</strong
        ><br /><code>{{ linkFingerprint() }}</code>
      </p>
      <button
        class="secondary-button"
        :disabled="busy"
        @click="run(receiveLink)"
      >
        {{ q('Получить подтверждение') }}
      </button>
    </template>
  </div>
  <form
    v-else-if="photoReadAllowed()"
    class="form-card"
    @submit.prevent="
      run(async () => {
        await approveLink(id, fingerprint)
        id = ''
        fingerprint = ''
        done = true
      })
    "
  >
    <label class="field-label" for="photo-link-id">{{
      q('ID запроса с нового устройства')
    }}</label>
    <input id="photo-link-id" v-model="id" autocomplete="off" required />
    <label class="field-label" for="photo-link-fingerprint">{{
      q('Отпечаток с нового устройства')
    }}</label>
    <input
      id="photo-link-fingerprint"
      v-model="fingerprint"
      autocomplete="off"
      required
    />
    <p class="field-hint">
      {{
        q(
          'Скопируйте данные непосредственно с нового устройства. Подтверждайте только собственное устройство.',
        )
      }}
    </p>
    <button class="secondary-button" :disabled="busy">
      {{ q('Подтвердить устройство') }}
    </button>
    <p v-if="done" role="status">
      {{ q('Устройство подтверждено. Завершите подключение на нём.') }}
    </p>
  </form>
  <p v-if="error" class="form-error" role="alert">{{ q(error) }}</p>
</template>
