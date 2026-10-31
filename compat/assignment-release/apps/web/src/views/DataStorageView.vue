<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ScreenHeader from '../components/ScreenHeader.vue'
import AppSheet from '../components/AppSheet.vue'
import { photos, formatBytes } from '../local/library'
import { jobs } from '../crypto/photos'
import { storageSummary, saveInactivity, deleteAccountData, type StorageSummary } from '../identity/storage'
import { q } from '../crypto/text'
import { formatDate, formatNumber } from '../i18n'
const router = useRouter(), summary = ref<StorageSummary>(), days = ref(180), pending = ref(0), queuedBytes = ref(0), availableSpace = ref<number>(), busy = ref(false), error = ref(''), notice = ref(''), deleteOpen = ref(false), confirmed = ref(false)
const availablePhotos = computed(() => photos.value.filter(photo => !photo.uploadOnly && !photo.deliveryOnly && !photo.deleteRequested && (!photo.expiresAt || photo.expiresAt > Date.now())).length)
async function refresh() {
  busy.value = true; error.value = ''
  try {
    const result = await storageSummary()
    summary.value = result; days.value = result.inactivityDays
    const queued = (await jobs()).filter(job => !job.received && !job.deleted)
    pending.value = queued.length
    queuedBytes.value = queued.reduce((total, job) => total + Object.values(job.objects).reduce((bytes, object) => bytes + object.bytes.byteLength, 0), 0)
    const estimate = await navigator.storage?.estimate?.().catch(() => undefined)
    if (estimate?.quota !== undefined && estimate.usage !== undefined) availableSpace.value = Math.max(0, estimate.quota - estimate.usage)
  } catch { error.value = 'Не удалось загрузить данные хранилища. Проверьте соединение и повторите.' }
  finally { busy.value = false }
}
async function save() {
  if (!Number.isInteger(days.value) || days.value < 30 || days.value > 360) { error.value = 'Укажите целое число дней от 30 до 360.'; return }
  busy.value = true; error.value = ''; notice.value = ''
  try { const saved = await saveInactivity(days.value); if (summary.value) Object.assign(summary.value, saved); notice.value = 'Срок автоудаления сохранён.' }
  catch { error.value = 'Не удалось сохранить срок. Проверьте соединение и повторите.' }
  finally { busy.value = false }
}
async function remove() {
  if (busy.value || !confirmed.value) return
  busy.value = true; error.value = ''
  try { await deleteAccountData(); deleteOpen.value = false; await router.replace('/profile') }
  catch { error.value = 'Не удалось завершить очистку. Закройте другие окна приложения и повторите.'; deleteOpen.value = false }
  finally { busy.value = false }
}
onMounted(() => void refresh())
</script>
<template>
  <section class="native-screen settings-screen">
    <ScreenHeader :title="q('Данные и хранилище')" back="/settings" />
    <div class="screen-body native-form">
      <section class="form-card">
        <h2>{{ q('Хранилище') }}</h2>
        <dl class="native-facts">
          <div><dt>{{ q('Доступные фотографии') }}</dt><dd>{{ formatNumber(availablePhotos) }}</dd></div>
          <template v-if="summary">
            <div><dt>{{ q('Ваши фотографии в облаке') }}</dt><dd>{{ formatNumber(summary.ownedPhotos) }}</dd></div>
            <div><dt>{{ q('Занято в облаке') }}</dt><dd>{{ formatBytes(summary.encryptedBytes) }}</dd></div>
          </template>
          <div><dt>{{ q('Ожидают отправки') }}</dt><dd>{{ formatNumber(pending) }} · {{ formatBytes(queuedBytes) }}</dd></div>
          <div v-if="availableSpace !== undefined"><dt>{{ q('Доступно приложению на устройстве') }}</dt><dd>{{ formatBytes(availableSpace) }}</dd></div>
        </dl>
        <p class="field-hint">{{ q('В объём облака входят зашифрованные оригиналы, превью и версии. Доступное место на устройстве — оценка браузера, а не свободная память телефона.') }}</p>
        <button class="secondary-button" :disabled="busy" @click="refresh">{{ q('Обновить') }}</button>
      </section>
      <form class="form-card" @submit.prevent="save">
        <h2>{{ q('Удалить аккаунт при неактивности') }}</h2>
        <p class="field-hint">{{ q('Если вы не пользуетесь приложением с подключением к интернету дольше выбранного срока, аккаунт и его данные удаляются. По умолчанию — 180 дней. Фоновая синхронизация не считается активностью.') }}</p>
        <label for="inactivity-days">{{ q('Дней без активности') }}</label>
        <input id="inactivity-days" v-model.number="days" type="number" min="30" max="360" step="1" inputmode="numeric" required :disabled="busy || !summary" />
        <p class="field-hint">{{ q('От 30 до 360 дней') }}</p>
        <p v-if="summary?.deletesAt" class="field-hint">{{ q('Если больше не пользоваться приложением:') }} {{ formatDate(summary.deletesAt, { dateStyle: 'medium' }) }}</p>
        <button class="primary-button" :disabled="busy || !summary">{{ q('Сохранить') }}</button>
      </form>
      <section class="form-card">
        <h2>{{ q('Удаление данных') }}</h2>
        <p class="field-hint">{{ q('Удалить аккаунт вместе с фотографиями, контактами, настройками и резервными копиями переписки. Восстановление по ключу после удаления невозможно.') }}</p>
        <button class="danger-button" :disabled="busy || !summary" @click="confirmed = false; deleteOpen = true">{{ q('Удалить аккаунт и все данные') }}</button>
      </section>
      <p v-if="busy" class="field-hint" role="status">{{ q('Выполняем…') }}</p>
      <p v-if="error" class="form-error" role="alert">{{ q(error) }}</p>
      <p v-if="notice" class="field-hint" role="status">{{ q(notice) }}</p>
    </div>
    <AppSheet :open="deleteOpen" :title="q('Удалить аккаунт и все данные?')" :busy="busy" @close="deleteOpen = false">
      <p>{{ q('Доступ на всех устройствах и внешние ссылки будут закрыты. Фотографии, ваши команды и задания, контакты и резервные копии переписки будут удалены. Это действие нельзя отменить, даже имея ключ аккаунта.') }}</p>
      <p class="field-hint">{{ q('У собеседников могут остаться полученные сообщения и сохранённые копии. Физическая очистка сервера выполняется после закрытия доступа и повторяется при сбоях.') }}</p>
      <label class="check-row"><input v-model="confirmed" type="checkbox" :disabled="busy" />{{ q('Я понимаю, что восстановить данные будет невозможно') }}</label>
      <button class="secondary-button" :disabled="busy" @click="deleteOpen = false">{{ q('Отмена') }}</button>
      <button class="danger-button" :disabled="busy || !confirmed" @click="remove">{{ q('Удалить без возможности восстановления') }}</button>
    </AppSheet>
  </section>
</template>
