<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ScreenHeader from '../components/ScreenHeader.vue'
import PhotoQueue from '../components/PhotoQueue.vue'
import PhotoMigration from '../components/PhotoMigration.vue'
import { accountKey } from '../identity/vault'
import { ensureAccountPhotos } from '../identity/setup'
import { downloadFile } from '../studio/export'
import { q } from '../crypto/text'
import { strongUnlocked } from '../crypto/store'
const router = useRouter(), connected = ref(false), busy = ref(false), error = ref(''), notice = ref('')
async function run(action: () => Promise<unknown>) {
  busy.value = true; error.value = ''; notice.value = ''
  try { await action() }
  catch { error.value = q('Не удалось выполнить действие. Проверьте соединение и повторите.') }
  finally { busy.value = false }
}
onMounted(() => void run(async () => { connected.value = !!await accountKey(); if (connected.value) await ensureAccountPhotos() }))
async function download() {
  const key = await accountKey()
  if (!key) throw new Error('recovery.key_required')
  downloadFile(new File([key], 'photobunker-account-key.txt', { type: 'text/plain' }))
}
</script>
<template>
  <section class="native-screen">
    <ScreenHeader :title="q('Ключ аккаунта')" back="/profile/security" />
    <div class="screen-body native-form">
      <p class="field-hint">{{ q('Один ключ аккаунта подключает ваши фотографии и переписку. Приложение хранит его на этом устройстве; вводить его при каждом запуске не нужно.') }}</p>
      <template v-if="connected">
        <p class="field-hint" role="status">{{ q('Ключ аккаунта подключён на этом устройстве.') }}</p>
        <button class="primary-button" :disabled="busy" @click="run(download)">{{ q('Сохранить ключ аккаунта в файл') }}</button>
        <p class="field-hint">{{ q('Сохраните файл в надёжном месте. Он понадобится после выхода из аккаунта или на новом устройстве.') }}</p>
      </template>
      <button v-else class="primary-button" :disabled="busy" @click="router.push('/profile/account?mode=connect')">{{ q('Подключить ключ аккаунта') }}</button>
      <template v-if="strongUnlocked">
        <details class="form-card">
          <summary>{{ q('Дополнительные действия') }}</summary>
          <PhotoQueue /><PhotoMigration />
        </details>
      </template>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-if="notice" class="field-hint" role="status">{{ notice }}</p>
    </div>
  </section>
</template>
