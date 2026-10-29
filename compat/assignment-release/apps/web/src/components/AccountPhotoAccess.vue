<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { accountKey } from '../identity/vault'
import { ensureAccountPhotos } from '../identity/setup'
import { q } from '../crypto/text'
const router = useRouter(), busy = ref(true), missing = ref(false), error = ref('')
async function connect() {
  busy.value = true; error.value = ''
  try {
    missing.value = !(await accountKey())
    if (!missing.value) await ensureAccountPhotos()
  } catch (failure) {
    error.value = failure instanceof Error && failure.message === 'recovery.legacy_photo_key'
      ? q('Для старых фотографий нужна прежняя резервная копия. Импортируйте её один раз; новые ключи не создаются взамен существующих.')
      : q('Не удалось подключить фотографии. Проверьте соединение и повторите. Ваши данные сохранены.')
  } finally { busy.value = false }
}
onMounted(() => void connect())
</script>
<template>
  <section class="native-screen account-photo-access">
    <div class="screen-body">
      <h1>{{ q(busy ? 'Подключаем фотографии…' : missing ? 'Подключите ключ аккаунта' : 'Фотографии пока недоступны') }}</h1>
      <p v-if="missing" class="field-hint">{{ q('Этот аккаунт создан в прежней версии приложения. Подключите его единственный ключ один раз. Затем фотографии и переписка будут открываться автоматически.') }}</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <button v-if="missing" class="primary-button" @click="router.push('/profile/account?mode=connect')">{{ q('Ввести ключ аккаунта') }}</button>
      <button v-else-if="!busy" class="primary-button" @click="connect">{{ q('Повторить') }}</button>
      <button v-if="error" class="quiet-button" @click="router.push('/profile/account?mode=connect')">{{ q('Импортировать ключ аккаунта') }}</button>
    </div>
  </section>
</template>
